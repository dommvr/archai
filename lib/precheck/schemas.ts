import { z } from "zod"
import {
  CHECKLIST_CATEGORIES,
  CHECK_RESULT_STATUSES,
  ISSUE_SEVERITIES,
  METRIC_KEYS,
  PRECHECK_RUN_STATUSES,
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
  page: z.number().int().nonnegative().optional(),
  section: z.string().optional(),
  snippet: z.string(),
  chunkId: z.string().uuid().optional(),
})

export const ApplicabilitySchema = z.object({
  jurisdictionCode: z.string().optional(),
  zoningDistricts: z.array(z.string()).default([]),
  buildingTypes: z.array(z.string()).default([]),
  occupancies: z.array(z.string()).default([]),
})

export const SiteContextSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  address: z.string().optional(),
  municipality: z.string().optional(),
  jurisdictionCode: z.string().optional(),
  zoningDistrict: z.string().optional(),
  overlays: z.array(z.string()).default([]),
  parcelId: z.string().optional(),
  parcelAreaM2: z.number().optional(),
  centroid: LatLngSchema.optional(),
  parcelBoundary: PolygonSchema.optional(),
  sourceProvider: z.string(),
  rawSourceData: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const UploadedDocumentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  storagePath: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  documentType: z.enum(["zoning_code", "building_code", "project_doc", "other"]),
  jurisdictionCode: z.string().optional(),
  uploadedAt: z.string(),
})

export const DocumentChunkSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  page: z.number().int().nonnegative().optional(),
  section: z.string().optional(),
  chunkIndex: z.number().int().nonnegative(),
  text: z.string(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const ExtractedRuleSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  documentId: z.string().uuid(),
  ruleCode: z.string(),
  title: z.string(),
  description: z.string().optional(),
  metricKey: z.enum(METRIC_KEYS),
  operator: z.enum(["<", "<=", ">", ">=", "=", "between"]),
  valueNumber: z.number().optional(),
  valueMin: z.number().optional(),
  valueMax: z.number().optional(),
  units: z.string().optional(),
  applicability: ApplicabilitySchema,
  citation: RuleCitationSchema,
  confidence: z.number().min(0).max(1),
  status: z.enum(RULE_STATUSES),
  extractionNotes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const SpeckleModelRefSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  streamId: z.string(),
  branchName: z.string().optional(),
  versionId: z.string(),
  modelName: z.string().optional(),
  commitMessage: z.string().optional(),
  selectedAt: z.string(),
})

export const GeometrySnapshotMetricSchema = z.object({
  key: z.enum(METRIC_KEYS),
  value: z.number(),
  units: z.string().optional(),
  sourceObjectIds: z.array(z.string()).default([]),
  computationNotes: z.string().optional(),
})

export const GeometrySnapshotSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  runId: z.string().uuid(),
  speckleModelRefId: z.string().uuid(),
  siteBoundary: PolygonSchema.optional(),
  buildingFootprints: z.array(
    z.object({
      objectId: z.string(),
      polygon: PolygonSchema,
      level: z.string().optional(),
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

export const ComplianceCheckSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  ruleId: z.string().uuid(),
  metricKey: z.enum(METRIC_KEYS),
  status: z.enum(CHECK_RESULT_STATUSES),
  actualValue: z.number().optional(),
  expectedValue: z.number().optional(),
  expectedMin: z.number().optional(),
  expectedMax: z.number().optional(),
  units: z.string().optional(),
  createdAt: z.string(),
})

export const ComplianceIssueSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  ruleId: z.string().uuid().optional(),
  checkId: z.string().uuid().optional(),
  severity: z.enum(ISSUE_SEVERITIES),
  title: z.string(),
  summary: z.string(),
  explanation: z.string().optional(),
  status: z.enum(CHECK_RESULT_STATUSES),
  metricKey: z.enum(METRIC_KEYS).optional(),
  actualValue: z.number().optional(),
  expectedValue: z.number().optional(),
  expectedMin: z.number().optional(),
  expectedMax: z.number().optional(),
  units: z.string().optional(),
  citation: RuleCitationSchema.optional(),
  affectedObjectIds: z.array(z.string()).default([]),
  affectedGeometry: PolygonSchema.optional(),
  createdAt: z.string(),
})

export const PermitChecklistItemSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  category: z.enum(CHECKLIST_CATEGORIES),
  title: z.string(),
  description: z.string().optional(),
  required: z.boolean().default(true),
  resolved: z.boolean().default(false),
  createdAt: z.string(),
})

export const PrecheckRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  siteContextId: z.string().uuid().nullable().optional(),
  speckleModelRefId: z.string().uuid().nullable().optional(),
  status: z.enum(PRECHECK_RUN_STATUSES),
  readinessScore: z.number().min(0).max(100).nullable().optional(),
  currentStep: z.string().optional(),
  errorMessage: z.string().nullable().optional(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const CreatePrecheckRunInputSchema = z.object({
  projectId: z.string().uuid(),
  createdBy: z.string().uuid(),
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

export const GetRunDetailsResponseSchema = z.object({
  run: PrecheckRunSchema,
  siteContext: SiteContextSchema.nullable(),
  modelRef: SpeckleModelRefSchema.nullable(),
  geometrySnapshot: GeometrySnapshotSchema.nullable(),
  issues: z.array(ComplianceIssueSchema),
  checklist: z.array(PermitChecklistItemSchema),
})