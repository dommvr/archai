"""
backend/app/copilot/context_builder.py

Assembles the per-request context for the Copilot LLM call.

The context builder is deliberately NOT a monolithic static prompt file.
It assembles context from multiple live sources:
  1. System prompt (fixed + project name injected)
  2. Project metadata summary
  3. Current UI/page context from the request
  4. Recent thread history (or compressed summary if thread is long)
  5. Retrieved doc chunks (via retriever — pgvector when ready)
  6. Active run + metrics (if available)
  7. Attachment references (if any)

Each source is optional and degrades gracefully if unavailable.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.copilot.repositories import CopilotRepository
from app.copilot.retriever import CopilotRetriever
from app.copilot.schemas import CopilotAttachmentType, CopilotMessage, CopilotUiContext

log = logging.getLogger(__name__)

# Maximum number of recent messages to include verbatim before falling back to summary
MAX_RECENT_MESSAGES = 20

SYSTEM_PROMPT_TEMPLATE = """\
You are ArchAI Copilot, an expert AI assistant embedded in the ArchAI design platform.
ArchAI helps architects and AEC professionals with zoning compliance checking, design analysis, \
massing, sustainability, and code review.

You are operating inside the project: {project_name}

Your responsibilities:
- Answer questions about this project's design, zoning rules, compliance status, and metrics.
- Use the provided tool results and context — do not invent data or hallucinate values.
- When live data is available from tools, prefer tool output over general knowledge.
- When document context is available from retrieval, cite it accurately.
- When tool results show "not_ready", acknowledge the limitation and offer general guidance instead.
- Keep responses concise and professional. Architects appreciate precision.
- Format important values (areas, setbacks, heights) with their units.
- If you're unsure, say so — never fabricate compliance outcomes.

