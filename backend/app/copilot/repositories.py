"""
backend/app/copilot/repositories.py

Data-access layer for all Copilot Supabase operations.

Rules:
- No business logic here — only CRUD and query patterns.
- All methods are async.
- Service-role client bypasses RLS (auth enforced upstream via JWT).
- Column names are snake_case matching the SQL migration.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from supabase import AsyncClient

from app.copilot.schemas import (
    CopilotAttachment,
    CopilotAttachmentType,
    CopilotMessage,
    CopilotMessageRole,
    CopilotThread,
    CopilotUiContext,
)

log = logging.getLogger(__name__)


class CopilotRepository:
    def __init__(self, client: AsyncClient) -> None:
        self._db = client

    # ── Threads ───────────────────────────────────────────────

    async def create_thread(
        self,
        project_id: UUID,
        user_id: UUID,
        title: str | None = None,
        active_run_id: UUID | None = None,
        page_context: str | None = None,
    ) -> CopilotThread:
        now = datetime.now(timezone.utc).isoformat()
        data: dict[str, Any] = {
            "id":           str(uuid4()),
            "project_id":   str(project_id),
            "user_id":      str(user_id),
            "archived":     False,
            "created_at":   now,
            "updated_at":   now,
        }
        if title is not None:
            data["title"] = title
        if active_run_id is not None:
            data["active_run_id"] = str(active_run_id)
        if page_context is not None:
            data["page_context"] = page_context

        result = await self._db.table("copilot_threads").insert(data).execute()
        return CopilotThread.model_validate(result.data[0])

    async def get_thread(self, thread_id: UUID, user_id: UUID) -> CopilotThread | None:
        result = (
            await self._db.table("copilot_threads")
            .select("*")
            .eq("id", str(thread_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        return CopilotThread.model_validate(result.data[0])

    async def list_threads(
        self,
        project_id: UUID,
        user_id: UUID,
        include_archived: bool = False,
        limit: int = 20,
        offset: int = 0,
    ) -> list[CopilotThread]:
        q = (
            self._db.table("copilot_threads")
            .select("*")
            .eq("project_id", str(project_id))
            .eq("user_id", str(user_id))
        )
        if not include_archived:
            q = q.eq("archived", False)
        result = (
            await q.order("updated_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        threads = [CopilotThread.model_validate(row) for row in result.data]

        # Enrich with last message preview
        for thread in threads:
            preview = await self._get_last_message_preview(thread.id)
            thread.last_message_preview = preview

        return threads

    async def _get_last_message_preview(self, thread_id: UUID) -> str | None:
        result = (
            await self._db.table("copilot_messages")
            .select("content, role")
            .eq("thread_id", str(thread_id))
            .in_("role", ["user", "assistant"])
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        content: str = result.data[0]["content"]
        return content[:120] + "…" if len(content) > 120 else content

    async def update_thread_title(self, thread_id: UUID, title: str) -> None:
        await (
            self._db.table("copilot_threads")
            .update({"title": title, "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", str(thread_id))
            .execute()
        )

    async def archive_thread(self, thread_id: UUID, user_id: UUID) -> None:
        await (
            self._db.table("copilot_threads")
            .update({"archived": True, "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", str(thread_id))
            .eq("user_id", str(user_id))
            .execute()
        )

    # ── Messages ──────────────────────────────────────────────

    async def append_message(
        self,
        thread_id: UUID,
        project_id: UUID,
        role: CopilotMessageRole,
        content: str,
        tool_name: str | None = None,
        tool_call_id: str | None = None,
        tool_payload: dict[str, Any] | None = None,
        ui_context: CopilotUiContext | None = None,
    ) -> CopilotMessage:
        now = datetime.now(timezone.utc).isoformat()
        data: dict[str, Any] = {
            "id":         str(uuid4()),
            "thread_id":  str(thread_id),
            "project_id": str(project_id),
            "role":       role.value,
            "content":    content,
            "created_at": now,
        }
        if tool_name is not None:
            data["tool_name"] = tool_name
        if tool_call_id is not None:
            data["tool_call_id"] = tool_call_id
        if tool_payload is not None:
            data["tool_payload"] = tool_payload
        if ui_context is not None:
            data["ui_context"] = ui_context.model_dump(by_alias=False, exclude_none=True)

        result = await self._db.table("copilot_messages").insert(data).execute()
        return CopilotMessage.model_validate(result.data[0])

    async def list_messages(
        self,
        thread_id: UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> list[CopilotMessage]:
        result = (
            await self._db.table("copilot_messages")
            .select("*")
            .eq("thread_id", str(thread_id))
            .order("created_at", desc=False)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return [CopilotMessage.model_validate(row) for row in result.data]

    async def get_recent_messages(
        self,
        thread_id: UUID,
        limit: int = 20,
    ) -> list[CopilotMessage]:
        """Returns the most recent `limit` messages in chronological order."""
        result = (
            await self._db.table("copilot_messages")
            .select("*")
            .eq("thread_id", str(thread_id))
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        # Reverse so they are oldest-first for context building
        return [CopilotMessage.model_validate(row) for row in reversed(result.data)]

    # ── Thread summary ────────────────────────────────────────

    async def get_thread_summary(self, thread_id: UUID) -> str | None:
        result = (
            await self._db.table("copilot_thread_summaries")
            .select("summary")
            .eq("thread_id", str(thread_id))
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        return result.data[0]["summary"]

    async def upsert_thread_summary(
        self,
        thread_id: UUID,
        summary: str,
        through_message_id: UUID | None = None,
        token_count: int | None = None,
    ) -> None:
        data: dict[str, Any] = {
            "thread_id": str(thread_id),
            "summary":   summary,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if through_message_id is not None:
            data["summarized_through_message_id"] = str(through_message_id)
        if token_count is not None:
            data["token_count"] = token_count

        await (
            self._db.table("copilot_thread_summaries")
            .upsert(data, on_conflict="thread_id")
            .execute()
        )

    # ── Attachments ───────────────────────────────────────────

    async def create_attachment(
        self,
        thread_id: UUID,
        project_id: UUID,
        user_id: UUID,
        attachment_type: CopilotAttachmentType,
        filename: str,
        storage_path: str,
        mime_type: str | None = None,
        file_size_bytes: int | None = None,
        context_metadata: dict[str, Any] | None = None,
    ) -> CopilotAttachment:
        now = datetime.now(timezone.utc).isoformat()
        data: dict[str, Any] = {
            "id":              str(uuid4()),
            "thread_id":       str(thread_id),
            "project_id":      str(project_id),
            "user_id":         str(user_id),
            "attachment_type": attachment_type.value,
            "filename":        filename,
            "storage_path":    storage_path,
            "created_at":      now,
        }
        if mime_type is not None:
            data["mime_type"] = mime_type
        if file_size_bytes is not None:
            data["file_size_bytes"] = file_size_bytes
        if context_metadata is not None:
            data["context_metadata"] = context_metadata

        result = await self._db.table("copilot_attachments").insert(data).execute()
        return CopilotAttachment.model_validate(result.data[0])

    async def link_attachment_to_message(
        self, attachment_id: UUID, message_id: UUID
    ) -> None:
        await (
            self._db.table("copilot_attachments")
            .update({"message_id": str(message_id)})
            .eq("id", str(attachment_id))
            .execute()
        )

    async def get_attachments_for_thread(
        self, thread_id: UUID
    ) -> list[CopilotAttachment]:
        result = (
            await self._db.table("copilot_attachments")
            .select("*")
            .eq("thread_id", str(thread_id))
            .order("created_at", desc=False)
            .execute()
        )
        return [CopilotAttachment.model_validate(row) for row in result.data]

    async def get_attachments_for_message(
        self, message_id: UUID
    ) -> list[CopilotAttachment]:
        result = (
            await self._db.table("copilot_attachments")
            .select("*")
            .eq("message_id", str(message_id))
            .execute()
        )
        return [CopilotAttachment.model_validate(row) for row in result.data]

    # ── Project metadata helpers (used by context builder) ────

    async def get_geometry_snapshot_for_model_ref(
        self, model_ref_id: UUID
    ) -> dict[str, Any] | None:
        """
        Returns the most recent geometry snapshot for a given speckle_model_ref_id.
        Prefers project-level snapshots (run_id IS NULL) which are created directly
        from model sync — these exist even when no precheck run has been completed.
        Falls back to run-scoped snapshots if no project-level one exists.
        """
        # Try project-level snapshot first (run_id IS NULL)
        result = (
            await self._db.table("geometry_snapshots")
            .select("id, project_id, run_id, speckle_model_ref_id, metrics, raw_metrics, created_at")
            .eq("speckle_model_ref_id", str(model_ref_id))
            .is_("run_id", "null")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0]

        # Fall back to any snapshot (including run-scoped) for this model ref
        result = (
            await self._db.table("geometry_snapshots")
            .select("id, project_id, run_id, speckle_model_ref_id, metrics, raw_metrics, created_at")
            .eq("speckle_model_ref_id", str(model_ref_id))
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return result.data[0] if result.data else None

    async def get_active_model_ref_for_project(
        self, project_id: UUID
    ) -> dict[str, Any] | None:
        """
        Returns the active speckle_model_ref row for the project by reading
        projects.active_model_ref_id. Returns None if no active model is set.
        """
        project_result = (
            await self._db.table("projects")
            .select("active_model_ref_id")
            .eq("id", str(project_id))
            .limit(1)
            .execute()
        )
        if not project_result.data:
            return None
        ref_id = project_result.data[0].get("active_model_ref_id")
        if not ref_id:
            return None
        ref_result = (
            await self._db.table("speckle_model_refs")
            .select("id, project_id, stream_id, branch_name, version_id, model_name, synced_at")
            .eq("id", str(ref_id))
            .limit(1)
            .execute()
        )
        return ref_result.data[0] if ref_result.data else None

    async def get_project_metadata(self, project_id: UUID) -> dict[str, Any] | None:
        result = (
            await self._db.table("projects")
            .select("id, name, created_at, updated_at, speckle_stream_id")
            .eq("id", str(project_id))
            .limit(1)
            .execute()
        )
        return result.data[0] if result.data else None

    async def get_run_summary(self, run_id: UUID) -> dict[str, Any] | None:
        result = (
            await self._db.table("precheck_runs")
            .select("id, name, status, readiness_score, created_at, updated_at")
            .eq("id", str(run_id))
            .limit(1)
            .execute()
        )
        return result.data[0] if result.data else None

    async def get_recent_runs(
        self, project_id: UUID, limit: int = 5
    ) -> list[dict[str, Any]]:
        result = (
            await self._db.table("precheck_runs")
            .select("id, name, status, readiness_score, created_at")
            .eq("project_id", str(project_id))
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data

    async def get_compliance_issues(
        self, run_id: UUID, limit: int = 20
    ) -> list[dict[str, Any]]:
        # Columns per migration 20240301000001:
        #   title, summary, explanation, severity, status, metric_key,
        #   actual_value, expected_value, expected_min, expected_max, units,
        #   affected_object_ids, rule_id, check_id
        result = (
            await self._db.table("compliance_issues")
            .select(
                "id, severity, status, metric_key, "
                "title, summary, explanation, "
                "actual_value, expected_value, expected_min, expected_max, units, "
                "affected_object_ids, rule_id"
            )
            .eq("run_id", str(run_id))
            .order("severity", desc=False)
            .limit(limit)
            .execute()
        )
        log.debug(
            "get_compliance_issues: run=%s rows=%d",
            run_id, len(result.data),
        )
        # Normalise into a stable tool-friendly shape
        return [
            {
                "id":                  row["id"],
                "severity":            row["severity"],
                "status":              row["status"],
                "metric_key":          row.get("metric_key"),
                "title":               row["title"],
                "summary":             row["summary"],
                "explanation":         row.get("explanation"),
                "actual_value":        row.get("actual_value"),
                "expected_value":      row.get("expected_value"),
                "expected_min":        row.get("expected_min"),
                "expected_max":        row.get("expected_max"),
                "units":               row.get("units"),
                "affected_object_ids": row.get("affected_object_ids") or [],
            }
            for row in result.data
        ]

    async def get_reviewed_rules(
        self, project_id: UUID, limit: int = 30
    ) -> list[dict[str, Any]]:
        """
        Returns approved/reviewed rules for the project.

        Columns per migration 20240301000001 + 20240301000010:
          id, rule_code, title, description, metric_key, operator,
          value_number, value_min, value_max, units,
          status, source_kind, is_authoritative, is_recommended,
          confidence, extraction_notes, condition_text, exception_text
        """
        result = (
            await self._db.table("extracted_rules")
            .select(
                "id, rule_code, title, description, metric_key, operator, "
                "value_number, value_min, value_max, units, "
                "status, source_kind, is_authoritative, is_recommended, "
                "confidence, extraction_notes"
            )
            .eq("project_id", str(project_id))
            .in_("status", ["approved", "reviewed", "auto_approved"])
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        log.debug(
            "get_reviewed_rules: project=%s rows=%d",
            project_id, len(result.data),
        )
        # Normalise into a stable tool-friendly shape
        return [
            {
                "id":               row["id"],
                "rule_code":        row.get("rule_code"),
                "title":            row.get("title"),
                "description":      row.get("description"),
                "metric_key":       row.get("metric_key"),
                "operator":         row.get("operator"),
                "value_number":     row.get("value_number"),
                "value_min":        row.get("value_min"),
                "value_max":        row.get("value_max"),
                "units":            row.get("units"),
                "status":           row.get("status"),
                "source_kind":      row.get("source_kind"),
                "is_authoritative": row.get("is_authoritative"),
                "is_recommended":   row.get("is_recommended"),
                "confidence":       row.get("confidence"),
                "extraction_notes": row.get("extraction_notes"),
            }
            for row in result.data
        ]

    async def get_uploaded_documents(
        self, project_id: UUID, limit: int = 10
    ) -> list[dict[str, Any]]:
        # Columns per migration 20240301000001:
        #   file_name (not filename), uploaded_at (not created_at),
        #   document_type, mime_type, jurisdiction_code, storage_path
        result = (
            await self._db.table("uploaded_documents")
            .select("id, file_name, document_type, mime_type, uploaded_at, jurisdiction_code")
            .eq("project_id", str(project_id))
            .order("uploaded_at", desc=True)
            .limit(limit)
            .execute()
        )
        log.debug(
            "get_uploaded_documents: project=%s rows=%d",
            project_id, len(result.data),
        )
        return [
            {
                "id":               row["id"],
                "file_name":        row["file_name"],
                "document_type":    row.get("document_type"),
                "mime_type":        row.get("mime_type"),
                "uploaded_at":      row["uploaded_at"],
                "jurisdiction_code": row.get("jurisdiction_code"),
            }
            for row in result.data
        ]

    async def get_checklist_items(
        self, run_id: UUID, limit: int = 50
    ) -> list[dict[str, Any]]:
        # Columns per migration 20240301000001:
        #   category, title, description, required, resolved
        result = (
            await self._db.table("permit_checklist_items")
            .select("id, category, title, description, required, resolved")
            .eq("run_id", str(run_id))
            .order("category", desc=False)
            .limit(limit)
            .execute()
        )
        log.debug(
            "get_checklist_items: run=%s rows=%d",
            run_id, len(result.data),
        )
        return [
            {
                "id":          row["id"],
                "category":    row["category"],
                "title":       row["title"],
                "description": row.get("description"),
                "required":    row.get("required", True),
                "resolved":    row.get("resolved", False),
            }
            for row in result.data
        ]

    async def search_document_chunks(
        self,
        project_id: UUID,
        query_embedding: list[float] | None,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Vector similarity search over project document chunks.

        TODO: This requires pgvector to be active and an embedding column on
        document_chunks. Currently returns an empty list as a safe fallback.
        When the embedding pipeline is ready:
          1. Enable pgvector extension in Supabase
          2. Add `embedding vector(1536)` column to document_chunks
          3. Replace the stub below with an RPC call to match_document_chunks()
        """
        if query_embedding is None:
            log.debug("search_document_chunks: no embedding provided, skipping retrieval")
            return []

        # TODO: Replace with actual pgvector similarity search
        # result = await self._db.rpc(
        #     "match_document_chunks",
        #     {
        #         "query_embedding": query_embedding,
        #         "match_project_id": str(project_id),
        #         "match_count": top_k,
        #     },
        # ).execute()
        # return result.data

        log.debug(
            "search_document_chunks: pgvector retrieval not yet active for project %s",
            project_id,
        )
        return []
