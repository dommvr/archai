import type { z } from "zod"
import {
  ApplicabilitySchema,
  ComplianceCheckSchema,
  ComplianceIssueSchema,
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
  ProjectRunsResponseSchema,
  RegisterDocumentInputSchema,
  SiteContextSchema,
  SpeckleModelRefSchema,
  SyncSpeckleModelInputSchema,
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
