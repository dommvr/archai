"""
backend/app/copilot/service.py

Orchestrates a Copilot turn using the OpenAI Responses API:
  1. Persist the user message
  2. Build context (system prompt + history + retrieval)
  3. Call GPT-5.4 via responses.create with tool definitions
  4. If the model requests tool calls, execute them and continue the loop
  5. Persist tool call records and the final assistant message
  6. Auto-generate a thread title if this is the first user turn
  7. Return both messages

Why Responses API (not Chat Completions):
  GPT-5.4 requires the Responses API — Chat Completions parameters such as
  max_tokens are not supported on GPT-5.4.

Tool loop — previous_response_id continuation:
  Round 0: full input sent with store=True so the response is stored
           server-side and can be referenced by subsequent calls.
  Round 1+: send ONLY the new function_call_output items in input, with
            previous_response_id pointing at the prior response.  The API
            reconstructs the full context from its stored state.

  History injected at round-0 contains ONLY plain user/assistant messages
  (no function_call / function_call_output items from prior sessions).
  Persisted TOOL messages are converted to prose in context_builder.py so
  call_ids from previous server-side sessions are never leaked into a new
  session — which would trigger:
    "No tool call found for function_call_output with call_id ..."

  Max rounds = 3 to prevent runaway loops.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from openai import AsyncOpenAI

from app.copilot.context_builder import CopilotContextBuilder
from app.copilot.repositories import CopilotRepository
from app.copilot.retriever import CopilotRetriever
from app.copilot.schemas import (
    CopilotMessageRole,
    CopilotUiContext,
    SendMessageResponse,
)
from app.copilot.tools import COPILOT_TOOLS_RESPONSES, CopilotToolExecutor
from app.core.config import settings

log = logging.getLogger(__name__)

_MAX_TOOL_ROUNDS = 3

_FALLBACK_ERROR_TEXT = (
    "I encountered an error while processing your request. "
    "Please try again or contact support if the problem persists."
)


class CopilotService:
    def __init__(self, repo: CopilotRepository) -> None:
        self._repo = repo
        self._retriever = CopilotRetriever(repo=repo)
        self._ctx_builder = CopilotContextBuilder(
            repo=repo, retriever=self._retriever
        )
        self._llm = AsyncOpenAI(api_key=settings.openai_api_key or "")

    async def send_message(
        self,
        project_id: UUID,
        thread_id: UUID,
        user_id: UUID,
        content: str,
        ui_context: CopilotUiContext | None = None,
        attachment_ids: list[UUID] | None = None,
    ) -> SendMessageResponse:
        attachment_ids = attachment_ids or []

        # ── 1. Persist user message ───────────────────────────
        user_msg = await self._repo.append_message(
            thread_id=thread_id,
            project_id=project_id,
            role=CopilotMessageRole.USER,
            content=content,
            ui_context=ui_context,
        )
        for att_id in attachment_ids:
            await self._repo.link_attachment_to_message(att_id, user_msg.id)

        # ── 2. Build context ──────────────────────────────────
        ctx = await self._ctx_builder.build(
            project_id=project_id,
            thread_id=thread_id,
            user_message=content,
            ui_context=ui_context,
            attachment_ids=attachment_ids,
        )

        # ── 3. Assemble first-turn input ──────────────────────
        # The Responses API separates `instructions` (system prompt string)
        # from `input` (list of message/item dicts).
        input_messages: list[dict[str, Any]] = []

        # Retrieval snippets: inject as a user/assistant pair because
        # role=system is not supported inside the Responses API input list.
        if ctx.retrieval_snippets:
            snippet_block = "\n\n".join(ctx.retrieval_snippets)
            input_messages.append({
                "role": "user",
                "content": (
                    "[Relevant document excerpts — use these when answering]"
                    f"\n{snippet_block}"
                ),
            })
            input_messages.append({
                "role": "assistant",
                "content": "Understood. I'll reference those excerpts.",
            })

        input_messages.extend(ctx.history)
        input_messages.append({"role": "user", "content": content})

        # Debug: log item types so stray function_call_output items are visible
        if log.isEnabledFor(logging.DEBUG):
            type_counts: dict[str, int] = {}
            for item in input_messages:
                key = item.get("type") or item.get("role") or "unknown"
                type_counts[key] = type_counts.get(key, 0) + 1
            log.debug(
                "Copilot round-0 input composition: total=%d types=%s",
                len(input_messages), type_counts,
            )

        # ── 4. LLM call + tool loop ───────────────────────────
        sel = (
            [{"id": oid} for oid in (ui_context.selected_object_ids or [])]
            if ui_context else []
        )
        executor = CopilotToolExecutor(
            repo=self._repo,
            project_id=project_id,
            ui_context_run_id=ui_context.active_run_id if ui_context else None,
            viewer_selection=sel,
            active_model_ref_id=ui_context.active_model_ref_id if ui_context else None,
        )

        assistant_content, tool_messages = await self._run_with_tools(
            instructions=ctx.system_prompt,
            input_messages=input_messages,
            executor=executor,
        )

        # ── 5. Persist tool messages ──────────────────────────
        persisted_tool_msgs = []
        for tm in tool_messages:
            tool_msg = await self._repo.append_message(
                thread_id=thread_id,
                project_id=project_id,
                role=CopilotMessageRole.TOOL,
                content=tm["content"],
                tool_name=tm.get("tool_name"),
                tool_call_id=tm.get("tool_call_id"),
                tool_payload=tm.get("tool_payload"),
            )
            persisted_tool_msgs.append(tool_msg)

        # ── 6. Persist assistant message ──────────────────────
        assistant_msg = await self._repo.append_message(
            thread_id=thread_id,
            project_id=project_id,
            role=CopilotMessageRole.ASSISTANT,
            content=assistant_content,
        )

        # ── 7. Auto-title thread on first user message ────────
        thread = await self._repo.get_thread(thread_id, user_id)
        if thread and thread.title is None:
            await self._repo.update_thread_title(
                thread_id, _derive_thread_title(content)
            )

        return SendMessageResponse(
            user_message=user_msg,
            assistant_message=assistant_msg,
            tool_messages=persisted_tool_msgs,
        )

    async def _run_with_tools(
        self,
        instructions: str,
        input_messages: list[dict[str, Any]],
        executor: CopilotToolExecutor,
    ) -> tuple[str, list[dict[str, Any]]]:
        """
        Run the Responses API with a server-side continuation tool loop.

        Continuation pattern (documented by OpenAI for Responses API):
          Round 0: full input sent with store=True so the response is stored
                   server-side and can be referenced by subsequent calls.
          Round 1+: send ONLY the new function_call_output items in `input`,
                    with previous_response_id pointing at the prior response.
                    The API reconstructs the full context from its stored
                    state — we do NOT re-send the whole history.

        Why store=True:
          previous_response_id only works when the prior response is
          retrievable server-side.  store=True (which is the default for
          most org configurations, but we set it explicitly for safety)
          guarantees the response is stored.

        Max rounds = 3 to prevent runaway loops.

        Returns (final_assistant_text, tool_messages_to_persist).
        """
        tool_messages_to_persist: list[dict[str, Any]] = []
        prev_response_id: str | None = None

        for round_num in range(_MAX_TOOL_ROUNDS + 1):
            if round_num == 0:
                call_input = input_messages
                log.debug(
                    "Copilot LLM call round=0 input_items=%d",
                    len(call_input),
                )
            else:
                # round_num >= 1: call_input was set at end of prior round
                log.debug(
                    "Copilot LLM call round=%d prev_response_id=%s "
                    "output_items=%d",
                    round_num, prev_response_id, len(call_input),
                )

            try:
                kwargs: dict[str, Any] = dict(
                    model=settings.llm_model,
                    instructions=instructions,
                    input=call_input,
                    tools=COPILOT_TOOLS_RESPONSES,
                    store=True,
                )
                if prev_response_id is not None:
                    kwargs["previous_response_id"] = prev_response_id

                response = await self._llm.responses.create(**kwargs)
            except Exception as exc:
                log.error(
                    "Copilot Responses API call failed (round=%d): %s",
                    round_num, exc,
                )
                raise

            log.debug(
                "Copilot response_id=%s round=%d output_items=%d",
                response.id, round_num, len(response.output),
            )
            prev_response_id = response.id

            function_calls = [
                item for item in response.output
                if item.type == "function_call"
            ]

            if not function_calls:
                # No tool calls — extract final text and return
                text = _extract_text_from_response(response)
                if not text:
                    log.warning(
                        "Copilot: empty text from Responses API "
                        "(round=%d response_id=%s)",
                        round_num, response.id,
                    )
                    text = _FALLBACK_ERROR_TEXT
                return text, tool_messages_to_persist

            if round_num >= _MAX_TOOL_ROUNDS:
                log.warning(
                    "Copilot hit max tool rounds (%d), "
                    "forcing final answer without tools (response_id=%s)",
                    _MAX_TOOL_ROUNDS, response.id,
                )
                try:
                    # Continue from this response, no tools → forces text
                    final = await self._llm.responses.create(
                        model=settings.llm_model,
                        instructions=instructions,
                        input=[],
                        previous_response_id=prev_response_id,
                        store=True,
                    )
                except Exception as exc:
                    log.error("Copilot forced-final call failed: %s", exc)
                    raise
                text = _extract_text_from_response(final)
                return text or _FALLBACK_ERROR_TEXT, tool_messages_to_persist

            # Execute tools and build the function_call_output items for the
            # next round.  These are the ONLY items sent in the next input.
            log.debug(
                "Copilot round=%d executing %d tool(s): %s",
                round_num,
                len(function_calls),
                [fc.name for fc in function_calls],
            )

            call_input = []
            for fc in function_calls:
                fn_name = fc.name
                try:
                    fn_args = json.loads(fc.arguments or "{}")
                except json.JSONDecodeError:
                    log.warning(
                        "Copilot: bad JSON arguments for tool %s: %r",
                        fn_name, fc.arguments,
                    )
                    fn_args = {}

                try:
                    result = await executor.execute(fn_name, fn_args)
                except Exception as exc:
                    log.error(
                        "Copilot: tool %s raised: %s", fn_name, exc,
                    )
                    result = {"status": "error", "reason": str(exc)}

                result_str = json.dumps(result)
                log.debug(
                    "Copilot: tool %s call_id=%s result_status=%s",
                    fn_name, fc.call_id,
                    result.get("status") if isinstance(result, dict) else "ok",
                )

                call_input.append({
                    "type":    "function_call_output",
                    "call_id": fc.call_id,
                    "output":  result_str,
                })

                tool_messages_to_persist.append({
                    "tool_call_id": fc.call_id,
                    "tool_name":    fn_name,
                    "content":      result_str,
                    "tool_payload": {
                        "tool_call_args": fn_args,
                        "result":         result,
                    },
                })

        # Should not reach here (loop always returns or raises above)
        return _FALLBACK_ERROR_TEXT, tool_messages_to_persist


def _extract_text_from_response(response: Any) -> str:
    """
    Extract the final assistant text from a Responses API response.

    Fast path: response.output_text (set on plain text turns).
    Slow path: scan response.output for a message item with text content
               parts (covers tool-calling turns where the last output is
               a message).
    """
    if response.output_text:
        return response.output_text.strip()

    for item in response.output:
        if item.type == "message":
            parts: list[str] = []
            for part in item.content:
                if hasattr(part, "text"):
                    parts.append(part.text)
                elif isinstance(part, dict) and part.get("type") == "output_text":
                    parts.append(part.get("text", ""))
            text = "".join(parts).strip()
            if text:
                return text

    return ""


def _derive_thread_title(first_message: str, max_len: int = 60) -> str:
    text = first_message.strip()
    for sep in (".", "?", "!"):
        idx = text.find(sep)
        if 0 < idx < max_len:
            return text[: idx + 1]
    return text[:max_len].rstrip() + ("…" if len(text) > max_len else "")
