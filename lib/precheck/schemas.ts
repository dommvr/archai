import { z } from "zod"
import {
  CHECKLIST_CATEGORIES,
  CHECK_RESULT_STATUSES,
  ISSUE_SEVERITIES,
  METRIC_KEYS,
  PRECHECK_RUN_STATUSES,
  RULE_SOURCE_KINDS,
  RULE_STATUSES,
} from "./constants"

export const LatLngSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})

export const PolygonRingSchema = z.array(z.tuple([z.number(), z.number()]))

export const PolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(PolygonRingSchema),
})

export const RuleCitationSchema = z.object({
  documentId: z.string().uuid(),
  page: z.number().int().nonnegative().nullable().optional(),
  section: z.string().nullable().optional(),
  snippet: z.string(),
  chunkId: z.string().uuid().nullable().optional(),
})

export const ApplicabilitySchema = z.object({
  jurisdictionCode: z.string().nullable().optional(),
  zoningDistricts: z.array(z.string()).default([]),
  buildingTypes: z.array(z.string()).default([]),
  occupancies: z.array(z.string()).default([]),
})

// All text/numeric/jsonb columns without NOT NULL in site_contexts are nullable.
export const SiteContextSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  address: z.string().nullable().optional(),
  municipality: z.string().nullable().optional(),
  jurisdictionCode: z.string().nullable().optional(),
  zoningDistrict: z.string().nullable().optional(),
  overlays: z.array(z.string()).default([]),
  parcelId: z.string().nullable().optional(),
  parcelAreaM2: z.number().nullable().optional(),
  centroid: LatLngSchema.nullable().optional(),
  parcelBoundary: PolygonSchema.nullable().optional(),
  sourceProvider: z.string(),
  rawSourceData: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// run_id and jurisdiction_code are nullable in uploaded_documents.
export const UploadedDocumentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  runId: z.string().uuid().nullable().optional(),
  storagePath: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  documentType: z.enum(["zoning_code", "building_code", "project_doc", "other"]),
  jurisdictionCode: z.string().nullable().optional(),
  uploadedAt: z.string(),
})

// All nullable columns in document_chunks: page, section, embedding_raw, metadata.
export const DocumentChunkSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  page: z.number().int().nonnegative().nullable().optional(),
  section: z.string().nullable().optional(),
  chunkIndex: z.number().int().nonnegative(),
  text: z.string(),
  embedding: z.array(z.number()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

// Nullable columns: description, value_number, value_min, value_max,
// units, extraction_notes — all text/numeric without NOT NULL.
// V2 adds: sourceKind, isAuthoritative, isRecommended, conflictGroupId,
// conditionText, exceptionText, normalizationNote, effectiveDate, versionLabel,
// sourceChunkId. documentId and citation are now nullable (manual rules).
export const ExtractedRuleSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  documentId: z.string().uuid().nullable().optional(),
  ruleCode: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  metricKey: z.enum(METRIC_KEYS),
  operator: z.enum(["<", "<=", ">", ">=", "=", "between"]),
  valueNumber: z.number().nullable().optional(),
  valueMin: z.number().nullable().optional(),
  valueMax: z.number().nullable().optional(),
  units: z.string().nullable().optional(),
  applicability: ApplicabilitySchema,
  citation: RuleCitationSchema.nullable().optional(),
  confidence: z.number().min(0).max(1),
  status: z.enum(RULE_STATUSES),
  extractionNotes: z.string().nullable().optional(),
  // V2 authority + provenance fields
  sourceKind: z.enum(RULE_SOURCE_KINDS).default("extracted"),
  isAuthoritative: z.boolean().default(false),
  isRecommended: z.boolean().default(false),
  conflictGroupId: z.string().uuid().nullable().optional(),
  conditionText: z.string().nullable().optional(),
  exceptionText: z.string().nullable().optional(),
  normalizationNote: z.string().nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
  versionLabel: z.string().nullable().optional(),
  sourceChunkId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// branch_name, model_name, commit_message, synced_at are nullable in speckle_model_refs.
// synced_at is stamped when derive_geometry_snapshot_for_model completes.
export const SpeckleModelRefSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  streamId: z.string(),
  branchName: z.string().nullable().optional(),
  versionId: z.string(),
  modelName: z.string().nullable().optional(),
  commitMessage: z.string().nullable().optional(),
  selectedAt: z.string(),
  syncedAt: z.string().datetime({ offset: true }).nullable().optional(),
})

