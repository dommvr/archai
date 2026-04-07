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
  POST /precheck/runs/{id}/assign-model-ref     ← action: "assign_model_ref"
  POST /precheck/runs/{id}/assign-site-context  ← action: "assign_site_context"
  POST /precheck/runs/{id}/compute-run-metrics  ← action: "compute_run_metrics"
  POST /precheck/runs/{id}/evaluate             ← action: "evaluate_compliance"
  GET  /projects/{id}/precheck-runs             ← GET /api/agents/precheck?projectId=
  GET  /projects/{id}/documents                 ← GET /api/agents/precheck?projectId=&scope=documents
  POST /projects/{id}/documents                 ← action: "register_project_document"
  GET  /projects/{id}/model-refs                ← GET /api/agents/precheck?projectId=&scope=model_refs
  POST /projects/{id}/model-refs                ← action: "sync_project_model"
  GET    /projects/{id}/active-model             ← GET /api/agents/precheck?projectId=&scope=active_model
  POST   /projects/{id}/active-model             ← action: "set_active_project_model"
  DELETE /projects/{id}/model-refs/{ref_id}                  ← action: "delete_project_model"
  GET    /projects/{id}/model-refs/{ref_id}/snapshot         ← GET /api/agents/precheck?projectId=&modelRefId=&scope=model_snapshot
  GET    /projects/{id}/site-contexts            ← GET /api/agents/precheck?projectId=&scope=site_contexts
  POST   /projects/{id}/site-contexts            ← action: "create_project_site_context"
  DELETE /projects/{id}/site-contexts/{ctx_id}  ← action: "delete_project_site_context"
  GET    /projects/{id}/default-site-context    ← GET /api/agents/precheck?projectId=&scope=default_site_context
  POST   /projects/{id}/default-site-context    ← action: "set_default_site_context"
  GET    /projects/{id}/rules                   ← GET /api/agents/precheck?projectId=&scope=rules
  POST   /projects/{id}/rules                   ← action: "create_manual_rule"
  GET    /projects/{id}/extraction-options      ← GET /api/agents/precheck?projectId=&scope=extraction_options
  PUT    /projects/{id}/extraction-options      ← action: "set_extraction_options"
  POST   /precheck/rules/{rule_id}/approve      ← action: "approve_rule"
  POST   /precheck/rules/{rule_id}/reject       ← action: "reject_rule"
  PATCH  /precheck/rules/{rule_id}              ← action: "update_manual_rule"
  DELETE /precheck/rules/{rule_id}              ← action: "delete_manual_rule"
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import Response

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
    AssignModelRefRequest,
    AssignSiteContextRequest,
    AsyncActionResponse,
    CheckResultStatus,
    ChecklistSummarySection,
    ComplianceResultRow,
    ComplianceSummarySection,
    CreateManualRuleRequest,
    CreatePrecheckRunRequest,
    CreateProjectSiteContextRequest,
    ExtractedRule,
    GeometrySnapshot,
    GetRunDetailsResponse,
    IngestDocumentsRequest,
    IngestSiteRequest,
    IssueSeverity,
    IssueSummarySection,
    OkResponse,
    PrecheckRun,
    PrecheckRunSummaryResponse,
    PrecheckRunStatus,
    ProjectDocumentsResponse,
    ProjectExtractionOptions,
    ProjectModelRefsResponse,
    ProjectRunsResponse,
    ProjectSiteContextsResponse,
    RegisterDocumentRequest,
    RegisterProjectDocumentRequest,
    RunReportData,
    ScoreContext,
    SetActiveProjectModelRequest,
    SetDefaultSiteContextRequest,
    SetProjectExtractionOptionsRequest,
    SiteContext,
    SpeckleModelRef,
    SyncProjectModelRequest,
    SyncSpeckleModelRequest,
    UpdateManualRuleRequest,
    UploadedDocument,
)
from app.repositories.precheck_repository import PrecheckRepository
from app.services.compliance_engine import ComplianceEngineService, compute_readiness_breakdown
from app.services.document_ingestion import DocumentIngestionService
from app.services.realtime_publisher import RealtimePublisher
from app.services.report_generator import generate_report_pdf
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
        name=body.name,
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

    # Build readiness breakdown — same data as the evaluate pipeline uses, but
    # computed fresh on every GET so the label + reasons are always consistent
    # with the current issues list without requiring a re-run.
    _AUTHORITATIVE_STATUSES = {"reviewed", "approved", "auto_approved", "manual"}
    authoritative_rules = [r for r in rules if r.status.value in _AUTHORITATIVE_STATUSES]
    has_reviewed = bool(authoritative_rules)
    score_ctx = ScoreContext(
        has_parcel_data=bool(site_context and site_context.parcel_area_m2),
        has_zoning_data=bool(site_context and site_context.zoning_district),
        has_reviewed_rules=has_reviewed,
        has_geometry_snapshot=bool(snapshot),
    )
    resolved_count = sum(1 for c in checklist if c.resolved)
    breakdown = compute_readiness_breakdown(
        issues=issues,
        context=score_ctx,
        authoritative_rule_count=len(authoritative_rules),
        checklist_total=len(checklist),
        checklist_resolved=resolved_count,
    )

    return GetRunDetailsResponse(
        run=run,
        site_context=site_context,
        model_ref=model_ref,
        geometry_snapshot=snapshot,
        documents=documents,
        rules=rules,
        issues=issues,
        checklist=checklist,
        readiness_breakdown=breakdown,
    )


# ════════════════════════════════════════════════════════════
# GET /precheck/runs/{run_id}/summary
# Lightweight summary for the right panel and Copilot tool use.
# Returns readiness breakdown, checklist counts, issue counts —
# without sending the full rules/documents/snapshot payload.
# ════════════════════════════════════════════════════════════

