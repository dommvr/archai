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
    ProjectExtractionOptions,
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

    async def update_run_run_metrics(
        self, run_id: UUID, run_metrics: dict[str, Any]
    ) -> PrecheckRun:
        """Persists run-specific computed metrics (FAR, lot_coverage_pct) to the run row."""
        result = (
            await self._db.table("precheck_runs")
            .update({"run_metrics": run_metrics})
            .eq("id", str(run_id))
            .execute()
        )
        return PrecheckRun.model_validate(result.data[0])

    async def mark_run_stale(self, project_id: UUID, changed_at: str) -> None:
        """
        Sets is_stale=True and rules_changed_at=changed_at on all non-failed,
        non-evaluating runs for the project that have been evaluated at least once
        (readiness_score IS NOT NULL).  Draft runs that were never evaluated are
        left untouched — they are not "stale", they are simply not yet run.
        """
        await (
            self._db.table("precheck_runs")
            .update({"is_stale": True, "rules_changed_at": changed_at})
            .eq("project_id", str(project_id))
            .not_.is_("readiness_score", "null")
            .neq("status", "failed")
            .neq("status", "evaluating")
            .neq("status", "generating_report")
            .execute()
        )

    async def clear_run_stale(self, run_id: UUID) -> None:
        """Resets is_stale to False at the start of a new evaluation."""
        await (
            self._db.table("precheck_runs")
            .update({"is_stale": False})
            .eq("id", str(run_id))
            .execute()
        )

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

    async def get_site_contexts_for_project(self, project_id: UUID) -> list[SiteContext]:
        """Returns all site contexts belonging to the project, newest first."""
        result = (
            await self._db.table("site_contexts")
            .select("*")
            .eq("project_id", str(project_id))
            .order("created_at", desc=True)
            .execute()
        )
        return [SiteContext.model_validate(r) for r in (result.data or [])]

    async def get_default_site_context_for_project(
        self, project_id: UUID
    ) -> SiteContext | None:
        """
        Returns the default SiteContext for a project by reading
        projects.default_site_context_id and joining site_contexts.
        Returns None if no default is set or the context no longer exists.
        """
        project_result = (
            await self._db.table("projects")
            .select("default_site_context_id")
            .eq("id", str(project_id))
            .single()
            .execute()
        )
        if not project_result.data:
            return None
        ctx_id = project_result.data.get("default_site_context_id")
        if not ctx_id:
            return None
        ctx_result = (
            await self._db.table("site_contexts")
            .select("*")
            .eq("id", str(ctx_id))
            .single()
            .execute()
        )
        if not ctx_result.data:
            return None
        return SiteContext.model_validate(ctx_result.data)

    async def set_default_site_context(
        self, project_id: UUID, site_context_id: UUID
    ) -> None:
        """Persists the default site context pointer on the project row."""
        await (
            self._db.table("projects")
            .update({"default_site_context_id": str(site_context_id)})
            .eq("id", str(project_id))
            .execute()
        )

    async def get_default_site_context_id_for_project(
        self, project_id: UUID
    ) -> UUID | None:
        """Returns the raw default_site_context_id UUID for a project, or None."""
        result = (
            await self._db.table("projects")
            .select("default_site_context_id")
            .eq("id", str(project_id))
            .single()
            .execute()
        )
        if not result.data:
            return None
        raw = result.data.get("default_site_context_id")
        return UUID(raw) if raw else None

    async def delete_site_context(self, site_context_id: UUID) -> None:
        """
        Hard-deletes a site_contexts row.

        Foreign key constraints use ON DELETE SET NULL so:
          - precheck_runs.site_context_id → automatically cleared
          - projects.default_site_context_id → automatically cleared
        No manual cleanup is required.
        """
        await (
            self._db.table("site_contexts")
            .delete()
            .eq("id", str(site_context_id))
            .execute()
        )

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

    async def list_model_refs_for_project(
        self, project_id: UUID
    ) -> list[SpeckleModelRef]:
        """Returns all Speckle model refs for a project, newest first."""
        result = (
            await self._db.table("speckle_model_refs")
            .select("*")
            .eq("project_id", str(project_id))
            .order("selected_at", desc=True)
            .execute()
        )
        return [SpeckleModelRef.model_validate(r) for r in (result.data or [])]

    async def get_active_model_ref_for_project(
        self, project_id: UUID
    ) -> SpeckleModelRef | None:
        """
        Returns the active SpeckleModelRef for a project by reading
        projects.active_model_ref_id and joining speckle_model_refs.
        Returns None if no active model is set or the ref no longer exists.
        """
        project_result = (
            await self._db.table("projects")
            .select("active_model_ref_id")
            .eq("id", str(project_id))
            .single()
            .execute()
        )
        if not project_result.data:
            return None
        ref_id = project_result.data.get("active_model_ref_id")
        if not ref_id:
            return None
        ref_result = (
            await self._db.table("speckle_model_refs")
            .select("*")
            .eq("id", str(ref_id))
            .single()
            .execute()
        )
        if not ref_result.data:
            return None
        return SpeckleModelRef.model_validate(ref_result.data)

    async def set_active_model_ref(
        self, project_id: UUID, model_ref_id: UUID
    ) -> None:
        """Persists the active SpeckleModelRef pointer on the project row."""
        await (
            self._db.table("projects")
            .update({"active_model_ref_id": str(model_ref_id)})
            .eq("id", str(project_id))
            .execute()
        )

    async def clear_active_model_ref_if_matches(
        self, project_id: UUID, model_ref_id: UUID
    ) -> None:
        """
        If the project's active_model_ref_id matches model_ref_id, set it to NULL.
        Called before deleting a model ref to prevent a dangling FK.
        """
        await (
            self._db.table("projects")
            .update({"active_model_ref_id": None})
            .eq("id", str(project_id))
            .eq("active_model_ref_id", str(model_ref_id))
            .execute()
        )

    async def delete_model_ref(self, model_ref_id: UUID) -> None:
        """Deletes a SpeckleModelRef row. Caller must clear FK references first."""
        await (
            self._db.table("speckle_model_refs")
            .delete()
            .eq("id", str(model_ref_id))
            .execute()
        )

    async def get_model_ref(self, model_ref_id: UUID) -> SpeckleModelRef | None:
        """Fetches a single SpeckleModelRef by ID."""
        result = (
            await self._db.table("speckle_model_refs")
            .select("*")
            .eq("id", str(model_ref_id))
            .maybe_single()
            .execute()
        )
        if not result.data:
            return None
        return SpeckleModelRef.model_validate(result.data)

    async def get_model_ref_by_stream_version(
        self, project_id: UUID, stream_id: str, version_id: str
    ) -> SpeckleModelRef | None:
        """
        Returns an existing SpeckleModelRef for (project_id, stream_id, version_id),
        or None if no matching row exists.

        Used by sync routes to prevent duplicate rows when the same Speckle
        stream version is registered more than once for a project.
        """
        result = (
            await self._db.table("speckle_model_refs")
            .select("*")
            .eq("project_id", str(project_id))
            .eq("stream_id", stream_id)
            .eq("version_id", version_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return SpeckleModelRef.model_validate(rows[0]) if rows else None

    async def set_model_ref_synced_at(
        self, model_ref_id: UUID, synced_at: datetime
    ) -> None:
        """Stamps synced_at on a SpeckleModelRef after successful geometry derivation."""
        await (
            self._db.table("speckle_model_refs")
            .update({"synced_at": synced_at.isoformat()})
            .eq("id", str(model_ref_id))
            .execute()
        )

    # ── uploaded_documents ────────────────────────────────────

    async def get_documents_for_run(self, run_id: UUID) -> list[UploadedDocument]:
        result = (
            await self._db.table("uploaded_documents")
            .select("*")
            .eq("run_id", str(run_id))
            .execute()
        )
        return [UploadedDocument.model_validate(r) for r in (result.data or [])]

    async def get_documents_for_project(self, project_id: UUID) -> list[UploadedDocument]:
        """Returns all documents for a project regardless of run association, newest first."""
        result = (
            await self._db.table("uploaded_documents")
            .select("*")
            .eq("project_id", str(project_id))
            .order("uploaded_at", desc=True)
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

    async def associate_documents_to_run(
        self, run_id: UUID, document_ids: list[UUID]
    ) -> None:
        """
        Stamps run_id on uploaded_documents rows that currently have no run association
        (run_id IS NULL). Rows already associated to a run are intentionally left unchanged
        — they may belong to a different run's ingestion history.

        Called by the ingest-documents route so that extract_rules_from_chunks
        can find these documents via get_documents_for_run().
        """
        if not document_ids:
            return
        ids = [str(d) for d in document_ids]
        await (
            self._db.table("uploaded_documents")
            .update({"run_id": str(run_id)})
            .in_("id", ids)
            .is_("run_id", "null")
            .execute()
        )

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

    async def update_chunk_embeddings_bulk(
        self, updates: list[dict[str, Any]]
    ) -> None:
        """
        Persists embeddings for a batch of document_chunks.

        Each item in `updates` must have:
          { "id": str(uuid), "embedding": list[float] }

        Uses individual UPDATEs via the Supabase client (no bulk-update API).
        Embeddings are stored as the native vector(1536) type added in
        migration 20240301000016.
        """
        for item in updates:
            await (
                self._db.table("document_chunks")
                .update({"embedding": item["embedding"]})
                .eq("id", item["id"])
                .execute()
            )
        log.debug("update_chunk_embeddings_bulk: updated %d rows", len(updates))

    async def get_chunks_without_embeddings(
        self,
        project_id: UUID,
        limit: int = 500,
    ) -> list[DocumentChunk]:
        """
        Returns chunks that have no embedding yet, scoped to a project.

        Used by the backfill script to identify which chunks still need
        to be embedded after migration 20240301000016.
        Joins through uploaded_documents to filter by project_id.
        """
        # Fetch document IDs for this project
        doc_result = (
            await self._db.table("uploaded_documents")
            .select("id")
            .eq("project_id", str(project_id))
            .execute()
        )
        if not doc_result.data:
            return []
        doc_ids = [r["id"] for r in doc_result.data]

        result = (
            await self._db.table("document_chunks")
            .select("*")
            .in_("document_id", doc_ids)
            .is_("embedding", "null")
            .order("document_id, chunk_index")
            .limit(limit)
            .execute()
        )
        return [DocumentChunk.model_validate(r) for r in (result.data or [])]

    async def get_chunk_by_id(self, chunk_id: UUID) -> DocumentChunk | None:
        """Returns a single chunk by primary key."""
        result = (
            await self._db.table("document_chunks")
            .select("*")
            .eq("id", str(chunk_id))
            .maybe_single()
            .execute()
        )
        return DocumentChunk.model_validate(result.data) if result.data else None

    async def get_chunks_for_project(
        self,
        project_id: UUID,
        limit: int = 2000,
    ) -> list[DocumentChunk]:
        """
        Returns all chunks for a project (regardless of embedding status).

        Used by re-embed operations that target an entire project.
        Joins through uploaded_documents to resolve project_id.
        The default limit of 2 000 protects against accidental full-table
        scans on very large projects; pass a higher value explicitly when
        processing in batches.
        """
        doc_result = (
            await self._db.table("uploaded_documents")
            .select("id")
            .eq("project_id", str(project_id))
            .execute()
        )
        if not doc_result.data:
            return []
        doc_ids = [r["id"] for r in doc_result.data]

        result = (
            await self._db.table("document_chunks")
            .select("*")
            .in_("document_id", doc_ids)
            .order("document_id, chunk_index")
            .limit(limit)
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
        Returns rules for all documents associated with this run PLUS any
        manual rules (source_kind='manual') scoped to the same project.

        Manual rules have document_id=NULL so they never appear in a
        document_id IN (...) query. They are fetched separately and merged.
        Excludes rejected rules from both sets.
        """
        docs = await self.get_documents_for_run(run_id)

        # Fetch document-linked extracted rules (empty list when no docs yet).
        doc_rules: list[ExtractedRule] = []
        if docs:
            doc_ids = [str(d.id) for d in docs]
            result = (
                await self._db.table("extracted_rules")
                .select("*")
                .in_("document_id", doc_ids)
                .neq("status", RuleStatus.REJECTED.value)
                .execute()
            )
            doc_rules = [ExtractedRule.model_validate(r) for r in (result.data or [])]

        # Fetch manual rules for the project (always present, regardless of docs).
        run = await self.get_run(run_id)
        if run is None:
            return doc_rules
        manual_result = (
            await self._db.table("extracted_rules")
            .select("*")
            .eq("project_id", str(run.project_id))
            .eq("source_kind", "manual")
            .neq("status", RuleStatus.REJECTED.value)
            .execute()
        )
        manual_rules = [ExtractedRule.model_validate(r) for r in (manual_result.data or [])]

        # Merge, preserving order: extracted rules first, then manual.
        # Dedup by id in case a manual rule somehow shares an id (shouldn't happen).
        seen: set[str] = set()
        combined: list[ExtractedRule] = []
        for rule in doc_rules + manual_rules:
            if str(rule.id) not in seen:
                seen.add(str(rule.id))
                combined.append(rule)
        return combined

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

    async def get_snapshot_for_model_ref(
        self, model_ref_id: UUID
    ) -> GeometrySnapshot | None:
        """Return the most recent geometry snapshot for a project-level model ref."""
        result = (
            await self._db.table("geometry_snapshots")
            .select("*")
            .eq("speckle_model_ref_id", str(model_ref_id))
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return GeometrySnapshot.model_validate(rows[0]) if rows else None

    async def delete_snapshots_for_model_ref(self, model_ref_id: UUID) -> None:
        """Remove all project-level snapshots for a model ref (run_id IS NULL)."""
        await (
            self._db.table("geometry_snapshots")
            .delete()
            .eq("speckle_model_ref_id", str(model_ref_id))
            .is_("run_id", "null")
            .execute()
        )

    async def delete_all_snapshots_for_model_ref(self, model_ref_id: UUID) -> None:
        """
        Remove ALL geometry snapshots that reference this model ref —
        both project-level (run_id IS NULL) and run-scoped.

        Called before deleting a speckle_model_refs row to satisfy the
        ON DELETE RESTRICT FK on geometry_snapshots.speckle_model_ref_id.

        Geometry snapshots are derived data (re-derivable from Speckle),
        so hard-deleting them is safe.  The precheck_runs rows that pointed
        to this model ref are preserved; their speckle_model_ref_id becomes
        NULL via ON DELETE SET NULL at the DB level.
        """
        await (
            self._db.table("geometry_snapshots")
            .delete()
            .eq("speckle_model_ref_id", str(model_ref_id))
            .execute()
        )

    async def copy_model_snapshot_to_run(
        self, model_ref_id: UUID, run_id: UUID
    ) -> GeometrySnapshot | None:
        """
        Copy the latest project-level snapshot (run_id IS NULL) for a model ref
        into a new run-scoped snapshot so Tool 1 can display metrics immediately
        after a user assigns an existing project model to a run.

        Returns the new run-scoped snapshot, or None if no source snapshot exists.
        """
        source = await self.get_snapshot_for_model_ref(model_ref_id)
        if source is None:
            return None

        # Delete any existing run-scoped snapshot so we don't accumulate duplicates
        await self._db.table("geometry_snapshots").delete().eq(
            "run_id", str(run_id)
        ).execute()

        now = datetime.now(timezone.utc).isoformat()
        row = {
            "id":                   str(uuid4()),
            "project_id":           str(source.project_id),
            "run_id":               str(run_id),
            "speckle_model_ref_id": str(model_ref_id),
            "site_boundary":        None,
            "building_footprints":  source.building_footprints,
            "floors":               source.floors,
            "metrics":              [m.model_dump() for m in source.metrics],
            "raw_metrics":          source.raw_metrics,
            "created_at":           now,
        }
        result = await self._db.table("geometry_snapshots").insert(row).execute()
        return GeometrySnapshot.model_validate(result.data[0])

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

    # ── extracted_rules (v2 additions) ────────────────────────

    async def get_rule_by_id(self, rule_id: UUID) -> ExtractedRule | None:
        result = (
            await self._db.table("extracted_rules")
            .select("*")
            .eq("id", str(rule_id))
            .maybe_single()
            .execute()
        )
        return ExtractedRule.model_validate(result.data) if result.data else None

    async def get_rules_for_project(
        self, project_id: UUID
    ) -> list[ExtractedRule]:
        """
        Returns all non-rejected rules for a project regardless of run.
        Used by compliance engine and rule management panel.
        """
        result = (
            await self._db.table("extracted_rules")
            .select("*")
            .eq("project_id", str(project_id))
            .neq("status", RuleStatus.REJECTED.value)
            .order("created_at", desc=True)
            .execute()
        )
        return [ExtractedRule.model_validate(r) for r in (result.data or [])]

    async def update_rule(
        self, rule_id: UUID, patch: dict[str, Any]
    ) -> ExtractedRule:
        """
        Applies a partial patch to an extracted_rules row.
        Caller is responsible for providing only valid column names.
        """
        result = (
            await self._db.table("extracted_rules")
            .update(_to_json_safe(patch))
            .eq("id", str(rule_id))
            .execute()
        )
        return ExtractedRule.model_validate(result.data[0])

    async def hard_delete_rule(self, rule_id: UUID) -> None:
        """
        Hard-deletes a single rule row by id.
        Only called for manual rules — extracted rules are rejected (soft), not deleted.
        Caller is responsible for ensuring the rule is manual before calling this.
        """
        await (
            self._db.table("extracted_rules")
            .delete()
            .eq("id", str(rule_id))
            .execute()
        )

    async def get_rules_in_conflict_group(
        self, conflict_group_id: UUID
    ) -> list[ExtractedRule]:
        """Returns all rules sharing a conflict_group_id."""
        result = (
            await self._db.table("extracted_rules")
            .select("*")
            .eq("conflict_group_id", str(conflict_group_id))
            .neq("status", RuleStatus.REJECTED.value)
            .execute()
        )
        return [ExtractedRule.model_validate(r) for r in (result.data or [])]

    async def get_authoritative_rules_for_run(
        self, run_id: UUID
    ) -> list[ExtractedRule]:
        """
        Returns only authoritative rules for the run's documents.
        Authority hierarchy (checked in the compliance engine):
          1. manual rules (is_authoritative=True by creation)
          2. approved rules (status in {approved, reviewed})
          3. auto_approved rules (when project option permits)
        """
        docs = await self.get_documents_for_run(run_id)
        if not docs:
            return []
        doc_ids = [str(d.id) for d in docs]

        result = (
            await self._db.table("extracted_rules")
            .select("*")
            .in_("document_id", doc_ids)
            .eq("is_authoritative", True)
            .neq("status", RuleStatus.REJECTED.value)
            .execute()
        )
        extracted = [
            ExtractedRule.model_validate(r) for r in (result.data or [])
        ]

        # Also fetch manual rules for this project (no document_id)
        project_result = (
            await self._db.table("extracted_rules")
            .select("*")
            .eq("project_id", str(
                (await self.get_run(run_id)).project_id  # type: ignore[union-attr]
            ))
            .eq("source_kind", "manual")
            .eq("is_authoritative", True)
            .neq("status", RuleStatus.REJECTED.value)
            .execute()
        )
        manual = [
            ExtractedRule.model_validate(r)
            for r in (project_result.data or [])
        ]

        seen: set[str] = set()
        combined: list[ExtractedRule] = []
        for rule in extracted + manual:
            if str(rule.id) not in seen:
                seen.add(str(rule.id))
                combined.append(rule)
        return combined

    async def create_manual_rule(
        self, row: dict[str, Any]
    ) -> ExtractedRule:
        """Inserts a user-authored manual rule row."""
        safe = _to_json_safe(row)
        result = await self._db.table("extracted_rules").insert(safe).execute()
        return ExtractedRule.model_validate(result.data[0])

    async def clear_conflict_group_recommendations(
        self, conflict_group_id: UUID
    ) -> None:
        """
        Resets is_recommended=False for all rules in a conflict group
        before setting a new recommended winner.
        """
        await (
            self._db.table("extracted_rules")
            .update({"is_recommended": False})
            .eq("conflict_group_id", str(conflict_group_id))
            .execute()
        )

    # ── project_extraction_options ─────────────────────────────

    async def get_extraction_options(
        self, project_id: UUID
    ) -> ProjectExtractionOptions | None:
        result = (
            await self._db.table("project_extraction_options")
            .select("*")
            .eq("project_id", str(project_id))
            .maybe_single()
            .execute()
        )
        if not result.data:
            return None
        return ProjectExtractionOptions.model_validate(result.data)

    async def upsert_extraction_options(
        self, project_id: UUID, patch: dict[str, Any]
    ) -> ProjectExtractionOptions:
        """
        Creates or updates the extraction options row for a project.
        On insert, defaults from the DB schema apply for unset fields.
        """
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "project_id": str(project_id),
            "updated_at": now,
            **{k: v for k, v in patch.items() if v is not None},
        }
        result = (
            await self._db.table("project_extraction_options")
            .upsert(row, on_conflict="project_id")
            .execute()
        )
        return ProjectExtractionOptions.model_validate(result.data[0])
