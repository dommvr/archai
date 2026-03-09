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
    EVALUATING        = "evaluating"
    GENERATING_REPORT = "generating_report"
    COMPLETED         = "completed"
    FAILED            = "failed"


class RuleStatus(str, Enum):
    DRAFT    = "draft"
    REVIEWED = "reviewed"
    REJECTED = "rejected"


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
    # Note: field is 'chunk_text' in Postgres (reserved word avoidance) but 'text' in TS schema
    text: str
    embedding: list[float] | None = None
    metadata: dict[str, Any] | None = None


class ExtractedRule(BaseSchema):
    id: UUID
    project_id: UUID
    document_id: UUID
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
    citation: RuleCitation
    confidence: float = Field(ge=0.0, le=1.0)
    status: RuleStatus = RuleStatus.DRAFT
    extraction_notes: str | None = None
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


class GeometrySnapshotMetric(BaseSchema):
    key: MetricKey
    value: float
    units: str | None = None
    source_object_ids: list[str] = Field(default_factory=list)
    computation_notes: str | None = None


class GeometrySnapshot(BaseSchema):
    id: UUID
    project_id: UUID
    run_id: UUID
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
    created_at: datetime


class ComplianceIssue(BaseSchema):
    id: UUID
    run_id: UUID
    rule_id: UUID | None = None
    check_id: UUID | None = None
    severity: IssueSeverity
    title: str
    summary: str
    explanation: str | None = None
    status: CheckResultStatus
    metric_key: MetricKey | None = None
    actual_value: float | None = None
    expected_value: float | None = None
    expected_min: float | None = None
    expected_max: float | None = None
    units: str | None = None
    citation: RuleCitation | None = None
    affected_object_ids: list[str] = Field(default_factory=list)
    affected_geometry: Polygon | None = None
    created_at: datetime


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
    site_context_id: UUID | None = None
    speckle_model_ref_id: UUID | None = None
    status: PrecheckRunStatus = PrecheckRunStatus.CREATED
    readiness_score: int | None = Field(default=None, ge=0, le=100)
    current_step: str | None = None
    error_message: str | None = None
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
    rules: list[ExtractedRule] = Field(default_factory=list)
    issues: list[ComplianceIssue] = Field(default_factory=list)
    checklist: list[PermitChecklistItem] = Field(default_factory=list)


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


class AsyncActionResponse(BaseSchema):
    """Returned by async pipeline steps (extract-rules, evaluate)."""
    run_id: UUID
    status: PrecheckRunStatus
    message: str