@router.get("/runs/{run_id}/summary", response_model=PrecheckRunSummaryResponse)
async def get_run_summary(
    run_id: UUID,
    user:   AuthenticatedUser  = Depends(get_current_user),
    repo:   PrecheckRepository = Depends(get_repository),
) -> PrecheckRunSummaryResponse:
    """
    Returns a compact summary of a run suitable for the metrics panel and
    Copilot get_metrics / get_checklist tools.
    Maps to: lib/precheck/api.ts → getRunSummary()
    """
    run = await _require_run(repo, run_id)

    site_context = (
        await repo.get_site_context(run.site_context_id)
        if run.site_context_id else None
    )
    snapshot  = await repo.get_latest_geometry_snapshot(run_id)
    rules     = await repo.get_rules_for_run(run_id)
    issues    = await repo.get_issues_for_run(run_id)
    checklist = await repo.get_checklist_for_run(run_id)

    _AUTHORITATIVE_STATUSES = {"reviewed", "approved", "auto_approved", "manual"}
    authoritative_rules = [r for r in rules if r.status.value in _AUTHORITATIVE_STATUSES]
    has_reviewed = bool(authoritative_rules)
    score_ctx = ScoreContext(
        has_parcel_data=bool(site_context and site_context.parcel_area_m2),
        has_zoning_data=bool(site_context and site_context.zoning_district),
        has_reviewed_rules=has_reviewed,
        has_geometry_snapshot=bool(snapshot),
    )
    resolved_count = sum(1 for c in checklist if c.resolved)
    breakdown = compute_readiness_breakdown(
        issues=issues,
        context=score_ctx,
        authoritative_rule_count=len(authoritative_rules),
        checklist_total=len(checklist),
        checklist_resolved=resolved_count,
    )

    return PrecheckRunSummaryResponse(
        run_id=run_id,
        run_status=run.status,
        readiness=breakdown,
        authoritative_rule_count=len(authoritative_rules),
        checklist_total=len(checklist),
        checklist_resolved=resolved_count,
        issue_total=len(issues),
        issue_fail_count=sum(
            1 for i in issues if i.status == CheckResultStatus.FAIL
        ),
        issue_warning_count=sum(
            1 for i in issues
            if i.status in {CheckResultStatus.AMBIGUOUS, CheckResultStatus.MISSING_INPUT}
        ),
        issue_missing_data_count=sum(
            1 for i in issues if i.status == CheckResultStatus.MISSING_INPUT
        ),
        is_stale=run.is_stale,
        rules_changed_at=run.rules_changed_at,
    )


# ════════════════════════════════════════════════════════════
# GET /precheck/runs/{run_id}/report-data
# Full structured report payload — same data drives on-screen
# summary and the PDF export.  No LLM, fully deterministic.
# ════════════════════════════════════════════════════════════

_METRIC_LABELS_REPORT: dict[str, str] = {
    "building_height_m":       "Building height",
    "front_setback_m":         "Front setback",
    "side_setback_left_m":     "Left side setback",
    "side_setback_right_m":    "Right side setback",
    "rear_setback_m":          "Rear setback",
    "far":                     "Floor area ratio (FAR)",
    "lot_coverage_pct":        "Lot coverage",
    "parking_spaces_required": "Required parking spaces",
    "parking_spaces_provided": "Provided parking spaces",
    "gross_floor_area_m2":     "Gross floor area",
}

_AUTHORITATIVE_STATUSES_REPORT = {"reviewed", "approved", "auto_approved", "manual"}