// units and computationNotes are serialised as null by Pydantic when unset.
export const GeometrySnapshotMetricSchema = z.object({
  key: z.enum(METRIC_KEYS),
  value: z.number(),
  units: z.string().nullable().optional(),
  sourceObjectIds: z.array(z.string()).default([]),
  computationNotes: z.string().nullable().optional(),
})

export const GeometrySnapshotSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  runId: z.string().uuid().nullable().optional(),
  speckleModelRefId: z.string().uuid(),
  siteBoundary: PolygonSchema.nullable().optional(),
  buildingFootprints: z.array(
    z.object({
      objectId: z.string(),
      polygon: PolygonSchema,
      level: z.string().nullable().optional(),
    })
  ).default([]),
  floors: z.array(
    z.object({
      level: z.string(),
      areaM2: z.number(),
      objectIds: z.array(z.string()).default([]),
    })
  ).default([]),
  metrics: z.array(GeometrySnapshotMetricSchema).default([]),
  rawMetrics: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
})

// actual_value, expected_value, expected_min, expected_max, units are
// nullable numeric/text columns in compliance_checks.
export const ComplianceCheckSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  ruleId: z.string().uuid(),
  metricKey: z.enum(METRIC_KEYS),
  status: z.enum(CHECK_RESULT_STATUSES),
  actualValue: z.number().nullable().optional(),
  expectedValue: z.number().nullable().optional(),
  expectedMin: z.number().nullable().optional(),
  expectedMax: z.number().nullable().optional(),
  units: z.string().nullable().optional(),
  createdAt: z.string(),
})

// rule_id and check_id use ON DELETE SET NULL so they are nullable UUIDs.
// explanation, metric_key, value fields, citation, affected_geometry are
// all nullable columns in compliance_issues.
export const ComplianceIssueSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  ruleId: z.string().uuid().nullable().optional(),
  checkId: z.string().uuid().nullable().optional(),
  severity: z.enum(ISSUE_SEVERITIES),
  title: z.string(),
  summary: z.string(),
  explanation: z.string().nullable().optional(),
  status: z.enum(CHECK_RESULT_STATUSES),
  metricKey: z.enum(METRIC_KEYS).nullable().optional(),
  actualValue: z.number().nullable().optional(),
  expectedValue: z.number().nullable().optional(),
  expectedMin: z.number().nullable().optional(),
  expectedMax: z.number().nullable().optional(),
  units: z.string().nullable().optional(),
  citation: RuleCitationSchema.nullable().optional(),
  affectedObjectIds: z.array(z.string()).default([]),
  affectedGeometry: PolygonSchema.nullable().optional(),
  createdAt: z.string(),
})

// description is nullable in permit_checklist_items.
export const PermitChecklistItemSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  category: z.enum(CHECKLIST_CATEGORIES),
  title: z.string(),
  description: z.string().nullable().optional(),
  required: z.boolean().default(true),
  resolved: z.boolean().default(false),
  createdAt: z.string(),
})

// site_context_id and speckle_model_ref_id are FK UUIDs with ON DELETE SET NULL.
// readiness_score and error_message are nullable by design (unset until evaluated).
// current_step is nullable text — null on a freshly created run.
export const PrecheckRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().nullable().optional(),
  siteContextId: z.string().uuid().nullable().optional(),
  speckleModelRefId: z.string().uuid().nullable().optional(),
  status: z.enum(PRECHECK_RUN_STATUSES),
  readinessScore: z.number().min(0).max(100).nullable().optional(),
  currentStep: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const CreatePrecheckRunInputSchema = z.object({
  projectId: z.string().uuid(),
  createdBy: z.string().uuid(),
  name: z.string().optional(),
})

