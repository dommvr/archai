import type { z } from "zod"
import {
  ApplicabilitySchema,
  ApproveRuleInputSchema,
  AssignModelRefInputSchema,
  AssignSiteContextInputSchema,
  ComputeRunMetricsInputSchema,
  CreateProjectSiteContextInputSchema,
  DeleteProjectSiteContextInputSchema,
  ComplianceCheckSchema,
  ComplianceIssueSchema,
  CreateManualRuleInputSchema,
  CreatePrecheckRunInputSchema,
  DeleteDocumentInputSchema,
  DeleteRunInputSchema,
  DocumentChunkSchema,
  EvaluateComplianceInputSchema,
  ExtractedRuleSchema,
  ExtractRulesInputSchema,
  GeometrySnapshotSchema,
  GetRunDetailsResponseSchema,
  IngestDocumentsInputSchema,
  IngestSiteInputSchema,
  PermitChecklistItemSchema,
  PrecheckRunSchema,
  PrecheckRunSummaryResponseSchema,
  DeleteProjectModelInputSchema,
  ProjectActiveModelResponseSchema,
  ProjectDefaultSiteContextResponseSchema,
  ProjectDocumentsResponseSchema,
  ProjectExtractionOptionsSchema,
  ProjectModelRefsResponseSchema,
  ProjectRunsResponseSchema,
  ProjectSiteContextsResponseSchema,
  ReadinessBreakdownSchema,
  ReadinessReasonSchema,
  RegisterDocumentInputSchema,
  RegisterProjectDocumentInputSchema,
  RejectRuleInputSchema,
  SetActiveProjectModelInputSchema,
  SetDefaultSiteContextInputSchema,
  SetProjectExtractionOptionsInputSchema,
  SiteContextSchema,
  SpeckleModelRefSchema,
  SyncProjectModelInputSchema,
  SyncSpeckleModelInputSchema,
  UpdateManualRuleInputSchema,
  UploadedDocumentSchema,
} from "./schemas"

export type SiteContext = z.infer<typeof SiteContextSchema>
export type UploadedDocument = z.infer<typeof UploadedDocumentSchema>
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>
export type Applicability = z.infer<typeof ApplicabilitySchema>
export type ExtractedRule = z.infer<typeof ExtractedRuleSchema>
export type SpeckleModelRef = z.infer<typeof SpeckleModelRefSchema>
export type GeometrySnapshot = z.infer<typeof GeometrySnapshotSchema>
export type ComplianceCheck = z.infer<typeof ComplianceCheckSchema>
export type ComplianceIssue = z.infer<typeof ComplianceIssueSchema>
export type PermitChecklistItem = z.infer<typeof PermitChecklistItemSchema>
export type PrecheckRun = z.infer<typeof PrecheckRunSchema>

export type CreatePrecheckRunInput = z.infer<typeof CreatePrecheckRunInputSchema>
export type IngestSiteInput = z.infer<typeof IngestSiteInputSchema>
export type IngestDocumentsInput = z.infer<typeof IngestDocumentsInputSchema>
export type ExtractRulesInput = z.infer<typeof ExtractRulesInputSchema>
export type SyncSpeckleModelInput = z.infer<typeof SyncSpeckleModelInputSchema>
export type EvaluateComplianceInput = z.infer<typeof EvaluateComplianceInputSchema>
export type RegisterDocumentInput = z.infer<typeof RegisterDocumentInputSchema>
export type GetRunDetailsResponse = z.infer<typeof GetRunDetailsResponseSchema>
export type ProjectRunsResponse = z.infer<typeof ProjectRunsResponseSchema>
export type DeleteDocumentInput = z.infer<typeof DeleteDocumentInputSchema>
export type DeleteRunInput = z.infer<typeof DeleteRunInputSchema>
export type RegisterProjectDocumentInput = z.infer<typeof RegisterProjectDocumentInputSchema>
export type ProjectDocumentsResponse = z.infer<typeof ProjectDocumentsResponseSchema>
export type SyncProjectModelInput = z.infer<typeof SyncProjectModelInputSchema>
export type ProjectModelRefsResponse = z.infer<typeof ProjectModelRefsResponseSchema>
export type SetActiveProjectModelInput = z.infer<typeof SetActiveProjectModelInputSchema>
export type ProjectActiveModelResponse = z.infer<typeof ProjectActiveModelResponseSchema>
export type DeleteProjectModelInput = z.infer<typeof DeleteProjectModelInputSchema>
export type AssignModelRefInput = z.infer<typeof AssignModelRefInputSchema>
export type AssignSiteContextInput = z.infer<typeof AssignSiteContextInputSchema>
export type CreateProjectSiteContextInput = z.infer<typeof CreateProjectSiteContextInputSchema>
export type DeleteProjectSiteContextInput = z.infer<typeof DeleteProjectSiteContextInputSchema>
export type SetDefaultSiteContextInput = z.infer<typeof SetDefaultSiteContextInputSchema>
export type ProjectSiteContextsResponse = z.infer<typeof ProjectSiteContextsResponseSchema>
export type ProjectDefaultSiteContextResponse = z.infer<typeof ProjectDefaultSiteContextResponseSchema>
export type ProjectExtractionOptions = z.infer<typeof ProjectExtractionOptionsSchema>
export type SetProjectExtractionOptionsInput = z.infer<typeof SetProjectExtractionOptionsInputSchema>
export type ApproveRuleInput = z.infer<typeof ApproveRuleInputSchema>
export type ComputeRunMetricsInput = z.infer<typeof ComputeRunMetricsInputSchema>
export type RejectRuleInput = z.infer<typeof RejectRuleInputSchema>
export type CreateManualRuleInput = z.infer<typeof CreateManualRuleInputSchema>
export type UpdateManualRuleInput = z.infer<typeof UpdateManualRuleInputSchema>
export type ReadinessReason = z.infer<typeof ReadinessReasonSchema>
export type ReadinessBreakdown = z.infer<typeof ReadinessBreakdownSchema>
export type PrecheckRunSummaryResponse = z.infer<typeof PrecheckRunSummaryResponseSchema>