async def _build_report_data(
    run_id: UUID,
    repo: PrecheckRepository,
) -> RunReportData:
    """
    Shared helper used by both the JSON report-data endpoint and the PDF
    endpoint, so they always produce identical content.
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
    rules     = await repo.get_rules_for_run(run_id)
    checks    = await repo.get_checks_for_run(run_id)
    issues    = await repo.get_issues_for_run(run_id)
    checklist = await repo.get_checklist_for_run(run_id)

    # ── Authoritative rules (mirrors authority filter in get_run_details) ──
    authoritative_rules = [
        r for r in rules if r.status.value in _AUTHORITATIVE_STATUSES_REPORT
    ]
    has_reviewed = bool(authoritative_rules)

    # ── Readiness breakdown ────────────────────────────────────────────────
    snapshot = await repo.get_latest_geometry_snapshot(run_id)
    score_ctx = ScoreContext(
        has_parcel_data=bool(site_context and site_context.parcel_area_m2),
        has_zoning_data=bool(site_context and site_context.zoning_district),
        has_reviewed_rules=has_reviewed,
        has_geometry_snapshot=bool(snapshot),
    )
    resolved_count = sum(1 for c in checklist if c.resolved)
    breakdown = compute_readiness_breakdown(
        issues=issues,
        context=score_ctx,
        authoritative_rule_count=len(authoritative_rules),
        checklist_total=len(checklist),
        checklist_resolved=resolved_count,
    )

    # ── Build rule lookup for check→rule join ──────────────────────────────
    rules_by_id = {r.id: r for r in rules}

    # ── Compliance result rows (one per check) ─────────────────────────────
    compliance_results: list[ComplianceResultRow] = []
    for chk in checks:
        rule = rules_by_id.get(chk.rule_id)
        metric_key_str = chk.metric_key.value if chk.metric_key else None
        compliance_results.append(ComplianceResultRow(
            check_id=chk.id,
            rule_id=chk.rule_id,
            rule_code=rule.rule_code if rule else None,
            rule_title=rule.title if rule else None,
            metric_key=chk.metric_key,
            metric_label=_METRIC_LABELS_REPORT.get(metric_key_str, metric_key_str) if metric_key_str else None,
            status=chk.status,
            actual_value=chk.actual_value,
            expected_value=chk.expected_value,
            expected_min=chk.expected_min,
            expected_max=chk.expected_max,
            units=chk.units,
            explanation=chk.explanation,
            source_kind=rule.source_kind if rule else None,
            citation_section=(
                rule.citation.section if rule and rule.citation else None
            ),
            citation_page=(
                rule.citation.page if rule and rule.citation else None
            ),
            description=rule.description if rule else None,
            condition_text=rule.condition_text if rule else None,
            exception_text=rule.exception_text if rule else None,
            normalization_note=rule.normalization_note if rule else None,
            citation_snippet=(
                rule.citation.snippet if rule and rule.citation else None
            ),
        ))

    # Sort: failed first, then ambiguous/missing_input, then pass
    _STATUS_ORDER = {
        CheckResultStatus.FAIL:          0,
        CheckResultStatus.AMBIGUOUS:     1,
        CheckResultStatus.MISSING_INPUT: 2,
        CheckResultStatus.PASS:          3,
        CheckResultStatus.NOT_APPLICABLE:4,
    }
    compliance_results.sort(key=lambda r: _STATUS_ORDER.get(r.status, 9))

    # ── Compliance summary counts ──────────────────────────────────────────
    compliance_summary = ComplianceSummarySection(
        total=len(checks),
        passed=sum(1 for c in checks if c.status == CheckResultStatus.PASS),
        failed=sum(1 for c in checks if c.status == CheckResultStatus.FAIL),
        warning=sum(1 for c in checks if c.status == CheckResultStatus.AMBIGUOUS),
        not_evaluable=sum(1 for c in checks if c.status == CheckResultStatus.MISSING_INPUT),
    )

    # ── Issue summary counts ───────────────────────────────────────────────
    issue_summary = IssueSummarySection(
        total=len(issues),
        critical=sum(1 for i in issues if i.severity == IssueSeverity.CRITICAL),
        error=sum(1 for i in issues if i.severity == IssueSeverity.ERROR),
        warning=sum(1 for i in issues if i.severity == IssueSeverity.WARNING),
        info=sum(1 for i in issues if i.severity == IssueSeverity.INFO),
    )

    # Top issues for report: all, ordered by severity (already sorted by repo)
    top_issues = issues[:20]

    # ── Checklist summary ──────────────────────────────────────────────────
    checklist_summary = ChecklistSummarySection(
        total=len(checklist),
        resolved=resolved_count,
        unresolved=len(checklist) - resolved_count,
    )

    return RunReportData(
        run_id=run_id,
        run_name=run.name,
        run_status=run.status,
        run_created_at=run.created_at,
        is_stale=run.is_stale,
        rules_changed_at=run.rules_changed_at,
        address=site_context.address if site_context else None,
        municipality=site_context.municipality if site_context else None,
        jurisdiction_code=site_context.jurisdiction_code if site_context else None,
        zoning_district=site_context.zoning_district if site_context else None,
        model_name=model_ref.model_name if model_ref else None,
        model_stream_id=model_ref.stream_id if model_ref else None,
        model_synced_at=model_ref.synced_at if model_ref else None,
        readiness=breakdown,
        compliance_summary=compliance_summary,
        compliance_results=compliance_results,
        issue_summary=issue_summary,
        top_issues=top_issues,
        checklist_summary=checklist_summary,
        checklist_items=checklist,
        authoritative_rule_count=len(authoritative_rules),
    )


@router.get("/runs/{run_id}/report-data", response_model=RunReportData)
async def get_run_report_data(
    run_id: UUID,
    user:   AuthenticatedUser  = Depends(get_current_user),
    repo:   PrecheckRepository = Depends(get_repository),
) -> RunReportData:
    """
    Returns the full structured report payload for a run.
    Used by the frontend ComplianceSummaryTab (on-screen view) and
    consumed by the PDF endpoint — both derive from the same data.

    Maps to: lib/precheck/api.ts → getRunReportData()
    Next.js seam: GET /api/agents/precheck?runId=&scope=report_data
    """
    return await _build_report_data(run_id, repo)


@router.get("/runs/{run_id}/report.pdf")
async def download_run_report_pdf(
    run_id: UUID,
    user:   AuthenticatedUser  = Depends(get_current_user),
    repo:   PrecheckRepository = Depends(get_repository),
) -> Response:
    """
    Generates and streams a PDF compliance report for a run.
    Content is identical to the report-data JSON endpoint — no drift possible.

    The PDF is generated on demand (not cached) from live backend data.
    If the run is stale, the PDF is still generated but includes a prominent
    stale warning in the header and disclaimer sections.

    Maps to: lib/precheck/api.ts → downloadRunReportPdf()
    Next.js seam: GET /api/agents/precheck?runId=&scope=report_pdf
    """
    report_data = await _build_report_data(run_id, repo)
    pdf_bytes = generate_report_pdf(report_data)

    # Sanitise run name for use in Content-Disposition filename.
    # Format: "{run_name} - summary.pdf"
    # Keep alphanumerics, spaces, hyphens, underscores, dots; replace others with "_".
    raw_name = report_data.run_name or f"run-{str(run_id)[:8]}"
    safe_name_str = "".join(c if c.isalnum() or c in "-_ ." else "_" for c in raw_name)
    safe_name_str = safe_name_str.strip() or "compliance-report"
    filename = f"{safe_name_str} - summary.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
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
        # Preserve the run's current status if it has advanced past the setup phase
        # (e.g. 'synced', 'completed'). Updating site context is a non-destructive
        # metadata operation and must not regress a successfully synced run back to 'created'.
        _ADVANCED_STATUSES = {
            PrecheckRunStatus.SYNCED,
            PrecheckRunStatus.EVALUATING,
            PrecheckRunStatus.GENERATING_REPORT,
            PrecheckRunStatus.COMPLETED,
        }
        next_status = run.status if run.status in _ADVANCED_STATUSES else PrecheckRunStatus.CREATED
        await pub.publish_run_status(run_id, next_status, "Site context saved")
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
    await _require_run(repo, run_id)
    await pub.publish_run_status(run_id, PrecheckRunStatus.INGESTING_DOCS, "Processing documents")

    async def _task() -> None:
        try:
            docs = await repo.get_documents_by_ids(body.document_ids)

            # 1. Stamp run_id on any docs that are currently project-scoped (run_id IS NULL).
            #    This is the critical step that makes get_documents_for_run() return these
            #    docs so extract_rules_from_chunks() can find them.
            await repo.associate_documents_to_run(run_id, body.document_ids)

            # 2. Chunk documents that do not yet have chunks (idempotency: skip re-chunking).
            #    Existing project-library docs selected from the UI may already be chunked
            #    from a prior ingestion — reusing their chunks avoids duplicate rows and
            #    redundant storage downloads.
            newly_ingested = 0
            for doc in docs:
                existing_chunks = await repo.get_chunks_for_document(doc.id)
                if existing_chunks:
                    log.info(
                        "Skipping re-chunk for doc=%s (%s) — %d chunks already exist",
                        doc.id, doc.file_name, len(existing_chunks),
                    )
                else:
                    await svc.process_document(doc)
                    newly_ingested += 1

            log.info(
                "ingest_documents: run=%s, %d docs associated, %d newly chunked, %d reused",
                run_id, len(docs), newly_ingested, len(docs) - newly_ingested,
            )
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

            # Dedup: reuse existing project-level model ref if this stream+version
            # is already registered, so we never create duplicate rows.
            existing_ref = await repo.get_model_ref_by_stream_version(
                run.project_id, body.stream_id, body.version_id
            )
            if existing_ref:
                model_ref = existing_ref
                await repo.update_run_speckle_ref(run_id, model_ref.id)
            else:
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

            await pub.publish_run_status(run_id, PrecheckRunStatus.SYNCED, "Model synced")
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
# POST /precheck/runs/{run_id}/assign-model-ref
# Link an existing project SpeckleModelRef to this run (no new row created).
# ════════════════════════════════════════════════════════════

@router.post("/runs/{run_id}/assign-model-ref", response_model=OkResponse)
async def assign_model_ref(
    run_id:  UUID,
    body:    AssignModelRefRequest,
    user:    AuthenticatedUser  = Depends(get_current_user),
    repo:    PrecheckRepository = Depends(get_repository),
    pub:     RealtimePublisher  = Depends(get_realtime_publisher),
) -> OkResponse:
    """
    Links an existing SpeckleModelRef (already synced to the project) to a run.
    Unlike sync-speckle-model, this does NOT create a new speckle_model_refs row.
    Also copies the project-level geometry snapshot (run_id=NULL) to a run-scoped
    snapshot so Tool 1 can display metrics immediately without a re-sync.
    Advances the run status to SYNCED so the frontend progress card reflects the
    model being ready — the run was previously stuck at "created".
    Maps to: lib/precheck/api.ts → assignModelRefToRun()
             Next.js seam: action "assign_model_ref"
    """
    run = await _require_run(repo, run_id)

    # Verify the model ref exists and belongs to the same project as the run
    model_ref = await repo.get_model_ref(body.model_ref_id)
    if not model_ref:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model ref {body.model_ref_id} not found",
        )
    if model_ref.project_id != run.project_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Model ref does not belong to this run's project",
        )

    await repo.update_run_speckle_ref(run_id, body.model_ref_id)
    log.info(
        "Assigned existing model ref=%s to run=%s (no new row created)",
        body.model_ref_id, run_id,
    )

    # Copy the project-level snapshot (run_id=NULL) to a run-scoped snapshot
    # so Tool 1 can show metrics immediately without re-deriving geometry.
    await repo.copy_model_snapshot_to_run(body.model_ref_id, run_id)

    # Advance run to SYNCED so the progress card shows the model step as complete.
    # Only advance if the run is still in an early state (created / syncing_model);
    # do not regress a run that has already progressed further.
    early_statuses = {
        PrecheckRunStatus.CREATED,
        PrecheckRunStatus.SYNCING_MODEL,
        PrecheckRunStatus.COMPUTING_METRICS,
    }
    if run.status in early_statuses:
        await pub.publish_run_status(run_id, PrecheckRunStatus.SYNCED, "Model assigned")

    return OkResponse()


# ════════════════════════════════════════════════════════════
# POST /precheck/runs/{run_id}/assign-site-context
# Link an existing project SiteContext to this run (no new row created).
# ════════════════════════════════════════════════════════════

@router.post("/runs/{run_id}/assign-site-context", response_model=OkResponse)
async def assign_site_context(
    run_id:  UUID,
    body:    AssignSiteContextRequest,
    user:    AuthenticatedUser  = Depends(get_current_user),
    repo:    PrecheckRepository = Depends(get_repository),
    pub:     RealtimePublisher  = Depends(get_realtime_publisher),
) -> OkResponse:
    """
    Links an existing SiteContext (already created for the project) to a run.
    Unlike ingest-site, this does NOT create a new site_contexts row.
    Preserves existing run status — site context assignment is non-destructive.
    Maps to: lib/precheck/api.ts → assignSiteContextToRun()
             Next.js seam: action "assign_site_context"
    """
    run = await _require_run(repo, run_id)

    # Verify the site context exists and belongs to the same project as the run
    site_context = await repo.get_site_context(body.site_context_id)
    if not site_context:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Site context {body.site_context_id} not found",
        )
    if site_context.project_id != run.project_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Site context does not belong to this run's project",
        )

    await repo.update_run_site_context(run_id, body.site_context_id)
    log.info(
        "Assigned existing site context=%s to run=%s (no new row created)",
        body.site_context_id, run_id,
    )

    # Preserve run status — site context is a metadata update, not a pipeline step.
    # Do not advance or regress the run state; just publish to keep realtime in sync.
    await pub.publish_run_status(run_id, run.status, "Site context assigned")

    return OkResponse()


# ════════════════════════════════════════════════════════════
# POST /precheck/runs/{run_id}/compute-run-metrics
# Compute run-specific metrics (FAR, lot_coverage_pct) that require
# both model geometry and site context parcel area. Persists result
# to precheck_runs.run_metrics. Synchronous — returns updated run.
# ════════════════════════════════════════════════════════════

@router.post("/runs/{run_id}/compute-run-metrics", response_model=PrecheckRun)
async def compute_run_metrics(
    run_id:  UUID,
    user:    AuthenticatedUser  = Depends(get_current_user),
    repo:    PrecheckRepository = Depends(get_repository),
    speckle: SpeckleService     = Depends(get_speckle_service),
) -> PrecheckRun:
    """
    Derives FAR and lot_coverage_pct from the run's geometry snapshot and
    site context, then persists them to precheck_runs.run_metrics.

    Requires:
      - run has a geometry snapshot (model synced)
      - run has a site context with parcel_area_m2

    Returns the updated PrecheckRun with run_metrics populated.
    Maps to: lib/precheck/api.ts → computeRunMetrics()
             Next.js seam: action "compute_run_metrics"
    """
    run = await _require_run(repo, run_id)

    try:
        run_metrics = await speckle.compute_run_metrics(run)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    updated_run = await repo.update_run_run_metrics(run_id, run_metrics)
    log.info(
        "Run %s run_metrics computed: FAR=%s parcel=%.1f m²",
        run_id,
        run_metrics.get("far"),
        run_metrics.get("parcel_area_m2", 0),
    )
    return updated_run


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
            # Clear the stale flag immediately so the UI stops showing the
            # "rerun required" banner as soon as evaluation starts.
            await repo.clear_run_stale(run_id)

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

            # ── Fetch project extraction options ───────────────
            options = await repo.get_extraction_options(run.project_id)

            # ── Select applicable rules ────────────────────────
            rules = await engine.select_applicable_rules(run_id, site_context, options)

            # ── Build metric map ───────────────────────────────
            # Re-fetch run inside the task to pick up any run_metrics that were
            # computed after the endpoint was called (e.g. compute-run-metrics).
            current_run = await repo.get_run(run_id)
            metric_map = {}
            if snapshot:
                metric_map = await engine.resolve_metrics(snapshot, current_run)

            # ── Deterministic evaluation ───────────────────────
            checks, _run_summary = await engine.evaluate_rules(run_id, rules, metric_map, snapshot)

            # ── Generate issues ────────────────────────────────
            rules_by_id = {r.id: r for r in rules}
            issues = await engine.generate_issues(
                run_id, checks, rules_by_id, project_id=run.project_id
            )

            # ── Score context ──────────────────────────────────
            # A rule counts as "reviewed" if it has been explicitly approved or
            # auto-approved (or the legacy 'reviewed' status from V1).
            _AUTHORITATIVE_STATUSES = {"reviewed", "approved", "auto_approved"}
            has_reviewed = any(r.status.value in _AUTHORITATIVE_STATUSES for r in rules)
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


# ════════════════════════════════════════════════════════════
# GET /projects/{project_id}/documents
# List all documents for a project (not filtered by run).
# ════════════════════════════════════════════════════════════

@project_router.get("/{project_id}/documents", response_model=ProjectDocumentsResponse)
async def list_project_documents(
    project_id: UUID,
    user:       AuthenticatedUser  = Depends(get_current_user),
    repo:       PrecheckRepository = Depends(get_repository),
) -> ProjectDocumentsResponse:
    """
    Returns all uploaded_documents rows for a project regardless of run_id.
    Maps to: lib/precheck/api.ts → listProjectDocuments()
             Next.js seam: GET /api/agents/precheck?projectId=&scope=documents
    """
    docs = await repo.get_documents_for_project(project_id)
    return ProjectDocumentsResponse(documents=docs, total=len(docs))


# ════════════════════════════════════════════════════════════
# POST /projects/{project_id}/documents
# Register a document directly against the project (no run).
# ════════════════════════════════════════════════════════════

@project_router.post(
    "/{project_id}/documents",
    response_model=UploadedDocument,
    status_code=status.HTTP_201_CREATED,
)
async def register_project_document(
    project_id: UUID,
    body:       RegisterProjectDocumentRequest,
    user:       AuthenticatedUser       = Depends(get_current_user),
    svc:        DocumentIngestionService = Depends(get_document_ingestion),
) -> UploadedDocument:
    """
    Registers a document already uploaded to Supabase Storage at the project level.
    run_id is NULL — the document belongs to the project, not any specific run.
    Maps to: lib/precheck/api.ts → registerProjectDocument()
             Next.js seam: action "register_project_document"
    """
    doc = await svc.create_uploaded_document(
        project_id=project_id,
        run_id=None,
        file_name=body.file_name,
        mime_type=body.mime_type,
        document_type=body.document_type.value,
        storage_path=body.storage_path,
    )
    log.info(
        "Registered project document: id=%s name=%r for project=%s",
        doc.id, doc.file_name, project_id,
    )
    return doc


# ════════════════════════════════════════════════════════════
# GET /projects/{project_id}/model-refs
# List all Speckle model refs for a project.
# ════════════════════════════════════════════════════════════

@project_router.get("/{project_id}/model-refs", response_model=ProjectModelRefsResponse)
async def list_project_model_refs(
    project_id: UUID,
    user:       AuthenticatedUser  = Depends(get_current_user),
    repo:       PrecheckRepository = Depends(get_repository),
) -> ProjectModelRefsResponse:
    """
    Returns all speckle_model_refs rows for a project, newest first.
    Maps to: lib/precheck/api.ts → listProjectModelRefs()
             Next.js seam: GET /api/agents/precheck?projectId=&scope=model_refs
    """
    refs = await repo.list_model_refs_for_project(project_id)
    return ProjectModelRefsResponse(model_refs=refs, total=len(refs))


# ════════════════════════════════════════════════════════════
# POST /projects/{project_id}/model-refs
# Sync a Speckle model version to a project (no run required).
# ════════════════════════════════════════════════════════════

@project_router.post(
    "/{project_id}/model-refs",
    response_model=SpeckleModelRef,
    status_code=status.HTTP_201_CREATED,
)
async def sync_project_model(
    project_id:      UUID,
    body:            SyncProjectModelRequest,
    background:      BackgroundTasks,
    user:            AuthenticatedUser  = Depends(get_current_user),
    repo:            PrecheckRepository = Depends(get_repository),
    svc:             SpeckleService     = Depends(get_speckle_service),
) -> SpeckleModelRef:
    """
    Creates a SpeckleModelRef belonging to the project without creating a run.
    Deduplicates by (project_id, stream_id, version_id) — returns existing ref if
    the same version was already synced. Always re-triggers geometry snapshot derivation
    so that metrics are kept fresh.
    Maps to: lib/precheck/api.ts → syncProjectModel()
             Next.js seam: action "sync_project_model"
    """
    # Dedup: if this stream+version is already registered for the project, reuse it.
    existing = await repo.get_model_ref_by_stream_version(
        project_id, body.stream_id, body.version_id
    )
    if existing:
        log.info(
            "Reusing existing project model ref: id=%s stream=%r version=%r for project=%s",
            existing.id, existing.stream_id, existing.version_id, project_id,
        )
        ref = existing
    else:
        run_scoped_body = SyncSpeckleModelRequest(
            stream_id=body.stream_id,
            version_id=body.version_id,
            branch_name=body.branch_name,
            model_name=body.model_name,
        )
        ref = await svc.create_speckle_model_ref(project_id, run_scoped_body)
        log.info(
            "Synced project model ref: id=%s stream=%r version=%r for project=%s",
            ref.id, ref.stream_id, ref.version_id, project_id,
        )
    # Always re-derive geometry metrics in background so the client is not blocked.
    background.add_task(
        svc.derive_geometry_snapshot_for_model,
        project_id,
        ref,
        None,  # site_context — not available at project-model level
    )
    return ref


# ════════════════════════════════════════════════════════════
# GET /projects/{project_id}/model-refs/{model_ref_id}/snapshot
# Return the latest project-level geometry snapshot for a model ref.
# ════════════════════════════════════════════════════════════

@project_router.get(
    "/{project_id}/model-refs/{model_ref_id}/snapshot",
    response_model=GeometrySnapshot | None,
)
async def get_model_ref_snapshot(
    project_id:    UUID,
    model_ref_id:  UUID,
    user:          AuthenticatedUser  = Depends(get_current_user),
    repo:          PrecheckRepository = Depends(get_repository),
) -> GeometrySnapshot | None:
    """
    Returns the most recent project-level geometry snapshot for a model ref.
    Returns null if metrics haven't been derived yet (background task still running).
    Maps to: lib/precheck/api.ts → getModelRefSnapshot()
             Next.js seam: GET /api/agents/precheck?projectId=&modelRefId=&scope=model_snapshot
    """
    return await repo.get_snapshot_for_model_ref(model_ref_id)


# ════════════════════════════════════════════════════════════
# GET /projects/{project_id}/active-model
# Return the active SpeckleModelRef for a project (or 204 if none).
# ════════════════════════════════════════════════════════════

@project_router.get(
    "/{project_id}/active-model",
    response_model=SpeckleModelRef | None,
)
async def get_active_project_model(
    project_id: UUID,
    user:       AuthenticatedUser  = Depends(get_current_user),
    repo:       PrecheckRepository = Depends(get_repository),
) -> SpeckleModelRef | None:
    """
    Returns the active SpeckleModelRef for the project, or null if none is set.
    Maps to: lib/precheck/api.ts → getProjectActiveModelRef()
             Next.js seam: GET /api/agents/precheck?projectId=&scope=active_model
    """
    return await repo.get_active_model_ref_for_project(project_id)


# ════════════════════════════════════════════════════════════
# POST /projects/{project_id}/active-model
# Designate one SpeckleModelRef as the project's active model.
# ════════════════════════════════════════════════════════════

@project_router.post(
    "/{project_id}/active-model",
    response_model=OkResponse,
)
async def set_active_project_model(
    project_id: UUID,
    body: SetActiveProjectModelRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repo: PrecheckRepository = Depends(get_repository),
) -> OkResponse:
    """
    Persists the active SpeckleModelRef for a project.
    The active ref pre-fills SpeckleModelPicker on new precheck runs.
    Maps to: lib/precheck/api.ts → setActiveProjectModel()
             Next.js seam: action "set_active_project_model"
    """
    await repo.set_active_model_ref(project_id, body.model_ref_id)
    log.info(
        "Set active model ref=%s for project=%s",
        body.model_ref_id, project_id,
    )
    return OkResponse()


# ════════════════════════════════════════════════════════════
# DELETE /projects/{project_id}/model-refs/{model_ref_id}
# Remove a Speckle model ref from a project.
# If it was the active model, clears that pointer first.
# ════════════════════════════════════════════════════════════

@project_router.delete(
    "/{project_id}/model-refs/{model_ref_id}",
    response_model=OkResponse,
)
async def delete_project_model(
    project_id:    UUID,
    model_ref_id:  UUID,
    user:          AuthenticatedUser  = Depends(get_current_user),
    repo:          PrecheckRepository = Depends(get_repository),
) -> OkResponse:
    """
    Deletes a SpeckleModelRef belonging to the project.

    Deletion strategy: cleanup delete.
      1. Verify the ref exists and belongs to this project.
      2. Handle active-model pointer:
         - If this was the active model, attempt to promote another model to active.
         - If no other model exists, clear active_model_ref_id to NULL.
      3. Delete all geometry_snapshots that reference this model ref
         (both project-level run_id=NULL and run-scoped).
         geometry_snapshots.speckle_model_ref_id has ON DELETE RESTRICT so
         they must be removed before the model ref can be deleted.
         Snapshots are derived data and are safe to hard-delete.
      4. Delete the speckle_model_refs row.

    precheck_runs.speckle_model_ref_id is handled automatically by the DB
    via ON DELETE SET NULL — affected runs are preserved but lose their model
    ref pointer.

    Maps to: lib/precheck/api.ts → deleteProjectModel()
             Next.js seam: action "delete_project_model"
    """
    ref = await repo.get_model_ref(model_ref_id)
    if not ref:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model ref {model_ref_id} not found",
        )
    if ref.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Model ref does not belong to this project",
        )

    # Step 1 — Handle active model pointer before deletion
    active_ref = await repo.get_active_model_ref_for_project(project_id)
    if active_ref and active_ref.id == model_ref_id:
        # Try to promote the next most-recently-synced model as active
        all_refs = await repo.list_model_refs_for_project(project_id)
        fallback = next((r for r in all_refs if r.id != model_ref_id), None)
        if fallback:
            await repo.set_active_model_ref(project_id, fallback.id)
            log.info(
                "Active model ref=%s deleted for project=%s — promoted fallback ref=%s",
                model_ref_id, project_id, fallback.id,
            )
        else:
            await repo.clear_active_model_ref_if_matches(project_id, model_ref_id)
            log.info(
                "Active model ref=%s deleted for project=%s — no fallback, cleared active",
                model_ref_id, project_id,
            )

    # Step 2 — Remove all geometry snapshots (run-scoped + project-level)
    #          so the ON DELETE RESTRICT FK on geometry_snapshots is satisfied.
    await repo.delete_all_snapshots_for_model_ref(model_ref_id)

    # Step 3 — Delete the model ref itself
    await repo.delete_model_ref(model_ref_id)
    log.info("Deleted model ref=%s from project=%s", model_ref_id, project_id)
    return OkResponse()


# ════════════════════════════════════════════════════════════
# GET /projects/{project_id}/site-contexts
# List all site contexts for a project.
# ════════════════════════════════════════════════════════════

@project_router.get(
    "/{project_id}/site-contexts",
    response_model=ProjectSiteContextsResponse,
)
async def list_project_site_contexts(
    project_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
    repo: PrecheckRepository = Depends(get_repository),
) -> ProjectSiteContextsResponse:
    """
    Returns all site_contexts rows for a project, newest first.
    Also includes the project's default_site_context_id so the
    client can highlight the default.
    Maps to: lib/precheck/api.ts → listProjectSiteContexts()
             Next.js seam: GET /api/agents/precheck?projectId=&scope=site_contexts
    """
    contexts = await repo.get_site_contexts_for_project(project_id)
    default_id = await repo.get_default_site_context_id_for_project(
        project_id
    )
    return ProjectSiteContextsResponse(
        site_contexts=contexts,
        total=len(contexts),
        default_site_context_id=default_id,
    )


# ════════════════════════════════════════════════════════════
# POST /projects/{project_id}/site-contexts
# Create a standalone site context (no run required).
# ════════════════════════════════════════════════════════════

@project_router.post(
    "/{project_id}/site-contexts",
    response_model=SiteContext,
)
async def create_project_site_context(
    project_id: UUID,
    body: CreateProjectSiteContextRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repo: PrecheckRepository = Depends(get_repository),
    svc: SiteDataProviderService = Depends(get_site_data_provider),
) -> SiteContext:
    """
    Creates a new SiteContext for a project without requiring a run.
    Optionally sets the new context as the project default (body.set_as_default).
    Maps to: lib/precheck/api.ts → createProjectSiteContext()
             Next.js seam: action "create_project_site_context"
    """
    # Reuse the same site-data normalization pipeline used by ingest-site,
    # but pass run_id=None so no run status is touched.
    from app.core.schemas import IngestSiteRequest as _IngestSiteRequest
    ingest_body = _IngestSiteRequest(
        address=body.address,
        manual_overrides=body.manual_overrides,
    )
    site_context = await svc.normalize_site_context(
        run_id=None,
        project_id=project_id,
        request=ingest_body,
    )
    if body.set_as_default:
        await repo.set_default_site_context(project_id, site_context.id)
        log.info(
            "Set new site context=%s as default for project=%s",
            site_context.id, project_id,
        )
    log.info(
        "Created project site context=%s for project=%s",
        site_context.id, project_id,
    )
    return site_context


# ════════════════════════════════════════════════════════════
# DELETE /projects/{project_id}/site-contexts/{site_context_id}
# Hard-delete a site context from a project.
# ════════════════════════════════════════════════════════════

@project_router.delete(
    "/{project_id}/site-contexts/{site_context_id}",
    response_model=OkResponse,
)
async def delete_project_site_context(
    project_id: UUID,
    site_context_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
    repo: PrecheckRepository = Depends(get_repository),
) -> OkResponse:
    """
    Hard-deletes a SiteContext row for a project.

    Foreign key constraints (ON DELETE SET NULL) automatically clear:
      - precheck_runs.site_context_id for any run using this context
      - projects.default_site_context_id if this was the project default

    Maps to: lib/precheck/api.ts → deleteProjectSiteContext()
             Next.js seam: action "delete_project_site_context"
    """
    ctx = await repo.get_site_context(site_context_id)
    if not ctx:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Site context {site_context_id} not found",
        )
    if ctx.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Site context does not belong to this project",
        )
    await repo.delete_site_context(site_context_id)
    log.info(
        "Deleted site context=%s from project=%s", site_context_id, project_id
    )
    return OkResponse()


# ════════════════════════════════════════════════════════════
# GET /projects/{project_id}/default-site-context
# Return the default SiteContext for a project (or null if none).
# ════════════════════════════════════════════════════════════

@project_router.get(
    "/{project_id}/default-site-context",
    response_model=SiteContext | None,
)
async def get_default_project_site_context(
    project_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
    repo: PrecheckRepository = Depends(get_repository),
) -> SiteContext | None:
    """
    Returns the default SiteContext for the project, or null if none.
    Maps to: lib/precheck/api.ts → getProjectDefaultSiteContext()
             Next.js seam: GET /api/agents/precheck?projectId=&scope=default_site_context
    """
    return await repo.get_default_site_context_for_project(project_id)


# ════════════════════════════════════════════════════════════
# POST /projects/{project_id}/default-site-context
# Designate one SiteContext as the project's default.
# ════════════════════════════════════════════════════════════

@project_router.post(
    "/{project_id}/default-site-context",
    response_model=OkResponse,
)
async def set_default_project_site_context(
    project_id: UUID,
    body: SetDefaultSiteContextRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repo: PrecheckRepository = Depends(get_repository),
) -> OkResponse:
    """
    Persists the default SiteContext for a project.
    The default context pre-fills SiteContextForm on new precheck runs.
    Maps to: lib/precheck/api.ts → setProjectDefaultSiteContext()
             Next.js seam: action "set_default_site_context"
    """
    # Verify the site context belongs to this project
    ctx = await repo.get_site_context(body.site_context_id)
    if not ctx:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Site context {body.site_context_id} not found",
        )
    if ctx.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Site context does not belong to this project",
        )
    await repo.set_default_site_context(project_id, body.site_context_id)
    log.info(
        "Set default site context=%s for project=%s",
        body.site_context_id, project_id,
    )
    return OkResponse()


# ════════════════════════════════════════════════════════════
# POST /precheck/rules/{rule_id}/approve
# Mark an extracted rule as approved (authoritative).
# ════════════════════════════════════════════════════════════

@router.post("/rules/{rule_id}/approve", response_model=ExtractedRule)
async def approve_rule(
    rule_id: UUID,
    user:    AuthenticatedUser    = Depends(get_current_user),
    svc:     RuleExtractionService = Depends(get_rule_extraction),
) -> ExtractedRule:
    """
    Sets the rule status to 'approved' and is_authoritative=True.
    Clears the is_recommended flag on competing rules in the same conflict group.
    Maps to: lib/precheck/api.ts → approveRule()
             Next.js seam: action "approve_rule"
    """
    try:
        rule = await svc.approve_rule(rule_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    log.info("Rule %s approved by user=%s", rule_id, user.user_id)
    return rule


# ════════════════════════════════════════════════════════════
# POST /precheck/rules/{rule_id}/unapprove
# Return an approved rule to draft (non-authoritative) status.
# The rule is NOT deleted — it stays visible for re-approval.
# ════════════════════════════════════════════════════════════

@router.post("/rules/{rule_id}/unapprove", response_model=ExtractedRule)
async def unapprove_rule(
    rule_id: UUID,
    user:    AuthenticatedUser    = Depends(get_current_user),
    svc:     RuleExtractionService = Depends(get_rule_extraction),
) -> ExtractedRule:
    """
    Returns an approved/reviewed rule to draft status (non-authoritative).
    Marks all evaluated project runs as stale so the UI prompts a rerun.
    Manual rules cannot be unapproved — raise 422 instead.
    Maps to: lib/precheck/api.ts → unapproveRule()
             Next.js seam: action "unapprove_rule"
    """
    try:
        rule = await svc.unapprove_rule(rule_id)
    except ValueError as exc:
        msg = str(exc)
        code = (
            status.HTTP_422_UNPROCESSABLE_ENTITY
            if "manual rule" in msg
            else status.HTTP_404_NOT_FOUND
        )
        raise HTTPException(code, detail=msg) from exc
    log.info("Rule %s unapproved by user=%s", rule_id, user.user_id)
    return rule


# ════════════════════════════════════════════════════════════
# POST /precheck/rules/{rule_id}/reject
# Mark an extracted rule as rejected (excluded from compliance).
# ════════════════════════════════════════════════════════════

@router.post("/rules/{rule_id}/reject", response_model=ExtractedRule)
async def reject_rule(
    rule_id: UUID,
    user:    AuthenticatedUser    = Depends(get_current_user),
    svc:     RuleExtractionService = Depends(get_rule_extraction),
) -> ExtractedRule:
    """
    Sets the rule status to 'rejected' and is_authoritative=False.
    Also marks evaluated project runs as stale.
    Maps to: lib/precheck/api.ts → rejectRule()
             Next.js seam: action "reject_rule"
    """
    try:
        rule = await svc.reject_rule(rule_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    log.info("Rule %s rejected by user=%s", rule_id, user.user_id)
    return rule


# ════════════════════════════════════════════════════════════
# PATCH /precheck/rules/{rule_id}
# Update fields of a manual rule (source_kind='manual' only).
# ════════════════════════════════════════════════════════════

@router.patch("/rules/{rule_id}", response_model=ExtractedRule)
async def update_manual_rule(
    rule_id: UUID,
    body:    UpdateManualRuleRequest,
    user:    AuthenticatedUser    = Depends(get_current_user),
    svc:     RuleExtractionService = Depends(get_rule_extraction),
) -> ExtractedRule:
    """
    Updates a manual rule's editable fields.
    Raises 403 if the rule was AI-extracted (source_kind='extracted').
    Maps to: lib/precheck/api.ts → updateManualRule()
             Next.js seam: action "update_manual_rule"
    """
    updates = body.model_dump(exclude_none=True)
    try:
        rule = await svc.update_manual_rule(rule_id, updates)
    except ValueError as exc:
        msg = str(exc)
        code = status.HTTP_403_FORBIDDEN if "not a manual rule" in msg else status.HTTP_404_NOT_FOUND
        raise HTTPException(code, detail=msg) from exc
    log.info("Manual rule %s updated by user=%s", rule_id, user.user_id)
    return rule


# ════════════════════════════════════════════════════════════
# DELETE /precheck/rules/{rule_id}
# Hard-delete a manual rule (source_kind='manual' only).
# Extracted rules must be rejected via /reject, not deleted.
# ════════════════════════════════════════════════════════════

@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_manual_rule(
    rule_id: UUID,
    user:    AuthenticatedUser    = Depends(get_current_user),
    svc:     RuleExtractionService = Depends(get_rule_extraction),
) -> None:
    """
    Hard-deletes a manual rule.
    Returns 403 if the rule is AI-extracted (source_kind='extracted').
    Returns 404 if the rule does not exist.
    Marks all evaluated runs for the project as stale.
    Maps to: lib/precheck/api.ts → deleteManualRule()
             Next.js seam: action "delete_manual_rule"
    """
    try:
        await svc.delete_manual_rule(rule_id)
    except ValueError as exc:
        msg = str(exc)
        code = status.HTTP_403_FORBIDDEN if "not a manual rule" in msg else status.HTTP_404_NOT_FOUND
        raise HTTPException(code, detail=msg) from exc
    log.info("Manual rule %s deleted by user=%s", rule_id, user.user_id)


# ════════════════════════════════════════════════════════════
# GET /projects/{project_id}/rules
# List all rules for a project (all runs combined).
# ════════════════════════════════════════════════════════════

@project_router.get("/{project_id}/rules", response_model=list[ExtractedRule])
async def list_project_rules(
    project_id: UUID,
    user:       AuthenticatedUser  = Depends(get_current_user),
    repo:       PrecheckRepository = Depends(get_repository),
) -> list[ExtractedRule]:
    """
    Returns all extracted_rules for a project (across all runs + manual rules).
    Used by the rule management panel in the UI.
    Maps to: lib/precheck/api.ts → listProjectRules()
             Next.js seam: GET /api/agents/precheck?projectId=&scope=rules
    """
    return await repo.get_rules_for_project(project_id)


# ════════════════════════════════════════════════════════════
# POST /projects/{project_id}/rules
# Create a manual rule directly against a project.
# ════════════════════════════════════════════════════════════

@project_router.post(
    "/{project_id}/rules",
    response_model=ExtractedRule,
    status_code=status.HTTP_201_CREATED,
)
async def create_manual_rule(
    project_id: UUID,
    body:       CreateManualRuleRequest,
    user:       AuthenticatedUser    = Depends(get_current_user),
    svc:        RuleExtractionService = Depends(get_rule_extraction),
) -> ExtractedRule:
    """
    Creates a manual rule scoped to the project.
    Manual rules are authoritative by default (no extraction review required).
    Maps to: lib/precheck/api.ts → createManualRule()
             Next.js seam: action "create_manual_rule"
    """
    rule = await svc.create_manual_rule(
        project_id=project_id,
        metric_key=body.metric_key,
        operator=body.operator,
        title=body.title,
        value_number=body.value_number,
        value_min=body.value_min,
        value_max=body.value_max,
        units=body.units,
        condition_text=body.condition_text,
        exception_text=body.exception_text,
        applicability=body.applicability,
    )
    log.info(
        "Manual rule created: id=%s metric=%s for project=%s by user=%s",
        rule.id, rule.metric_key.value, project_id, user.user_id,
    )
    return rule


# ════════════════════════════════════════════════════════════
# GET /projects/{project_id}/extraction-options
# Fetch project rule extraction options.
# ════════════════════════════════════════════════════════════

@project_router.get(
    "/{project_id}/extraction-options",
    response_model=ProjectExtractionOptions,
)
async def get_extraction_options(
    project_id: UUID,
    user:       AuthenticatedUser  = Depends(get_current_user),
    repo:       PrecheckRepository = Depends(get_repository),
) -> ProjectExtractionOptions:
    """
    Returns the project's rule extraction options, or defaults if not yet set.
    Maps to: lib/precheck/api.ts → getProjectExtractionOptions()
             Next.js seam: GET /api/agents/precheck?projectId=&scope=extraction_options
    """
    opts = await repo.get_extraction_options(project_id)
    if opts is None:
        # Return defaults — no DB row required until the user changes something
        opts = ProjectExtractionOptions(
            project_id=project_id,
            rule_auto_apply_enabled=False,
            rule_auto_apply_confidence_threshold=0.82,
            manual_verification_required=True,
            auto_resolve_conflicts=False,
        )
    return opts


# ════════════════════════════════════════════════════════════
# PUT /projects/{project_id}/extraction-options
# Upsert project rule extraction options.
# ════════════════════════════════════════════════════════════

@project_router.put(
    "/{project_id}/extraction-options",
    response_model=ProjectExtractionOptions,
)
async def set_extraction_options(
    project_id: UUID,
    body:       SetProjectExtractionOptionsRequest,
    user:       AuthenticatedUser  = Depends(get_current_user),
    repo:       PrecheckRepository = Depends(get_repository),
) -> ProjectExtractionOptions:
    """
    Creates or updates rule extraction options for the project.
    Maps to: lib/precheck/api.ts → setProjectExtractionOptions()
             Next.js seam: action "set_extraction_options"
    """
    patch = body.model_dump(exclude_none=True)
    opts = await repo.upsert_extraction_options(project_id, patch)
    log.info("Extraction options updated for project=%s by user=%s", project_id, user.user_id)
    return opts


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
