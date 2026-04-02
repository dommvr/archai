"""
backend/app/core/schemas.py

Pydantic v2 schemas that mirror lib/precheck/schemas.ts + lib/precheck/types.ts.

Field names use snake_case internally; camelCase aliases are generated automatically
via alias_generator=to_camel so JSON serialisation matches the TypeScript contracts.

Enum values match the `as const` arrays in lib/precheck/constants.ts exactly.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


# ── Base config ───────────────────────────────────────────────────────────────

class BaseSchema(BaseModel):
    """All domain schemas inherit from this.
    - populate_by_name=True  : allow both snake_case and camelCase input
    - alias_generator        : serialise as camelCase (matches TS contracts)
    - from_attributes=True   : allow construction from ORM-like objects
    """
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ════════════════════════════════════════════════════════════
# ENUMS  (mirrors lib/precheck/constants.ts)
# ════════════════════════════════════════════════════════════

class PrecheckRunStatus(str, Enum):
    CREATED           = "created"
    INGESTING_SITE    = "ingesting_site"
    INGESTING_DOCS    = "ingesting_docs"
    EXTRACTING_RULES  = "extracting_rules"
    SYNCING_MODEL     = "syncing_model"
    COMPUTING_METRICS = "computing_metrics"
    SYNCED            = "synced"
    EVALUATING        = "evaluating"
    GENERATING_REPORT = "generating_report"
    COMPLETED         = "completed"
    FAILED            = "failed"


class RuleStatus(str, Enum):
    DRAFT = "draft"
    # 'reviewed' is a legacy alias for 'approved' — kept for existing rows
    REVIEWED = "reviewed"
    APPROVED = "approved"
    REJECTED = "rejected"
    AUTO_APPROVED = "auto_approved"
    SUPERSEDED = "superseded"


class RuleSourceKind(str, Enum):
    EXTRACTED = "extracted"
    MANUAL = "manual"


class IssueSeverity(str, Enum):
    INFO     = "info"
    WARNING  = "warning"
    ERROR    = "error"
    CRITICAL = "critical"


class CheckResultStatus(str, Enum):
    PASS            = "pass"
    FAIL            = "fail"
    AMBIGUOUS       = "ambiguous"
    NOT_APPLICABLE  = "not_applicable"
    MISSING_INPUT   = "missing_input"


class MetricKey(str, Enum):
    BUILDING_HEIGHT_M        = "building_height_m"
    FRONT_SETBACK_M          = "front_setback_m"
    SIDE_SETBACK_LEFT_M      = "side_setback_left_m"
    SIDE_SETBACK_RIGHT_M     = "side_setback_right_m"
    REAR_SETBACK_M           = "rear_setback_m"
    GROSS_FLOOR_AREA_M2      = "gross_floor_area_m2"
    FAR                      = "far"
    LOT_COVERAGE_PCT         = "lot_coverage_pct"
    PARKING_SPACES_REQUIRED  = "parking_spaces_required"
    PARKING_SPACES_PROVIDED  = "parking_spaces_provided"


class ChecklistCategory(str, Enum):
    SITE_DATA       = "site_data"
    ZONING_DATA     = "zoning_data"
    MODEL_DATA      = "model_data"
    RULES_DATA      = "rules_data"
    SUBMISSION_DATA = "submission_data"


class IssueType(str, Enum):
    """
    Controlled vocabulary for the nature of a compliance issue.
    Mirrors issue_type enum in migration 20240301000020.
    """
    # Deterministic rule threshold exceeded
    VIOLATION          = "violation"
    # Ambiguous result or soft concern (rule low confidence, measurement quality)
    WARNING            = "warning"
    # Required metric or geometry input is missing
    MISSING_DATA       = "missing_data"
    # Rule is not authoritative / not fully defined
    AMBIGUOUS_RULE     = "ambiguous_rule"
    # Rule depends on an unsupported input basis (e.g. dwelling unit count)
    UNSUPPORTED_BASIS  = "unsupported_basis"


class DocumentType(str, Enum):
    ZONING_CODE   = "zoning_code"
    BUILDING_CODE = "building_code"
    PROJECT_DOC   = "project_doc"
    OTHER         = "other"


class RuleOperator(str, Enum):
    LT      = "<"
    LTE     = "<="
    GT      = ">"
    GTE     = ">="
    EQ      = "="
    BETWEEN = "between"


# ════════════════════════════════════════════════════════════
# GEOMETRY PRIMITIVES  (mirrors LatLngSchema, PolygonSchema)
# ════════════════════════════════════════════════════════════

class LatLng(BaseSchema):
    lat: float
    lng: float


# GeoJSON Polygon — coordinates is a list of rings, each ring is [lon, lat] pairs.
# Stored as JSONB in Postgres; maps to PolygonSchema in TypeScript.
class Polygon(BaseSchema):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[list[float]]]


# ════════════════════════════════════════════════════════════
# CITATION & APPLICABILITY  (mirrors RuleCitationSchema, ApplicabilitySchema)
# ════════════════════════════════════════════════════════════

class RuleCitation(BaseSchema):
    document_id: UUID
    page: int | None = None
    section: str | None = None
    snippet: str
    chunk_id: UUID | None = None


class Applicability(BaseSchema):
    jurisdiction_code: str | None = None
    zoning_districts: list[str] = Field(default_factory=list)
    building_types: list[str] = Field(default_factory=list)
    occupancies: list[str] = Field(default_factory=list)


# ════════════════════════════════════════════════════════════
# DOMAIN MODELS  (mirrors schemas.ts / types.ts)
# ════════════════════════════════════════════════════════════

class SiteContext(BaseSchema):
    id: UUID
    project_id: UUID
    address: str | None = None
    municipality: str | None = None
    jurisdiction_code: str | None = None
    zoning_district: str | None = None
    overlays: list[str] = Field(default_factory=list)
    parcel_id: str | None = None
    parcel_area_m2: float | None = None
    centroid: LatLng | None = None
    parcel_boundary: Polygon | None = None
    source_provider: str
    raw_source_data: Any | None = None
    created_at: datetime
    updated_at: datetime


class UploadedDocument(BaseSchema):
    id: UUID
    project_id: UUID
    run_id: UUID | None = None
    storage_path: str
    file_name: str
    mime_type: str
    document_type: DocumentType
    jurisdiction_code: str | None = None
    uploaded_at: datetime


class DocumentChunk(BaseSchema):
    id: UUID
    document_id: UUID
    page: int | None = None
    section: str | None = None
    chunk_index: int
    # DB column is 'chunk_text' (reserved-word avoidance); TS contract uses 'text'.
    # validation_alias maps the DB row value to this field without changing the
    # camelCase serialisation alias ('text') that the TypeScript schemas expect.
    text: str = Field(validation_alias="chunk_text")
    embedding: list[float] | None = None
    metadata: dict[str, Any] | None = None


class ExtractedRule(BaseSchema):
    id: UUID
    project_id: UUID
    # Nullable for manual rules (source_kind='manual')
    document_id: UUID | None = None
    rule_code: str
    title: str
    description: str | None = None
    metric_key: MetricKey
    operator: RuleOperator
    value_number: float | None = None
    value_min: float | None = None
    value_max: float | None = None
    units: str | None = None
    applicability: Applicability = Field(default_factory=Applicability)
    # citation is nullable for manual rules without a source document
    citation: RuleCitation | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    status: RuleStatus = RuleStatus.DRAFT
    extraction_notes: str | None = None

    # ── V2 extraction fields ──────────────────────────────────
    # Whether this rule came from AI extraction or was manually created
    source_kind: RuleSourceKind = RuleSourceKind.EXTRACTED
    # Authority: drives whether this rule is decision-making in compliance
    is_authoritative: bool = False
    # Conflict: recommended winner when conflict_group_id is set
    is_recommended: bool = False
    # Conflict group UUID shared by rules representing the same constraint
    # with differing values across source documents. None = no conflict.
    conflict_group_id: UUID | None = None
    # Condition / exception language from the source text
    condition_text: str | None = None
    exception_text: str | None = None
    # Unit conversion or extraction caveat note shown in UI
    normalization_note: str | None = None
    # Parsed provenance from the source document header/footer
    effective_date: datetime | None = None
    version_label: str | None = None
    # Direct FK to the source chunk (mirrors citation.chunk_id, indexed)
    source_chunk_id: UUID | None = None

    created_at: datetime
    updated_at: datetime


class SpeckleModelRef(BaseSchema):
    id: UUID
    project_id: UUID
    stream_id: str
    branch_name: str | None = None
    version_id: str
    model_name: str | None = None
    commit_message: str | None = None
    selected_at: datetime
    # NULL until derive_geometry_snapshot_for_model() completes successfully
    synced_at: datetime | None = None


class GeometrySnapshotMetric(BaseSchema):
    key: MetricKey
    value: float
    units: str | None = None
    source_object_ids: list[str] = Field(default_factory=list)
    computation_notes: str | None = None


class GeometrySnapshot(BaseSchema):
    id: UUID
    project_id: UUID
    run_id: UUID | None = None
    speckle_model_ref_id: UUID
    site_boundary: Polygon | None = None
    building_footprints: list[dict[str, Any]] = Field(default_factory=list)
    floors: list[dict[str, Any]] = Field(default_factory=list)
    metrics: list[GeometrySnapshotMetric] = Field(default_factory=list)
    raw_metrics: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class ComplianceCheck(BaseSchema):
    id: UUID
    run_id: UUID
    rule_id: UUID
    metric_key: MetricKey
    status: CheckResultStatus
    actual_value: float | None = None
    expected_value: float | None = None
    expected_min: float | None = None
    expected_max: float | None = None
    units: str | None = None
    # Human-readable explanation generated by the deterministic evaluator.
    # Example: "Building height 38.2 ft exceeds maximum allowed 35 ft."
    explanation: str | None = None
    created_at: datetime


class ComplianceIssue(BaseSchema):
    id: UUID
    run_id: UUID
    # Denormalised for convenience — same project as the run.
    project_id: UUID | None = None
    rule_id: UUID | None = None
    check_id: UUID | None = None
    severity: IssueSeverity
    # Controlled vocab for issue nature (Phase 2).
    issue_type: IssueType | None = None
    title: str
    summary: str
    explanation: str | None = None
    # Plain-English remediation hint shown in the UI.
    recommended_action: str | None = None
    status: CheckResultStatus
    metric_key: MetricKey | None = None
    actual_value: float | None = None
    expected_value: float | None = None
    expected_min: float | None = None
    expected_max: float | None = None
    units: str | None = None
    citation: RuleCitation | None = None
    # Source traceability fields (copied from rule citation where available).
    source_document_id: UUID | None = None
    source_page_start: int | None = None
    source_page_end: int | None = None
    source_section_number: str | None = None
    source_section_title: str | None = None
    affected_object_ids: list[str] = Field(default_factory=list)
    affected_geometry: Polygon | None = None
    created_at: datetime
    updated_at: datetime | None = None


class PermitChecklistItem(BaseSchema):
    id: UUID
    run_id: UUID
    category: ChecklistCategory
    title: str
    description: str | None = None
    required: bool = True
    resolved: bool = False
    created_at: datetime


class PrecheckRun(BaseSchema):
    id: UUID
    project_id: UUID
    name: str | None = None
    site_context_id: UUID | None = None
    speckle_model_ref_id: UUID | None = None
    status: PrecheckRunStatus = PrecheckRunStatus.CREATED
    readiness_score: int | None = Field(default=None, ge=0, le=100)
    current_step: str | None = None
    error_message: str | None = None
    # Staleness: True when rule approvals have changed since the last evaluation.
    # Reset to False at the start of each compliance run. Surfaces in the UI as
    # "Results may be outdated — rerun compliance to update".
    is_stale: bool = False
    rules_changed_at: datetime | None = None
    # Run-specific derived metrics (FAR, lot_coverage_pct) that require both
    # model geometry data and the run's site context parcel_area_m2.
    # NULL until explicitly computed via POST .../compute-run-metrics.
    run_metrics: dict[str, Any] | None = None
    created_by: UUID
    created_at: datetime
    updated_at: datetime


# ════════════════════════════════════════════════════════════
# REQUEST / INPUT SCHEMAS
# ════════════════════════════════════════════════════════════

class ManualSiteOverrides(BaseSchema):
    """Manual overrides applied on top of external provider data."""
    municipality: str | None = None
    jurisdiction_code: str | None = None
    zoning_district: str | None = None
    parcel_area_m2: float | None = None


class CreatePrecheckRunRequest(BaseSchema):
    """POST /precheck/runs — maps to CreatePrecheckRunInputSchema in TS."""
    project_id: UUID
    name: str | None = None
    # created_by is injected from the validated JWT, not from request body


class IngestSiteRequest(BaseSchema):
    """POST /precheck/runs/{id}/ingest-site — maps to IngestSiteInputSchema (minus runId)."""
    address: str | None = None
    centroid: LatLng | None = None
    parcel_boundary: Polygon | None = None
    manual_overrides: ManualSiteOverrides | None = None


class IngestDocumentsRequest(BaseSchema):
    """POST /precheck/runs/{id}/ingest-documents — maps to IngestDocumentsInputSchema."""
    document_ids: list[UUID] = Field(min_length=1)


class SyncSpeckleModelRequest(BaseSchema):
    """POST /precheck/runs/{id}/sync-speckle-model — maps to SyncSpeckleModelInputSchema."""
    stream_id: str = Field(min_length=1)
    version_id: str = Field(min_length=1)
    branch_name: str | None = None
    model_name: str | None = None


class RegisterDocumentRequest(BaseSchema):
    """
    POST /precheck/runs/{id}/register-document

    Records a file that the client already uploaded to Supabase Storage.
    project_id is resolved server-side from the run record.
    """
    storage_path: str = Field(min_length=1)
    file_name: str = Field(min_length=1)
    mime_type: str = Field(min_length=1)
    document_type: DocumentType


# ExtractRules and EvaluateCompliance have no extra body fields in V1;
# run_id comes from the URL path only.


# ════════════════════════════════════════════════════════════
# RESPONSE SCHEMAS
# ════════════════════════════════════════════════════════════

class GetRunDetailsResponse(BaseSchema):
    """Maps to GetRunDetailsResponseSchema in TS. Used by GET /precheck/runs/{id}."""
    run: PrecheckRun
    site_context: SiteContext | None = None
    model_ref: SpeckleModelRef | None = None
    geometry_snapshot: GeometrySnapshot | None = None
    documents: list[UploadedDocument] = Field(default_factory=list)
    rules: list[ExtractedRule] = Field(default_factory=list)
    issues: list[ComplianceIssue] = Field(default_factory=list)
    checklist: list[PermitChecklistItem] = Field(default_factory=list)
    # Phase 3: authoritative readiness breakdown (null if not yet evaluated)
    readiness_breakdown: ReadinessBreakdown | None = None


class ProjectRunsResponse(BaseSchema):
    """GET /projects/{id}/precheck-runs"""
    runs: list[PrecheckRun]
    total: int


# ════════════════════════════════════════════════════════════
# INTERNAL: rule engine types (mirrors rule-engine.ts)
# ════════════════════════════════════════════════════════════

class RuleEvaluationContext(BaseSchema):
    """Input to the compliance engine's evaluate_rules method."""
    site_context: SiteContext | None = None
    geometry_snapshot: GeometrySnapshot | None = None
    metric_map: dict[MetricKey, float] = Field(default_factory=dict)