Current page context: {page_context}
{active_run_section}
{pinned_notes_section}\
"""


@dataclass
class ResolvedAttachment:
    """
    An attachment that has been resolved to a signed read URL (or None if the
    file is not yet in Storage or the bucket is unavailable).
    """
    attachment_id: str
    filename: str
    mime_type: str | None
    attachment_type: str         # 'image' | 'document' | 'screenshot'
    storage_path: str
    signed_url: str | None       # None = not downloadable this turn
    # Whether to include as image_url content block (True) or text note (False)
    is_image: bool


@dataclass
class BuiltContext:
    """All context assembled for a single Copilot turn."""
    system_prompt: str
    history: list[dict[str, Any]]  # OpenAI message dicts
    retrieval_snippets: list[str]
    attachment_paths: list[str]    # kept for logging; content is in attachments
    attachments: list[ResolvedAttachment] = field(default_factory=list)
    # Used for logging/debug
    project_id: UUID = field(default_factory=lambda: UUID(int=0))
    thread_id: UUID = field(default_factory=lambda: UUID(int=0))
    sources_used: list[str] = field(default_factory=list)


class CopilotContextBuilder:
    def __init__(
        self,
        repo: CopilotRepository,
        retriever: CopilotRetriever,
    ) -> None:
        self._repo = repo
        self._retriever = retriever

    async def build(
        self,
        project_id: UUID,
        thread_id: UUID,
        user_message: str,
        ui_context: CopilotUiContext | None,
        attachment_ids: list[UUID],
        user_id: UUID | None = None,
    ) -> BuiltContext:
        sources_used: list[str] = []

        # ── 1. Project metadata ───────────────────────────────
        project_meta = await self._repo.get_project_metadata(project_id)
        project_name = project_meta["name"] if project_meta else str(project_id)
        sources_used.append("project_metadata")

        # ── 2. Page + active run context ──────────────────────
        page_context = (ui_context.current_page or "unknown") if ui_context else "unknown"
        active_run_section = ""
        active_run_id = ui_context.active_run_id if ui_context else None

        if active_run_id:
            run = await self._repo.get_run_summary(active_run_id)
            if run:
                active_run_section = (
                    f"Active precheck run: {run.get('name') or run['id']} "
                    f"(status: {run['status']}, "
                    f"readiness score: {run.get('readiness_score', 'n/a')})"
                )
                sources_used.append("active_run")

        # ── 3. Pinned notes (injected into system prompt) ─────
        pinned_notes_section = ""
        if user_id is not None:
            pinned_notes = await self._repo.get_pinned_notes(
                project_id=project_id,
                user_id=user_id,
                limit=5,
            )
            if pinned_notes:
                lines = ["Pinned project notes (key decisions or constraints the user flagged):"]
                for note in pinned_notes:
                    lines.append(f"  • {note['title']}: {note['content']}")
                pinned_notes_section = "\n".join(lines)
                sources_used.append("pinned_notes")

        # ── 4. System prompt ──────────────────────────────────
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
            project_name=project_name,
            page_context=page_context,
            active_run_section=active_run_section,
            pinned_notes_section=pinned_notes_section,
        ).strip()

        # ── 5. Thread history ─────────────────────────────────
        summary = await self._repo.get_thread_summary(thread_id)
        history_messages = await self._repo.get_recent_messages(
            thread_id=thread_id,
            limit=MAX_RECENT_MESSAGES,
        )
        history_dicts = _messages_to_openai_format(history_messages, summary)
        if history_dicts:
            sources_used.append("thread_history")

        # ── 6. Retrieval over project docs ────────────────────
        # Only run retrieval when the query looks document-oriented.
        # This avoids wasting embedding API calls on pure tool queries
        # like "show me my metrics" or "what runs do I have".
        snippets: list[str] = []
        if _is_document_query(user_message):
            snippets = await self._retriever.retrieve(
                project_id=project_id,
                query=user_message,
            )
            if snippets:
                sources_used.append("document_retrieval")
                log.debug(
                    "Context: retrieved %d snippets for project=%s",
                    len(snippets), project_id,
                )
            else:
                log.debug(
                    "Context: retrieval returned 0 snippets "
                    "(no embeddings or below threshold) project=%s",
                    project_id,
                )
        else:
            log.debug(
                "Context: skipping retrieval for non-document query %r",
                user_message[:60],
            )

        # ── 7. Attachments — resolve to signed read URLs ──────
        # Fetch the attachment rows for this turn, generate a short-lived
        # signed read URL for each, and classify them as image vs document.
        # Images (type=image|screenshot, mime_type=image/*) can be injected as
        # image_url content blocks in the Responses API input.
        # Documents are injected as a text note (content extraction not yet
        # implemented for arbitrary file types).
        resolved_attachments: list[ResolvedAttachment] = []
        attachment_paths: list[str] = []

        if attachment_ids:
            rows = await self._repo.get_attachments_by_ids(attachment_ids)
            for att in rows:
                attachment_paths.append(att.storage_path)
                signed_url = await self._repo.create_signed_read_url(att.storage_path)
                is_image = (
                    att.attachment_type in (
                        CopilotAttachmentType.IMAGE,
                        CopilotAttachmentType.SCREENSHOT,
                    )
                    or bool(att.mime_type and att.mime_type.startswith("image/"))
                )
                resolved_attachments.append(ResolvedAttachment(
                    attachment_id=str(att.id),
                    filename=att.filename,
                    mime_type=att.mime_type,
                    attachment_type=att.attachment_type.value,
                    storage_path=att.storage_path,
                    signed_url=signed_url,
                    is_image=is_image,
                ))

            if resolved_attachments:
                sources_used.append("attachments")
                log.info(
                    "Context: resolved %d attachment(s) for project=%s "
                    "(images=%d, unavailable=%d)",
                    len(resolved_attachments), project_id,
                    sum(1 for a in resolved_attachments if a.is_image and a.signed_url),
                    sum(1 for a in resolved_attachments if not a.signed_url),
                )

        log.debug(
            "Context built for project=%s thread=%s sources=%s",
            project_id, thread_id, sources_used,
        )

        return BuiltContext(
            system_prompt=system_prompt,
            history=history_dicts,
            retrieval_snippets=snippets,
            attachment_paths=attachment_paths,
            attachments=resolved_attachments,
            project_id=project_id,
            thread_id=thread_id,
            sources_used=sources_used,
        )


def _messages_to_openai_format(
    messages: list[CopilotMessage],
    summary: str | None,
) -> list[dict[str, Any]]:
    """
    Convert stored CopilotMessage rows to plain role/content pairs for the
    Responses API `input` list (round-0 of a fresh turn).

    Critical constraint: the Responses API ties function_call_output items to
    function_call items via call_id within a single server-side session.
    Persisted TOOL messages from prior turns reference call_ids that belong to
    previous sessions — injecting them as function_call_output items at round-0
    of a new session causes:
      "No tool call found for function_call_output with call_id ..."

    Solution: convert tool history to plain prose so the model has context about
    what tools were called without any session-scoped call_id references.

      - role=tool → summarised as a plain user message (tool result context)
      - role=assistant with tool_payload → include the text content only;
        omit the function_call item (no call_id injection into new session)
      - role=user / role=assistant (plain) → pass through unchanged
      - role=system → skip (not supported in Responses API input list)

    If a summary exists, it is injected before recent messages to keep context
    within token limits without losing conversational continuity.
    """
    result: list[dict[str, Any]] = []

    if summary:
        # Responses API input does not support role=system; inject as a
        # user/assistant exchange so the model absorbs the summary context.
        result.append({
            "role": "user",
            "content": (
                "[Earlier conversation summary — read this for context]"
                f"\n{summary}"
            ),
        })
        result.append({
            "role": "assistant",
            "content": "Understood. I have the earlier conversation context.",
        })

    for msg in messages:
        role = msg.role.value

        if role == "system":
            # Not valid in Responses API input list — skip
            continue

        if role == "tool":
            # Convert to plain context prose — never inject as
            # function_call_output (would reference a stale call_id)
            tool_label = msg.tool_name or "tool"
            result.append({
                "role": "user",
                "content": (
                    f"[Previous tool result from {tool_label}]\n{msg.content}"
                ),
            })
            result.append({
                "role": "assistant",
                "content": "Noted.",
            })
            continue

        if role == "assistant" and msg.tool_payload and msg.tool_call_id:
            # This assistant turn triggered a tool call in a prior session.
            # Include only the text content (if any) — do not reconstruct a
            # function_call item with a stale call_id.
            if msg.content:
                result.append({"role": "assistant", "content": msg.content})
            continue

        # Plain user and assistant messages
        result.append({"role": role, "content": msg.content})

    log.debug(
        "_messages_to_openai_format: %d stored messages → %d input items "
        "(summary=%s)",
        len(messages), len(result), summary is not None,
    )
    return result


# ── Document-query heuristic ──────────────────────────────────────────────────

# Keywords that suggest the user is asking about document content rather than
# live structured data.  Retrieval is only triggered when one of these terms
# appears so we avoid spending an embedding API call on every turn.
_DOC_KEYWORDS = (
    "zoning", "code", "regulation", "bylaw", "ordinance",
    "section", "clause", "article", "rule", "requirement",
    "says", "states", "specifies", "according to", "document",
    "permit", "setback", "height limit", "far limit",
    "parking", "allowed", "prohibited", "maximum", "minimum",
    "exception", "variance", "appeal", "condition",
    "what does", "does it say", "cite", "quote",
)


def _is_document_query(message: str) -> bool:
    """
    Heuristic: returns True when the user message is likely asking about
    the content of uploaded documents rather than live structured data.

    Keeps retrieval selective — tool calls for metrics/runs/issues do
    not trigger an unnecessary OpenAI embedding call.
    """
    lower = message.lower()
    return any(kw in lower for kw in _DOC_KEYWORDS)