export const IngestSiteInputSchema = z.object({
  runId: z.string().uuid(),
  address: z.string().min(3).optional(),
  centroid: LatLngSchema.optional(),
  parcelBoundary: PolygonSchema.optional(),
  manualOverrides: z.object({
    municipality: z.string().optional(),
    jurisdictionCode: z.string().optional(),
    zoningDistrict: z.string().optional(),
    parcelAreaM2: z.number().optional(),
  }).optional(),
})

export const IngestDocumentsInputSchema = z.object({
  runId: z.string().uuid(),
  documentIds: z.array(z.string().uuid()).min(1),
})

export const ExtractRulesInputSchema = z.object({
  runId: z.string().uuid(),
})

export const SyncSpeckleModelInputSchema = z.object({
  runId: z.string().uuid(),
  streamId: z.string().min(1),
  versionId: z.string().min(1),
  branchName: z.string().optional(),
  modelName: z.string().optional(),
})

export const EvaluateComplianceInputSchema = z.object({
  runId: z.string().uuid(),
})

export const RegisterDocumentInputSchema = z.object({
  runId: z.string().uuid(),
  storagePath: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  documentType: z.enum(["zoning_code", "building_code", "project_doc", "other"]),
})

export const GetRunDetailsResponseSchema = z.object({
  run: PrecheckRunSchema,
  siteContext: SiteContextSchema.nullable(),
  modelRef: SpeckleModelRefSchema.nullable(),
  geometrySnapshot: GeometrySnapshotSchema.nullable(),
  documents: z.array(UploadedDocumentSchema),
  rules: z.array(ExtractedRuleSchema),
  issues: z.array(ComplianceIssueSchema),
  checklist: z.array(PermitChecklistItemSchema),
})

export const ProjectRunsResponseSchema = z.object({
  runs: z.array(PrecheckRunSchema),
  total: z.number().int().nonnegative(),
})

export const DeleteDocumentInputSchema = z.object({
  documentId: z.string().uuid(),
})

export const DeleteRunInputSchema = z.object({
  runId: z.string().uuid(),
})

// ── Project-level (no run required) ─────────────────────────────────────────

/**
 * Register a document directly against the project, without associating it
 * with a specific run. Used by the project-level document upload flow.
 */
export const RegisterProjectDocumentInputSchema = z.object({
  projectId: z.string().uuid(),
  storagePath: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  documentType: z.enum(["zoning_code", "building_code", "project_doc", "other"]),
})

export const ProjectDocumentsResponseSchema = z.object({
  documents: z.array(UploadedDocumentSchema),
  total: z.number().int().nonnegative(),
})

/**
 * Sync a Speckle model directly against the project, without associating it
 * with a specific run. Used by the project-level model sync flow.
 * Returns a SpeckleModelRef that belongs to the project.
 */
export const SyncProjectModelInputSchema = z.object({
  projectId: z.string().uuid(),
  streamId: z.string().min(1),
  versionId: z.string().min(1),
  branchName: z.string().optional(),
  modelName: z.string().optional(),
})

export const ProjectModelRefsResponseSchema = z.object({
  modelRefs: z.array(SpeckleModelRefSchema),
  total: z.number().int().nonnegative(),
})

export const SetActiveProjectModelInputSchema = z.object({
  projectId: z.string().uuid(),
  modelRefId: z.string().uuid(),
})

export const DeleteProjectModelInputSchema = z.object({
  projectId: z.string().uuid(),
  modelRefId: z.string().uuid(),
})

/**
 * Response from GET /projects/{id}/active-model.
 * The backend returns null (JSON `null`) when no active model is set.
 */
export const ProjectActiveModelResponseSchema = SpeckleModelRefSchema.nullable()

/**
 * Assign an existing project SpeckleModelRef to a run without creating a new row.
 * Used when the user picks from the project model library in SpeckleModelPicker.
 * Mirrors AssignModelRefRequest in backend/app/core/schemas.py.
 */
export const AssignModelRefInputSchema = z.object({
  runId: z.string().uuid(),
  modelRefId: z.string().uuid(),
})

/**
 * Assign an existing project SiteContext to a run without creating a new row.
 * Used when the user picks from the project context library in SiteContextPicker.
 * Mirrors AssignSiteContextRequest in backend/app/core/schemas.py.
 */