class ScoreContext(BaseSchema):
    """Input to calculate_readiness_score (mirrors scoring.ts ScoreContext)."""
    has_parcel_data: bool = False
    has_zoning_data: bool = False
    has_reviewed_rules: bool = False
    has_geometry_snapshot: bool = False


class ComplianceRunSummary(BaseSchema):
    """
    Aggregate counts produced at the end of an evaluate_rules run.
    Returned from ComplianceEngineService.evaluate_rules() alongside the
    list of ComplianceCheck rows so callers don't have to iterate again.
    """
    run_id: UUID
    total: int
    passed: int
    failed: int
    ambiguous: int
    missing_input: int
    not_evaluable: int  # rules where operator was unrecognised / value absent
    readiness_score: int | None = None  # filled in by generate_readiness_score


class ReadinessLabel(str, Enum):
    """
    Human-readable readiness band.
    Mirrors SCORE_CONFIG keys in ReadinessScoreCard.tsx.
    Computed deterministically — never set by LLM.
    """
    PERMIT_READY   = "permit_ready"
    ISSUES_TO_RESOLVE = "issues_to_resolve"
    INCOMPLETE_INPUT  = "incomplete_input"
    NOT_YET_EVALUATED = "not_yet_evaluated"


class ReadinessReason(BaseSchema):
    """
    A single contributor to the readiness score, shown as a bullet in the UI.
    Deterministic — generated by compute_readiness_breakdown().
    """
    key: str          # machine-readable stable key, e.g. "fail_error_count"
    label: str        # human-readable one-liner shown in UI
    delta: int        # score change (negative = penalty, 0 = neutral/positive)
    is_blocking: bool = False  # blocks 'Permit Ready' label regardless of numeric score


