"""
backend/app/repositories/precheck_repository.py

Thin data-access layer for all Tool 1 (precheck) Supabase operations.

Rules:
- No business logic here — only CRUD and query patterns.
- All methods are async.
- The Supabase service-role client bypasses RLS (authentication
  is enforced upstream in the route layer via JWT validation).
- Column names are snake_case (matching the SQL migration).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from supabase import AsyncClient

from app.core.schemas import (
    CheckResultStatus,
    ComplianceCheck,
    ComplianceIssue,
    DocumentChunk,
    ExtractedRule,
    GeometrySnapshot,
    IssueSeverity,
    PermitChecklistItem,
    PrecheckRun,
    PrecheckRunStatus,
    RuleStatus,
    SiteContext,
    SpeckleModelRef,
    UploadedDocument,
)

log = logging.getLogger(__name__)


def _to_json_safe(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {key: _to_json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_to_json_safe(item) for item in value]
    return value


class PrecheckRepository:
    def __init__(self, client: AsyncClient) -> None:
        self._db = client

    # ── precheck_runs ─────────────────────────────────────────

    async def create_run(
        self,
        project_id: UUID,
        created_by: UUID,
        name: str | None = None,
    ) -> PrecheckRun:
        now = datetime.now(timezone.utc).isoformat()
        data: dict[str, Any] = {
            "id":         str(uuid4()),
            "project_id": str(project_id),
            "created_by": str(created_by),
            "status":     PrecheckRunStatus.CREATED.value,
            "created_at": now,
            "updated_at": now,
        }
        if name is not None:
            data["name"] = name
        result = await self._db.table("precheck_runs").insert(data).execute()
        return PrecheckRun.model_validate(result.data[0])

    async def get_run(self, run_id: UUID) -> PrecheckRun | None:
        result = (
            await self._db.table("precheck_runs")
            .select("*")
            .eq("id", str(run_id))
            .maybe_single()
            .execute()
        )
        return PrecheckRun.model_validate(result.data) if result.data else None

    async def list_runs_for_project(self, project_id: UUID) -> list[PrecheckRun]:
        result = (
            await self._db.table("precheck_runs")
            .select("*")
            .eq("project_id", str(project_id))
            .order("created_at", desc=True)
            .execute()
        )
        return [PrecheckRun.model_validate(r) for r in (result.data or [])]

    async def update_run_status(
        self,
        run_id: UUID,
        status: PrecheckRunStatus,
        current_step: str | None = None,
        error_message: str | None = None,
    ) -> PrecheckRun:
        patch: dict[str, Any] = {"status": status.value}
        if current_step is not None:
            patch["current_step"] = current_step
        # Always clear a previous failure message when transitioning to a non-failed state.
        # This prevents stale error_message from a prior run phase staying visible after recovery.
        if status != PrecheckRunStatus.FAILED:
            patch["error_message"] = None
        # An explicit caller-supplied error_message always wins.
        if error_message is not None:
            patch["error_message"] = error_message
        result = (
            await self._db.table("precheck_runs")
            .update(patch)
            .eq("id", str(run_id))
            .execute()
        )
        return PrecheckRun.model_validate(result.data[0])

    async def update_run_site_context(
        self, run_id: UUID, site_context_id: UUID
    ) -> PrecheckRun:
        result = (
            await self._db.table("precheck_runs")
            .update({"site_context_id": str(site_context_id)})
            .eq("id", str(run_id))
            .execute()
        )
        return PrecheckRun.model_validate(result.data[0])

    async def update_run_speckle_ref(
        self, run_id: UUID, speckle_model_ref_id: UUID
    ) -> PrecheckRun:
        result = (
            await self._db.table("precheck_runs")
            .update({"speckle_model_ref_id": str(speckle_model_ref_id)})
            .eq("id", str(run_id))
            .execute()
        )
        return PrecheckRun.model_validate(result.data[0])

    async def update_run_readiness_score(
        self, run_id: UUID, score: int
    ) -> PrecheckRun:
        result = (
            await self._db.table("precheck_runs")
            .update({"readiness_score": score})
            .eq("id", str(run_id))
            .execute()
        )
        return PrecheckRun.model_validate(result.data[0])

    # ── site_contexts ─────────────────────────────────────────

    async def upsert_site_context(self, row: dict[str, Any]) -> SiteContext:
        result = (
            await self._db.table("site_contexts")
            .upsert(row, on_conflict="id")
            .execute()
        )
        return SiteContext.model_validate(result.data[0])

    async def get_site_context(self, site_context_id: UUID) -> SiteContext | None:
        result = (
            await self._db.table("site_contexts")
            .select("*")
            .eq("id", str(site_context_id))
            .maybe_single()
            .execute()
        )
        return SiteContext.model_validate(result.data) if result.data else None

    # ── speckle_model_refs ────────────────────────────────────

    async def create_speckle_model_ref(self, row: dict[str, Any]) -> SpeckleModelRef:
        result = await self._db.table("speckle_model_refs").insert(row).execute()
        return SpeckleModelRef.model_validate(result.data[0])

    async def get_speckle_model_ref(self, ref_id: UUID) -> SpeckleModelRef | None:
        result = (
            await self._db.table("speckle_model_refs")
            .select("*")
            .eq("id", str(ref_id))
            .maybe_single()
            .execute()
        )
        return SpeckleModelRef.model_validate(result.data) if result.data else None

    # ── uploaded_documents ────────────────────────────────────

    async def get_documents_for_run(self, run_id: UUID) -> list[UploadedDocument]:
        result = (
            await self._db.table("uploaded_documents")
            .select("*")
            .eq("run_id", str(run_id))
            .execute()
        )
        return [UploadedDocument.model_validate(r) for r in (result.data or [])]

    async def get_documents_by_ids(self, document_ids: list[UUID]) -> list[UploadedDocument]:
        ids = [str(d) for d in document_ids]
        result = (
            await self._db.table("uploaded_documents")
            .select("*")
            .in_("id", ids)
            .execute()
        )
        return [UploadedDocument.model_validate(r) for r in (result.data or [])]

    async def create_uploaded_document(self, row: dict[str, Any]) -> UploadedDocument:
        result = await self._db.table("uploaded_documents").insert(row).execute()
        return UploadedDocument.model_validate(result.data[0])

    async def get_document_by_id(self, document_id: UUID) -> UploadedDocument | None:
        result = (
            await self._db.table("uploaded_documents")
            .select("*")
            .eq("id", str(document_id))
            .maybe_single()
            .execute()
        )
        return UploadedDocument.model_validate(result.data) if result.data else None

    async def delete_document(self, document_id: UUID) -> None:
        await (
            self._db.table("uploaded_documents")
            .delete()
            .eq("id", str(document_id))
            .execute()
        )

    async def delete_documents_for_run(self, run_id: UUID) -> None:
        await (
            self._db.table("uploaded_documents")
            .delete()
            .eq("run_id", str(run_id))
            .execute()
        )

    # ── document_chunks ───────────────────────────────────────

    async def create_chunks_bulk(self, rows: list[dict[str, Any]]) -> list[DocumentChunk]:
        result = await self._db.table("document_chunks").insert(rows).execute()
        return [DocumentChunk.model_validate(r) for r in (result.data or [])]

    async def delete_chunks_for_document(self, document_id: UUID) -> None:
        await (
            self._db.table("document_chunks")
            .delete()
            .eq("document_id", str(document_id))
            .execute()
        )

    async def get_chunks_for_document(self, document_id: UUID) -> list[DocumentChunk]:
        result = (
            await self._db.table("document_chunks")
            .select("*")
            .eq("document_id", str(document_id))
            .order("chunk_index")
            .execute()
        )
        return [DocumentChunk.model_validate(r) for r in (result.data or [])]

    async def get_chunks_for_run(self, run_id: UUID) -> list[DocumentChunk]:
        """Fetches all chunks belonging to documents associated with a run."""
        docs = await self.get_documents_for_run(run_id)
        if not docs:
            return []
        doc_ids = [str(d.id) for d in docs]
        result = (
            await self._db.table("document_chunks")
            .select("*")
            .in_("document_id", doc_ids)
            .order("document_id, chunk_index")
            .execute()
        )
        return [DocumentChunk.model_validate(r) for r in (result.data or [])]

    # ── extracted_rules ───────────────────────────────────────

    async def create_rules_bulk(self, rows: list[dict[str, Any]]) -> list[ExtractedRule]:
        safe_rows = [_to_json_safe(row) for row in rows]
        result = await self._db.table("extracted_rules").insert(safe_rows).execute()
        return [ExtractedRule.model_validate(r) for r in (result.data or [])]

    async def delete_all_rules_for_document(self, document_id: UUID) -> None:
        """
        Deletes ALL rules (all statuses) for a single document.
        Called when the document itself is being deleted — there is nothing to preserve.
        """
        await (
            self._db.table("extracted_rules")
            .delete()
            .eq("document_id", str(document_id))
            .execute()
        )

    async def delete_draft_rules_for_documents(self, document_ids: list[str]) -> None:
        """
        Deletes all draft-status rules for the given document IDs.
        Called before re-extraction to keep the operation idempotent.
        Reviewed and rejected rules are preserved intentionally.
        """
        if not document_ids:
            return
        await (
            self._db.table("extracted_rules")
            .delete()
            .in_("document_id", document_ids)
            .eq("status", RuleStatus.DRAFT.value)
            .execute()
        )

    async def get_rules_for_run(self, run_id: UUID) -> list[ExtractedRule]:
        """
        Returns rules for all documents associated with this run.
        Excludes rejected rules.
        """
        docs = await self.get_documents_for_run(run_id)
        if not docs:
            return []
        doc_ids = [str(d.id) for d in docs]
        result = (
            await self._db.table("extracted_rules")
            .select("*")
            .in_("document_id", doc_ids)
            .neq("status", RuleStatus.REJECTED.value)
            .execute()
        )
        return [ExtractedRule.model_validate(r) for r in (result.data or [])]

    async def update_rule_status(self, rule_id: UUID, status: RuleStatus) -> ExtractedRule:
        result = (
            await self._db.table("extracted_rules")
            .update({"status": status.value})
            .eq("id", str(rule_id))
            .execute()
        )
        return ExtractedRule.model_validate(result.data[0])

    # ── geometry_snapshots ────────────────────────────────────

    async def create_geometry_snapshot(self, row: dict[str, Any]) -> GeometrySnapshot:
        result = await self._db.table("geometry_snapshots").insert(row).execute()
        return GeometrySnapshot.model_validate(result.data[0])

    async def get_latest_geometry_snapshot(self, run_id: UUID) -> GeometrySnapshot | None:
        result = (
            await self._db.table("geometry_snapshots")
            .select("*")
            .eq("run_id", str(run_id))
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return GeometrySnapshot.model_validate(rows[0]) if rows else None

    # ── compliance_checks ─────────────────────────────────────

    async def create_checks_bulk(self, rows: list[dict[str, Any]]) -> list[ComplianceCheck]:
        result = await self._db.table("compliance_checks").insert(rows).execute()
        return [ComplianceCheck.model_validate(r) for r in (result.data or [])]

    async def get_checks_for_run(self, run_id: UUID) -> list[ComplianceCheck]:
        result = (
            await self._db.table("compliance_checks")
            .select("*")
            .eq("run_id", str(run_id))
            .execute()
        )
        return [ComplianceCheck.model_validate(r) for r in (result.data or [])]

    # ── compliance_issues ─────────────────────────────────────

    async def create_issues_bulk(self, rows: list[dict[str, Any]]) -> list[ComplianceIssue]:
        result = await self._db.table("compliance_issues").insert(rows).execute()
        return [ComplianceIssue.model_validate(r) for r in (result.data or [])]

    async def get_issues_for_run(self, run_id: UUID) -> list[ComplianceIssue]:
        result = (
            await self._db.table("compliance_issues")
            .select("*")
            .eq("run_id", str(run_id))
            .order("severity")           # critical → info via enum order
            .execute()
        )
        return [ComplianceIssue.model_validate(r) for r in (result.data or [])]

    # ── permit_checklist_items ────────────────────────────────

    async def create_checklist_items_bulk(
        self, rows: list[dict[str, Any]]
    ) -> list[PermitChecklistItem]:
        result = await self._db.table("permit_checklist_items").insert(rows).execute()
        return [PermitChecklistItem.model_validate(r) for r in (result.data or [])]

    async def get_checklist_for_run(self, run_id: UUID) -> list[PermitChecklistItem]:
        result = (
            await self._db.table("permit_checklist_items")
            .select("*")
            .eq("run_id", str(run_id))
            .execute()
        )
        return [PermitChecklistItem.model_validate(r) for r in (result.data or [])]

    async def mark_checklist_item_resolved(
        self, item_id: UUID, resolved: bool = True
    ) -> PermitChecklistItem:
        result = (
            await self._db.table("permit_checklist_items")
            .update({"resolved": resolved})
            .eq("id", str(item_id))
            .execute()
        )
        return PermitChecklistItem.model_validate(result.data[0])

    # ── run-scoped cascade deletes ────────────────────────────
    # Called in sequence by the delete_run endpoint. Order matters:
    # run-scoped compliance data first, then document-scoped data, then the run row.

    async def delete_checks_for_run(self, run_id: UUID) -> None:
        await (
            self._db.table("compliance_checks")
            .delete()
            .eq("run_id", str(run_id))
            .execute()
        )

    async def delete_issues_for_run(self, run_id: UUID) -> None:
        await (
            self._db.table("compliance_issues")
            .delete()
            .eq("run_id", str(run_id))
            .execute()
        )

    async def delete_checklist_for_run(self, run_id: UUID) -> None:
        await (
            self._db.table("permit_checklist_items")
            .delete()
            .eq("run_id", str(run_id))
            .execute()
        )

    async def delete_snapshots_for_run(self, run_id: UUID) -> None:
        await (
            self._db.table("geometry_snapshots")
            .delete()
            .eq("run_id", str(run_id))
            .execute()
        )

    async def delete_run(self, run_id: UUID) -> None:
        """Deletes the precheck_run row. Call only after all dependent rows are gone."""
        await (
            self._db.table("precheck_runs")
            .delete()
            .eq("id", str(run_id))
            .execute()
        )
