"""
backend/app/api/routes/precheck.py

Thin route handlers for Tool 1 (precheck) endpoints.

Business logic lives in services/. Handlers are responsible for:
  1. Validating the JWT (via Depends(get_current_user))
  2. Parsing the request body
  3. Delegating to the correct service(s)
  4. Updating run status via RealtimePublisher at each pipeline step
  5. Returning typed responses

Next.js integration mapping:
  Route                                         ← Next.js seam (app/api/agents/[tool]/route.ts)
  ─────────────────────────────────────────
  POST /precheck/runs                           ← action: "create_run"
  GET  /precheck/runs/{id}                      ← GET /api/agents/precheck?runId=
  POST /precheck/runs/{id}/ingest-site          ← action: "ingest_site"
  POST /precheck/runs/{id}/ingest-documents     ← action: "ingest_documents"
  POST /precheck/runs/{id}/extract-rules        ← action: "extract_rules"
  POST /precheck/runs/{id}/sync-speckle-model   ← action: "sync_speckle_model"
  POST /precheck/runs/{id}/evaluate             ← action: "evaluate_compliance"
  GET  /projects/{id}/precheck-runs             ← GET /api/agents/precheck?projectId=
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from app.core.auth import AuthenticatedUser
from app.core.dependencies import (
    get_compliance_engine,
    get_current_user,
    get_document_ingestion,
    get_realtime_publisher,
    get_repository,
    get_rule_extraction,
    get_site_data_provider,
    get_speckle_service,
)
from app.core.schemas import (
    AsyncActionResponse,
    CreatePrecheckRunRequest,
    GetRunDetailsResponse,
    IngestDocumentsRequest,
    IngestSiteRequest,
    OkResponse,
    PrecheckRun,
    PrecheckRunStatus,
    ProjectRunsResponse,
    RegisterDocumentRequest,
    ScoreContext,
    SyncSpeckleModelRequest,
    UploadedDocument,
)
from app.repositories.precheck_repository import PrecheckRepository
from app.services.compliance_engine import ComplianceEngineService
from app.services.document_ingestion import DocumentIngestionService
from app.services.realtime_publisher import RealtimePublisher
from app.services.rule_extraction import RuleExtractionService
from app.services.site_data_provider import SiteDataProviderService
from app.services.speckle_service import SpeckleService

log = logging.getLogger(__name__)
router = APIRouter(prefix="/precheck", tags=["precheck"])


# ════════════════════════════════════════════════════════════
# POST /precheck/runs
# Create a new precheck run.
# ════════════════════════════════════════════════════════════

@router.post("/runs", response_model=PrecheckRun, status_code=status.HTTP_201_CREATED)
async def create_run(
    body:    CreatePrecheckRunRequest,
    user:    AuthenticatedUser        = Depends(get_current_user),
    repo:    PrecheckRepository       = Depends(get_repository),
) -> PrecheckRun:
    """
    Creates a new precheck run record.
    Maps to: lib/precheck/api.ts → createPrecheckRun()
    """
    run = await repo.create_run(
        project_id=body.project_id,
        created_by=UUID(user.user_id),
    )
    log.info("Created run %s for project=%s by user=%s", run.id, run.project_id, user.user_id)
    return run


# ════════════════════════════════════════════════════════════
# GET /precheck/runs/{run_id}
# Fetch full run details (run + site context + issues + checklist).
# ════════════════════════════════════════════════════════════

@router.get("/runs/{run_id}", response_model=GetRunDetailsResponse)
async def get_run_details(
    run_id: UUID,
    user:   AuthenticatedUser  = Depends(get_current_user),
    repo:   PrecheckRepository = Depends(get_repository),
) -> GetRunDetailsResponse:
    """
    Returns the full run details bundle.
    Maps to: lib/precheck/api.ts → getRunDetails()
    """
    run = await _require_run(repo, run_id)

    site_context = (
        await repo.get_site_context(run.site_context_id)
        if run.site_context_id else None
    )
    model_ref = (
        await repo.get_speckle_model_ref(run.speckle_model_ref_id)
        if run.speckle_model_ref_id else None
    )
    snapshot   = await repo.get_latest_geometry_snapshot(run_id)
    documents  = await repo.get_documents_for_run(run_id)
    rules      = await repo.get_rules_for_run(run_id)
    issues     = await repo.get_issues_for_run(run_id)
    checklist  = await repo.get_checklist_for_run(run_id)

    return GetRunDetailsResponse(
        run=run,
        site_context=site_context,
        model_ref=model_ref,
        geometry_snapshot=snapshot,
        documents=documents,
        rules=rules,
        issues=issues,
        checklist=checklist,
    )


# ════════════════════════════════════════════════════════════
# POST /precheck/runs/{run_id}/ingest-site
# Geocode address, fetch parcel/zoning data, persist SiteContext.
# ════════════════════════════════════════════════════════════

@router.post("/runs/{run_id}/ingest-site", response_model=PrecheckRun)
async def ingest_site(
    run_id:   UUID,
    body:     IngestSiteRequest,
    user:     AuthenticatedUser      = Depends(get_current_user),
    repo:     PrecheckRepository     = Depends(get_repository),
    svc:      SiteDataProviderService = Depends(get_site_data_provider),
    pub:      RealtimePublisher       = Depends(get_realtime_publisher),
) -> PrecheckRun:
    """
    Maps to: lib/precheck/api.ts → ingestSite()
    """
    run = await _require_run(repo, run_id)

    await pub.publish_run_status(run_id, PrecheckRunStatus.INGESTING_SITE, "Fetching site data")

    try:
        site_context = await svc.normalize_site_context(
            run_id=run_id,
            project_id=run.project_id,
            request=body,
        )
        updated = await repo.update_run_site_context(run_id, site_context.id)
        await pub.publish_run_status(run_id, PrecheckRunStatus.CREATED, "Site context saved")
        return updated

    except Exception as exc:
        await pub.publish_run_status(run_id, PrecheckRunStatus.FAILED, error_message=str(exc))
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


# ════════════════════════════════════════════════════════════
# POST /precheck/runs/{run_id}/ingest-documents
# Associate pre-uploaded documents with this run and process them.
# ════════════════════════════════════════════════════════════

@router.post("/runs/{run_id}/ingest-documents", response_model=AsyncActionResponse)
async def ingest_documents(
    run_id:          UUID,
    body:            IngestDocumentsRequest,
    background_tasks: BackgroundTasks,
    user:            AuthenticatedUser       = Depends(get_current_user),
    repo:            PrecheckRepository      = Depends(get_repository),
    svc:             DocumentIngestionService = Depends(get_document_ingestion),
    pub:             RealtimePublisher        = Depends(get_realtime_publisher),
) -> AsyncActionResponse:
    """
    Triggers text extraction and chunking for the given document IDs.
    Processing runs in a BackgroundTask (non-blocking).
    Maps to: lib/precheck/api.ts → ingestDocuments()
    """
    run = await _require_run(repo, run_id)
    await pub.publish_run_status(run_id, PrecheckRunStatus.INGESTING_DOCS, "Processing documents")

    async def _task() -> None:
        try:
            docs = await repo.get_documents_by_ids(body.document_ids)
            for doc in docs:
                await svc.process_document(doc)
            await pub.publish_run_status(run_id, PrecheckRunStatus.CREATED, "Documents processed")
        except Exception as exc:
            log.exception("Document ingestion failed for run=%s", run_id)
            await pub.publish_run_status(run_id, PrecheckRunStatus.FAILED, error_message=str(exc))

    background_tasks.add_task(_task)

    return AsyncActionResponse(
        run_id=run_id,
        status=PrecheckRunStatus.INGESTING_DOCS,
        message=f"Processing {len(body.document_ids)} document(s) in background",
    )


# ════════════════════════════════════════════════════════════
# POST /precheck/runs/{run_id}/register-document
# Record metadata for a file already uploaded to Supabase Storage.
# project_id is resolved from the run record server-side.
# ════════════════════════════════════════════════════════════

@router.post("/runs/{run_id}/register-document", response_model=UploadedDocument)
async def register_document(
    run_id: UUID,
    body:   RegisterDocumentRequest,
    user:   AuthenticatedUser       = Depends(get_current_user),
    repo:   PrecheckRepository      = Depends(get_repository),
    svc:    DocumentIngestionService = Depends(get_document_ingestion),
) -> UploadedDocument:
    """
    Registers a document that the browser already uploaded to Supabase Storage.
    Maps to: lib/precheck/api.ts → registerDocument()
    """
    run = await _require_run(repo, run_id)
    doc = await svc.create_uploaded_document(
        project_id=run.project_id,
        run_id=run_id,
        file_name=body.file_name,
        mime_type=body.mime_type,
        document_type=body.document_type.value,
        storage_path=body.storage_path,
    )
    log.info(
        "Registered document: id=%s name=%r for run=%s",
        doc.id, doc.file_name, run_id,
    )
    return doc


# ════════════════════════════════════════════════════════════
# POST /precheck/runs/{run_id}/extract-rules
# Run AI rule extraction over all ingested document chunks.
# ════════════════════════════════════════════════════════════

@router.post("/runs/{run_id}/extract-rules", response_model=PrecheckRun)
async def extract_rules(
    run_id: UUID,
    user:   AuthenticatedUser    = Depends(get_current_user),
    repo:   PrecheckRepository   = Depends(get_repository),
    svc:    RuleExtractionService = Depends(get_rule_extraction),
    pub:    RealtimePublisher     = Depends(get_realtime_publisher),
) -> PrecheckRun:
    """
    Runs rule extraction synchronously and returns the updated run.

    V1 uses regex pattern matching (fast, ~ms). Running inline ensures that
    the caller's subsequent refreshRunState() sees a fully-settled DB state.

    When this is replaced with a LangGraph agent (slow, async), restore the
    BackgroundTasks pattern and return AsyncActionResponse instead.

    Maps to: lib/precheck/api.ts → extractRules()
    LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
    """
    await _require_run(repo, run_id)
    await pub.publish_run_status(run_id, PrecheckRunStatus.EXTRACTING_RULES, "Extracting rules")

    try:
        rules = await svc.extract_rules_from_chunks(run_id=run_id)
        updated = await repo.update_run_status(
            run_id=run_id,
            status=PrecheckRunStatus.CREATED,
            current_step=f"Extracted {len(rules)} rules",
        )
        log.info("Rule extraction complete for run=%s, %d rules extracted", run_id, len(rules))
        return updated
    except Exception as exc:
        log.exception("Rule extraction failed for run=%s", run_id)
        await pub.publish_run_status(run_id, PrecheckRunStatus.FAILED, error_message=str(exc))
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


# ════════════════════════════════════════════════════════════
# POST /precheck/runs/{run_id}/sync-speckle-model
# Register a Speckle model version and derive the geometry snapshot.
# ════════════════════════════════════════════════════════════

@router.post("/runs/{run_id}/sync-speckle-model", response_model=AsyncActionResponse)
async def sync_speckle_model(
    run_id:           UUID,
    body:             SyncSpeckleModelRequest,
    background_tasks: BackgroundTasks,
    user:             AuthenticatedUser = Depends(get_current_user),
    repo:             PrecheckRepository = Depends(get_repository),
    svc:              SpeckleService    = Depends(get_speckle_service),
    pub:              RealtimePublisher = Depends(get_realtime_publisher),
) -> AsyncActionResponse:
    """
    Creates a SpeckleModelRef and derives a geometry snapshot (background).
    Maps to: lib/precheck/api.ts → syncSpeckleModel()

    SPECKLE VIEWER WILL BE MOUNTED HERE
    """
    run = await _require_run(repo, run_id)
    await pub.publish_run_status(run_id, PrecheckRunStatus.SYNCING_MODEL, "Syncing Speckle model")

    async def _task() -> None:
        try:
            # Idempotency: remove any previous snapshot for this run before creating
            # a new one. Prevents orphaned snapshots when the user re-syncs a model.
            await repo.delete_snapshots_for_run(run_id)

            model_ref = await svc.create_speckle_model_ref(run.project_id, body)
            await repo.update_run_speckle_ref(run_id, model_ref.id)

            await pub.publish_run_status(
                run_id, PrecheckRunStatus.COMPUTING_METRICS, "Deriving geometry metrics"
            )

            updated_run = await repo.get_run(run_id)
            # Fetch site context so derive_geometry_snapshot can compute FAR
            # (FAR = GFA / parcel_area_m2; parcel area lives in site_context, not the model).
            site_context = (
                await repo.get_site_context(updated_run.site_context_id)
                if updated_run and updated_run.site_context_id else None
            )
            if updated_run:
                await svc.derive_geometry_snapshot(updated_run, model_ref, site_context)

            await pub.publish_run_status(run_id, PrecheckRunStatus.CREATED, "Model synced")
        except Exception as exc:
            log.exception("Speckle sync failed for run=%s", run_id)
            await pub.publish_run_status(run_id, PrecheckRunStatus.FAILED, error_message=str(exc))

    background_tasks.add_task(_task)

    return AsyncActionResponse(
        run_id=run_id,
        status=PrecheckRunStatus.SYNCING_MODEL,
        message="Speckle model sync started in background",
    )


# ════════════════════════════════════════════════════════════
# POST /precheck/runs/{run_id}/evaluate
# Run compliance evaluation + generate score, issues, checklist.
# ════════════════════════════════════════════════════════════

@router.post("/runs/{run_id}/evaluate", response_model=AsyncActionResponse)
async def evaluate_compliance(
    run_id:           UUID,
    background_tasks: BackgroundTasks,
    user:             AuthenticatedUser      = Depends(get_current_user),
    repo:             PrecheckRepository     = Depends(get_repository),
    engine:           ComplianceEngineService = Depends(get_compliance_engine),
    pub:              RealtimePublisher       = Depends(get_realtime_publisher),
) -> AsyncActionResponse:
    """
    Runs the full compliance pipeline (background task):
      1. select_applicable_rules
      2. resolve_metrics (from geometry snapshot)
      3. evaluate_rules  (deterministic — NO LLM)
      4. generate_issues
      5. generate_readiness_score
      6. generate_checklist

    Maps to: lib/precheck/api.ts → evaluateCompliance()
    LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER (for explanation generation in Step 4)
    """
    run = await _require_run(repo, run_id)
    await pub.publish_run_status(run_id, PrecheckRunStatus.EVALUATING, "Running compliance checks")

    async def _task() -> None:
        try:
            # Idempotency: clear any evaluation data from a previous run of this
            # endpoint. compliance_checks has a unique(run_id, rule_id) constraint,
            # so re-evaluation without this cleanup would raise a constraint violation.
            # Order: checklist → issues → checks (issues.check_id uses ON DELETE SET NULL,
            # so deleting checks first is safe, but deleting issues first is cleaner).
            await repo.delete_checklist_for_run(run_id)
            await repo.delete_issues_for_run(run_id)
            await repo.delete_checks_for_run(run_id)

            # ── Fetch context data ────────────────────────────
            site_context = (
                await repo.get_site_context(run.site_context_id) if run.site_context_id else None
            )
            snapshot = await repo.get_latest_geometry_snapshot(run_id)

            # ── Select applicable rules ────────────────────────
            rules = await engine.select_applicable_rules(run_id, site_context)

            # ── Build metric map ───────────────────────────────
            metric_map = {}
            if snapshot:
                metric_map = await engine.resolve_metrics(snapshot)

            # ── Deterministic evaluation ───────────────────────
            checks = await engine.evaluate_rules(run_id, rules, metric_map, snapshot)

            # ── Generate issues ────────────────────────────────
            rules_by_id = {r.id: r for r in rules}
            issues = await engine.generate_issues(run_id, checks, rules_by_id)

            # ── Score context ──────────────────────────────────
            has_reviewed = any(r.status.value == "reviewed" for r in rules)
            score_ctx = ScoreContext(
                has_parcel_data=bool(site_context and site_context.parcel_area_m2),
                has_zoning_data=bool(site_context and site_context.zoning_district),
                has_reviewed_rules=has_reviewed,
                has_geometry_snapshot=bool(snapshot),
            )

            # ── Readiness score ────────────────────────────────
            await pub.publish_run_status(run_id, PrecheckRunStatus.GENERATING_REPORT, "Scoring")
            score = await engine.generate_readiness_score(run_id, issues, score_ctx)

            # ── Permit checklist ───────────────────────────────
            await engine.generate_checklist(
                run=run,
                site_context=site_context,
                issues=issues,
                has_model=snapshot is not None,
                has_reviewed_rules=has_reviewed,
            )

            await pub.publish_run_status(run_id, PrecheckRunStatus.COMPLETED)
            await pub.publish_score(run_id, score)
            log.info("Evaluation complete for run=%s, score=%d, issues=%d", run_id, score, len(issues))

        except Exception as exc:
            log.exception("Evaluation failed for run=%s", run_id)
            await pub.publish_run_status(run_id, PrecheckRunStatus.FAILED, error_message=str(exc))

    background_tasks.add_task(_task)

    return AsyncActionResponse(
        run_id=run_id,
        status=PrecheckRunStatus.EVALUATING,
        message="Compliance evaluation started in background",
    )


# ════════════════════════════════════════════════════════════
# DELETE /precheck/documents/{document_id}
# Remove a document: cascade rules → chunks → row → storage.
# ════════════════════════════════════════════════════════════

@router.delete("/documents/{document_id}", response_model=OkResponse)
async def delete_document(
    document_id: UUID,
    user:  AuthenticatedUser        = Depends(get_current_user),
    repo:  PrecheckRepository       = Depends(get_repository),
    svc:   DocumentIngestionService = Depends(get_document_ingestion),
) -> OkResponse:
    """
    Deletes a single uploaded document and all derived data.
    Storage cleanup is best-effort (does not fail if file is missing).
    Maps to: lib/precheck/api.ts → deleteDocument()
    """
    doc = await repo.get_document_by_id(document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document {document_id} not found",
        )

    # Cascade: rules → chunks → document row
    await repo.delete_all_rules_for_document(document_id)
    await repo.delete_chunks_for_document(document_id)
    await repo.delete_document(document_id)

    # Best-effort storage cleanup
    await svc.delete_from_storage(doc.storage_path)

    log.info("Deleted document %s (%r)", document_id, doc.file_name)
    return OkResponse()


# ════════════════════════════════════════════════════════════
# DELETE /precheck/runs/{run_id}
# Remove a run and all run-scoped records.
# ════════════════════════════════════════════════════════════

@router.delete("/runs/{run_id}", response_model=OkResponse)
async def delete_run(
    run_id: UUID,
    user:   AuthenticatedUser        = Depends(get_current_user),
    repo:   PrecheckRepository       = Depends(get_repository),
    svc:    DocumentIngestionService = Depends(get_document_ingestion),
) -> OkResponse:
    """
    Deletes a precheck run and all dependent records in order:
    checklist → issues → checks → snapshots →
    (per document: rules → chunks → storage) → documents → run row.

    site_contexts and speckle_model_refs are intentionally preserved
    (they are project-scoped and may be shared across runs).

    Maps to: lib/precheck/api.ts → deleteRun()
    """
    await _require_run(repo, run_id)

    # Run-scoped compliance data first
    await repo.delete_checklist_for_run(run_id)
    await repo.delete_issues_for_run(run_id)
    await repo.delete_checks_for_run(run_id)
    await repo.delete_snapshots_for_run(run_id)

    # Per-document: rules → chunks → storage (best-effort)
    docs = await repo.get_documents_for_run(run_id)
    for doc in docs:
        await repo.delete_all_rules_for_document(doc.id)
        await repo.delete_chunks_for_document(doc.id)
        await svc.delete_from_storage(doc.storage_path)

    # Document rows, then the run row
    await repo.delete_documents_for_run(run_id)
    await repo.delete_run(run_id)

    log.info("Deleted run %s (%d documents)", run_id, len(docs))
    return OkResponse()


# ════════════════════════════════════════════════════════════
# GET /projects/{project_id}/precheck-runs
# List all runs for a project (newest first).
# ════════════════════════════════════════════════════════════

project_router = APIRouter(prefix="/projects", tags=["precheck"])

@project_router.get("/{project_id}/precheck-runs", response_model=ProjectRunsResponse)
async def list_project_runs(
    project_id: UUID,
    user:       AuthenticatedUser  = Depends(get_current_user),
    repo:       PrecheckRepository = Depends(get_repository),
) -> ProjectRunsResponse:
    """
    Maps to: lib/precheck/api.ts → GET /api/agents/precheck?projectId=
    """
    runs = await repo.list_runs_for_project(project_id)
    return ProjectRunsResponse(runs=runs, total=len(runs))


# ── Internal helpers ──────────────────────────────────────────

async def _require_run(repo: PrecheckRepository, run_id: UUID) -> PrecheckRun:
    """Fetches a run or raises 404."""
    run = await repo.get_run(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Precheck run {run_id} not found",
        )
    return run