class ReadinessBreakdown(BaseSchema):
    """
    Full readiness result: score + label + ordered reasons list.

    Returned from GET /precheck/runs/{id}/summary and embedded in
    GetRunDetailsResponse as the authoritative truth for the UI.

    Label rules (enforced here, not in the frontend):
      - PERMIT_READY   : score >= 80 AND no unresolved FAIL/ERROR issues
      - ISSUES_TO_RESOLVE: score >= 60 OR (score >= 80 but blocking issues exist)
      - INCOMPLETE_INPUT: score >= 1 and score < 60
      - NOT_YET_EVALUATED: score == 0 (no geometry snapshot, or no run)
    """
    score: int
    label: ReadinessLabel
    reasons: list[ReadinessReason] = Field(default_factory=list)
    # Convenience counts used by UI badges without re-iterating reasons
    fail_count: int = 0
    warning_count: int = 0
    not_evaluable_count: int = 0
    blocking_issue_count: int = 0  # unresolved FAIL with severity >= error


class PrecheckRunSummaryResponse(BaseSchema):
    """
    GET /precheck/runs/{id}/summary

    Lightweight summary response: no full rule/doc lists, just the
    score, label, reasons, and issue/checklist counts.
    """
    run_id: UUID
    run_status: PrecheckRunStatus
    readiness: ReadinessBreakdown
    authoritative_rule_count: int
    checklist_total: int
    checklist_resolved: int
    issue_total: int
    issue_fail_count: int
    issue_warning_count: int
    issue_missing_data_count: int
    # Staleness: rules changed after last evaluation
    is_stale: bool = False
    rules_changed_at: datetime | None = None