export const AssignSiteContextInputSchema = z.object({
  runId: z.string().uuid(),
  siteContextId: z.string().uuid(),
})

/**
 * Create a standalone SiteContext for a project (no run required).
 * Used from Project Overview to add a new default site context directly.
 * Mirrors CreateProjectSiteContextRequest in backend/app/core/schemas.py.
 */
export const CreateProjectSiteContextInputSchema = z.object({
  projectId: z.string().uuid(),
  address: z.string().optional(),
  manualOverrides: z.object({
    municipality: z.string().optional(),
    jurisdictionCode: z.string().optional(),
    zoningDistrict: z.string().optional(),
    parcelAreaM2: z.number().optional(),
  }).optional(),
  setAsDefault: z.boolean().optional(),
})

export const DeleteProjectSiteContextInputSchema = z.object({
  projectId: z.string().uuid(),
  siteContextId: z.string().uuid(),
})

// ── Project-level site context ────────────────────────────────────────────────

export const SetDefaultSiteContextInputSchema = z.object({
  projectId: z.string().uuid(),
  siteContextId: z.string().uuid(),
})

export const ProjectSiteContextsResponseSchema = z.object({
  siteContexts: z.array(SiteContextSchema),
  total: z.number().int().nonnegative(),
  defaultSiteContextId: z.string().uuid().nullable().optional(),
})

/**
 * Response from GET /projects/{id}/default-site-context.
 * The backend returns null (JSON `null`) when no default is set.
 */
export const ProjectDefaultSiteContextResponseSchema = SiteContextSchema.nullable()

// ── Rule management (V2) ─────────────────────────────────────────────────────

export const ProjectExtractionOptionsSchema = z.object({
  projectId: z.string().uuid(),
  ruleAutoApplyEnabled: z.boolean().default(false),
  ruleAutoApplyConfidenceThreshold: z.number().min(0).max(1).default(0.82),
  manualVerificationRequired: z.boolean().default(true),
  autoResolveConflicts: z.boolean().default(false),
})

export const SetProjectExtractionOptionsInputSchema = z.object({
  projectId: z.string().uuid(),
  ruleAutoApplyEnabled: z.boolean().optional(),
  ruleAutoApplyConfidenceThreshold: z.number().min(0).max(1).optional(),
  manualVerificationRequired: z.boolean().optional(),
  autoResolveConflicts: z.boolean().optional(),
})

export const ApproveRuleInputSchema = z.object({
  ruleId: z.string().uuid(),
})

export const RejectRuleInputSchema = z.object({
  ruleId: z.string().uuid(),
})

/**
 * Fields the user can set when adding a manual rule.
 * Mirrors CreateManualRuleRequest in backend/app/core/schemas.py.
 */
export const CreateManualRuleInputSchema = z.object({
  projectId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  ruleCode: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  metricKey: z.enum(METRIC_KEYS),
  operator: z.enum(["<", "<=", ">", ">=", "=", "between"]),
  valueNumber: z.number().optional(),
  valueMin: z.number().optional(),
  valueMax: z.number().optional(),
  units: z.string().optional(),
  applicability: ApplicabilitySchema.optional(),
  conditionText: z.string().optional(),
  exceptionText: z.string().optional(),
  effectiveDate: z.string().optional(),
  versionLabel: z.string().optional(),
  extractionNotes: z.string().optional(),
})

/**
 * Editable fields for an existing manual rule (source_kind='manual').
 * Mirrors UpdateManualRuleRequest in backend/app/core/schemas.py.
 */
export const UpdateManualRuleInputSchema = z.object({
  ruleId: z.string().uuid(),
  ruleCode: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  operator: z.enum(["<", "<=", ">", ">=", "=", "between"]).optional(),
  valueNumber: z.number().nullable().optional(),
  valueMin: z.number().nullable().optional(),
  valueMax: z.number().nullable().optional(),
  units: z.string().nullable().optional(),
  applicability: ApplicabilitySchema.optional(),
  conditionText: z.string().nullable().optional(),
  exceptionText: z.string().nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
  versionLabel: z.string().nullable().optional(),
  extractionNotes: z.string().nullable().optional(),
})