class AsyncActionResponse(BaseSchema):
    """Returned by async pipeline steps (extract-rules, evaluate)."""
    run_id: UUID
    status: PrecheckRunStatus
    message: str


class OkResponse(BaseSchema):
    """Returned by DELETE endpoints to avoid 204 No Content body-parsing issues."""
    ok: bool = True


# ════════════════════════════════════════════════════════════
# PROJECT-LEVEL REQUEST / RESPONSE SCHEMAS
# Documents and model refs belong to the project, not to a run.
# Mirrors RegisterProjectDocumentInputSchema, SyncProjectModelInputSchema, etc.
# ════════════════════════════════════════════════════════════

class RegisterProjectDocumentRequest(BaseSchema):
    """
    POST /projects/{project_id}/documents

    Records a file that the client already uploaded to Supabase Storage,
    associating it with the project (no run required).
    Mirrors RegisterProjectDocumentInputSchema in lib/precheck/schemas.ts.
    """
    storage_path: str = Field(min_length=1)
    file_name: str = Field(min_length=1)
    mime_type: str = Field(min_length=1)
    document_type: DocumentType


class ProjectDocumentsResponse(BaseSchema):
    """
    GET /projects/{project_id}/documents
    Mirrors ProjectDocumentsResponseSchema in lib/precheck/schemas.ts.
    """
    documents: list[UploadedDocument]
    total: int


class SyncProjectModelRequest(BaseSchema):
    """
    POST /projects/{project_id}/model-refs

    Links a Speckle model version to the project without requiring a run.
    Mirrors SyncProjectModelInputSchema in lib/precheck/schemas.ts.
    """
    stream_id: str = Field(min_length=1)
    version_id: str = Field(min_length=1)
    branch_name: str | None = None
    model_name: str | None = None


class ProjectModelRefsResponse(BaseSchema):
    """
    GET /projects/{project_id}/model-refs
    Mirrors ProjectModelRefsResponseSchema in lib/precheck/schemas.ts.
    """
    model_refs: list[SpeckleModelRef]
    total: int


class SetActiveProjectModelRequest(BaseSchema):
    """
    POST /projects/{project_id}/active-model

    Designates one SpeckleModelRef as the project's active model.
    The active ref is used to pre-fill SpeckleModelPicker on new precheck runs.
    Mirrors SetActiveProjectModelInputSchema in lib/precheck/schemas.ts.
    """
    model_ref_id: UUID


class AssignModelRefRequest(BaseSchema):
    """
    POST /precheck/runs/{id}/assign-model-ref

    Links an existing SpeckleModelRef (already synced to the project)
    to this run. No new speckle_model_refs row is created — avoids
    duplicate records when the user picks from the project library.
    Mirrors AssignModelRefInputSchema in lib/precheck/schemas.ts.
    """
    model_ref_id: UUID


class AssignSiteContextRequest(BaseSchema):
    """
    POST /precheck/runs/{id}/assign-site-context

    Links an existing SiteContext (already created for the project)
    to this run. No new site_contexts row is created — avoids
    duplicate records when the user picks from the project library.
    Mirrors AssignSiteContextInputSchema in lib/precheck/schemas.ts.
    """
    site_context_id: UUID


class CreateProjectSiteContextRequest(BaseSchema):
    """
    POST /projects/{project_id}/site-contexts

    Creates a standalone site context for a project (no run required).
    Optionally sets it as the project's default.
    Mirrors CreateProjectSiteContextInputSchema in lib/precheck/schemas.ts.
    """
    address: str | None = None
    manual_overrides: ManualSiteOverrides | None = None
    set_as_default: bool = False


class SetDefaultSiteContextRequest(BaseSchema):
    """
    POST /projects/{project_id}/default-site-context

    Designates one SiteContext as the project's default site context.
    The default context pre-fills SiteContextForm on new precheck runs.
    Mirrors SetDefaultSiteContextInputSchema in lib/precheck/schemas.ts.
    """
    site_context_id: UUID


class ProjectSiteContextsResponse(BaseSchema):
    """
    GET /projects/{project_id}/site-contexts
    Mirrors ProjectSiteContextsResponseSchema in lib/precheck/schemas.ts.
    """
    site_contexts: list[SiteContext]
    total: int
    default_site_context_id: UUID | None = None


# ════════════════════════════════════════════════════════════
# PROJECT EXTRACTION OPTIONS
# Per-project configuration for AI rule extraction behaviour.
# Mirrors ProjectExtractionOptionsSchema in lib/precheck/schemas.ts.
# ════════════════════════════════════════════════════════════

class ProjectExtractionOptions(BaseSchema):
    """
    Domain model for project_extraction_options table.
    Mirrors ProjectExtractionOptionsSchema in lib/precheck/schemas.ts.
    """
    project_id: UUID
    # When true, extracted rules above threshold are auto-approved
    rule_auto_apply_enabled: bool = False
    # Confidence threshold for auto-approval (0–1). Safe default: 0.82.
    rule_auto_apply_confidence_threshold: float = Field(
        default=0.82, ge=0.0, le=1.0
    )
    # When true, manual human verification required before compliance
    manual_verification_required: bool = True
    # When true and auto_apply is on, conflict winner chosen automatically
    auto_resolve_conflicts: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SetProjectExtractionOptionsRequest(BaseSchema):
    """
    PUT /projects/{project_id}/extraction-options
    All fields optional — only supplied fields are updated.
    """
    rule_auto_apply_enabled: bool | None = None
    rule_auto_apply_confidence_threshold: float | None = Field(
        default=None, ge=0.0, le=1.0
    )
    manual_verification_required: bool | None = None
    auto_resolve_conflicts: bool | None = None


# ════════════════════════════════════════════════════════════
# RULE MANAGEMENT REQUEST SCHEMAS
# ════════════════════════════════════════════════════════════

class ApproveRuleRequest(BaseSchema):
    """
    POST /precheck/rules/{rule_id}/approve
    Marks a rule as approved and authoritative.
    """
    pass  # no body required; rule_id comes from path


class RejectRuleRequest(BaseSchema):
    """
    POST /precheck/rules/{rule_id}/reject
    Marks a rule as rejected and non-authoritative.
    """
    pass  # no body required


class CreateManualRuleRequest(BaseSchema):
    """
    POST /projects/{project_id}/rules
    Creates a user-authored rule that is authoritative by default.
    Mirrors ManualRuleInput in lib/precheck/schemas.ts.
    """
    metric_key: MetricKey
    operator: RuleOperator
    value_number: float | None = None
    value_min: float | None = None
    value_max: float | None = None
    units: str | None = None
    title: str = Field(min_length=1)
    condition_text: str | None = None
    exception_text: str | None = None
    # Optional citation for manually entered rules (e.g. user copy-pastes)
    citation_snippet: str | None = None
    citation_section: str | None = None
    citation_page: int | None = Field(default=None, ge=0)
    applicability: Applicability = Field(default_factory=Applicability)


class UpdateManualRuleRequest(BaseSchema):
    """
    PATCH /precheck/rules/{rule_id}
    Updates a manual rule. Only manual rules may be edited via this endpoint.
    """
    metric_key: MetricKey | None = None
    operator: RuleOperator | None = None
    value_number: float | None = None
    value_min: float | None = None
    value_max: float | None = None
    units: str | None = None
    title: str | None = None
    condition_text: str | None = None
    exception_text: str | None = None
    citation_snippet: str | None = None
    citation_section: str | None = None
    citation_page: int | None = Field(default=None, ge=0)
    applicability: Applicability | None = None
