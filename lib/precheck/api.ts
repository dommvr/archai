import type {
  ApproveRuleInput,
  AssignModelRefInput,
  AssignSiteContextInput,
  ComputeRunMetricsInput,
  CreateManualRuleInput,
  CreateProjectSiteContextInput,
  DeleteProjectSiteContextInput,
  CreatePrecheckRunInput,
  DeleteProjectModelInput,
  EvaluateComplianceInput,
  ExtractedRule,
  ExtractRulesInput,
  GeometrySnapshot,
  GetRunDetailsResponse,
  IngestDocumentsInput,
  IngestSiteInput,
  PrecheckRun,
  PrecheckRunSummaryResponse,
  ProjectActiveModelResponse,
  ProjectDefaultSiteContextResponse,
  ProjectDocumentsResponse,
  ProjectExtractionOptions,
  ProjectModelRefsResponse,
  ProjectRunsResponse,
  ProjectSiteContextsResponse,
  RegisterDocumentInput,
  RegisterProjectDocumentInput,
  RejectRuleInput,
  RunReportData,
  SetActiveProjectModelInput,
  SetDefaultSiteContextInput,
  SetProjectExtractionOptionsInput,
  SyncProjectModelInput,
  SyncSpeckleModelInput,
  UpdateManualRuleInput,
  DeleteManualRuleInput,
  UploadedDocument,
} from "./types"
import {
  ExtractedRuleSchema,
  GeometrySnapshotSchema,
  GetRunDetailsResponseSchema,
  PrecheckRunSchema,
  PrecheckRunSummaryResponseSchema,
  ProjectActiveModelResponseSchema,
  ProjectDefaultSiteContextResponseSchema,
  ProjectDocumentsResponseSchema,
  ProjectExtractionOptionsSchema,
  ProjectModelRefsResponseSchema,
  ProjectRunsResponseSchema,
  ProjectSiteContextsResponseSchema,
  RunReportDataSchema,
  SiteContextSchema,
  SpeckleModelRefSchema,
  UploadedDocumentSchema,
} from "./schemas"
import type { SiteContext, SpeckleModelRef } from "./types"
import { z } from "zod"

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Request failed with ${response.status}`)
  }

  return response.json()
}

export async function createPrecheckRun(input: CreatePrecheckRunInput): Promise<PrecheckRun> {
  const data = await request<PrecheckRun>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "create_run", payload: input }),
  })
  return PrecheckRunSchema.parse(data)
}

export async function ingestSite(input: IngestSiteInput) {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "ingest_site", payload: input }),
  })
}

export async function ingestDocuments(input: IngestDocumentsInput) {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "ingest_documents", payload: input }),
  })
}

export async function extractRules(input: ExtractRulesInput) {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "extract_rules", payload: input }),
  })
}

export async function syncSpeckleModel(input: SyncSpeckleModelInput) {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "sync_speckle_model", payload: input }),
  })
}

export async function evaluateCompliance(input: EvaluateComplianceInput) {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "evaluate_compliance", payload: input }),
  })
}

/** Compute run-specific metrics (FAR, lot_coverage_pct) from model geometry + site context. */
export async function computeRunMetrics(input: ComputeRunMetricsInput): Promise<PrecheckRun> {
  const data = await request<PrecheckRun>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "compute_run_metrics", payload: input }),
  })
  return PrecheckRunSchema.parse(data)
}

export async function getRunDetails(
  runId: string,
  init?: Pick<RequestInit, "signal">
): Promise<GetRunDetailsResponse> {
  const data = await request<GetRunDetailsResponse>(`/api/agents/precheck?runId=${runId}`, init)
  return GetRunDetailsResponseSchema.parse(data)
}

export async function getRunSummary(
  runId: string,
  init?: Pick<RequestInit, "signal">
): Promise<PrecheckRunSummaryResponse> {
  const data = await request<PrecheckRunSummaryResponse>(
    `/api/agents/precheck?runId=${runId}&scope=summary`,
    init,
  )
  return PrecheckRunSummaryResponseSchema.parse(data)
}

export async function listProjectRuns(projectId: string): Promise<ProjectRunsResponse> {
  const data = await request<ProjectRunsResponse>(`/api/agents/precheck?projectId=${projectId}`)
  return ProjectRunsResponseSchema.parse(data)
}

export async function registerDocument(input: RegisterDocumentInput): Promise<UploadedDocument> {
  const data = await request<UploadedDocument>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "register_document", payload: input }),
  })
  return UploadedDocumentSchema.parse(data)
}

export async function deleteDocument(documentId: string): Promise<{ ok: true }> {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "delete_document", payload: { documentId } }),
  })
}

export async function deleteRun(runId: string): Promise<{ ok: true }> {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "delete_run", payload: { runId } }),
  })
}

// ── Project-level (no run required) ─────────────────────────────────────────

/**
 * Register a document directly against the project without a run.
 * Used by the project-level document upload flow.
 */
export async function registerProjectDocument(
  input: RegisterProjectDocumentInput
): Promise<UploadedDocument> {
  const data = await request<UploadedDocument>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "register_project_document", payload: input }),
  })
  return UploadedDocumentSchema.parse(data)
}

/** List all documents for a project (not filtered by run). */
export async function listProjectDocuments(
  projectId: string
): Promise<ProjectDocumentsResponse> {
  const data = await request<ProjectDocumentsResponse>(
    `/api/agents/precheck?projectId=${projectId}&scope=documents`
  )
  return ProjectDocumentsResponseSchema.parse(data)
}

/** List all Speckle model refs synced to a project. */
export async function listProjectModelRefs(
  projectId: string
): Promise<ProjectModelRefsResponse> {
  const data = await request<ProjectModelRefsResponse>(
    `/api/agents/precheck?projectId=${projectId}&scope=model_refs`
  )
  return ProjectModelRefsResponseSchema.parse(data)
}

/**
 * Sync a Speckle model at the project level (no run required).
 * Returns the created/updated SpeckleModelRef.
 */
export async function syncProjectModel(
  input: SyncProjectModelInput
): Promise<SpeckleModelRef> {
  const data = await request<SpeckleModelRef>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "sync_project_model", payload: input }),
  })
  return SpeckleModelRefSchema.parse(data)
}

/**
 * Get the active SpeckleModelRef for a project.
 * Returns null if no active model has been set.
 */
export async function getProjectActiveModelRef(
  projectId: string
): Promise<ProjectActiveModelResponse> {
  const data = await request<ProjectActiveModelResponse>(
    `/api/agents/precheck?projectId=${projectId}&scope=active_model`
  )
  return ProjectActiveModelResponseSchema.parse(data)
}

/**
 * Set the active model for a project.
 * Persisted server-side on the project record.
 */
export async function setActiveProjectModel(
  input: SetActiveProjectModelInput
): Promise<{ ok: true }> {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "set_active_project_model", payload: input }),
  })
}

/**
 * Delete a project model ref.
 * If it was the active model, the backend clears the active pointer first.
 */
export async function deleteProjectModel(
  input: DeleteProjectModelInput
): Promise<{ ok: true }> {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "delete_project_model", payload: input }),
  })
}

/**
 * Assign an existing project SpeckleModelRef to a run without creating a new row.
 * Use this when the user picks from the project model library in SpeckleModelPicker
 * to avoid duplicating speckle_model_refs rows for the same stream+version.
 */
export async function assignModelRefToRun(
  input: AssignModelRefInput
): Promise<{ ok: true }> {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "assign_model_ref", payload: input }),
  })
}

/**
 * Assign an existing project SiteContext to a run without creating a new row.
 * Use this when the user picks from the project site context library in SiteContextPicker
 * to avoid duplicating site_contexts rows for the same project.
 */
export async function assignSiteContextToRun(
  input: AssignSiteContextInput
): Promise<{ ok: true }> {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "assign_site_context", payload: input }),
  })
}

// ── Project-level site context ────────────────────────────────────────────────

/** List all site contexts for a project (including which is default). */
export async function listProjectSiteContexts(
  projectId: string
): Promise<ProjectSiteContextsResponse> {
  const data = await request<ProjectSiteContextsResponse>(
    `/api/agents/precheck?projectId=${projectId}&scope=site_contexts`
  )
  return ProjectSiteContextsResponseSchema.parse(data)
}

/**
 * Get the default SiteContext for a project.
 * Returns null if no default site context has been set.
 */
export async function getProjectDefaultSiteContext(
  projectId: string
): Promise<ProjectDefaultSiteContextResponse> {
  const data = await request<ProjectDefaultSiteContextResponse>(
    `/api/agents/precheck?projectId=${projectId}&scope=default_site_context`
  )
  return ProjectDefaultSiteContextResponseSchema.parse(data)
}

/**
 * Create a new standalone SiteContext for a project (no run required).
 * Used from Project Overview to add site data without starting a precheck run.
 * Optionally sets the new context as the project default (input.setAsDefault).
 */
export async function createProjectSiteContext(
  input: CreateProjectSiteContextInput
): Promise<SiteContext> {
  const data = await request<SiteContext>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "create_project_site_context", payload: input }),
  })
  return SiteContextSchema.parse(data)
}

/**
 * Delete a SiteContext from a project.
 * FK constraints (ON DELETE SET NULL) automatically clear any run or project
 * default pointer that referenced this context — no manual cleanup needed.
 */
export async function deleteProjectSiteContext(
  input: DeleteProjectSiteContextInput
): Promise<{ ok: true }> {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "delete_project_site_context", payload: input }),
  })
}

/**
 * Set the default site context for a project.
 * The default pre-fills SiteContextForm when creating a new precheck run.
 */
export async function setProjectDefaultSiteContext(
  input: SetDefaultSiteContextInput
): Promise<{ ok: true }> {
  return request("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "set_default_site_context", payload: input }),
  })
}

// ── Rule management (V2) ─────────────────────────────────────────────────────

/** List all rules for a project (all runs + manual rules). */
export async function listProjectRules(projectId: string): Promise<ExtractedRule[]> {
  const data = await request<ExtractedRule[]>(
    `/api/agents/precheck?projectId=${projectId}&scope=rules`
  )
  return z.array(ExtractedRuleSchema).parse(data)
}

/** Mark a rule as approved (is_authoritative = true). */
export async function approveRule(input: ApproveRuleInput): Promise<ExtractedRule> {
  const data = await request<ExtractedRule>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "approve_rule", payload: input }),
  })
  return ExtractedRuleSchema.parse(data)
}

/** Mark a rule as rejected (excluded from compliance evaluation). */
export async function rejectRule(input: RejectRuleInput): Promise<ExtractedRule> {
  const data = await request<ExtractedRule>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "reject_rule", payload: input }),
  })
  return ExtractedRuleSchema.parse(data)
}

/**
 * Revert an approved extracted rule back to draft (non-authoritative).
 * Raises 422 for manual rules (they cannot be unapproved).
 */
export async function unapproveRule(input: ApproveRuleInput): Promise<ExtractedRule> {
  const data = await request<ExtractedRule>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "unapprove_rule", payload: input }),
  })
  return ExtractedRuleSchema.parse(data)
}

/** Create a manual rule scoped to the project (authoritative by default). */
export async function createManualRule(input: CreateManualRuleInput): Promise<ExtractedRule> {
  const data = await request<ExtractedRule>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "create_manual_rule", payload: input }),
  })
  return ExtractedRuleSchema.parse(data)
}

/** Update fields on a manual rule (source_kind='manual' only). */
export async function updateManualRule(input: UpdateManualRuleInput): Promise<ExtractedRule> {
  const data = await request<ExtractedRule>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "update_manual_rule", payload: input }),
  })
  return ExtractedRuleSchema.parse(data)
}

/** Hard-delete a manual rule (source_kind='manual' only). Returns 204 No Content. */
export async function deleteManualRule(input: DeleteManualRuleInput): Promise<void> {
  await request<void>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "delete_manual_rule", payload: input }),
  })
}

/**
 * Get the latest project-level geometry snapshot for a model ref.
 * Returns null if metrics haven't been derived yet (background task still running).
 */
export async function getModelRefSnapshot(
  projectId: string,
  modelRefId: string
): Promise<GeometrySnapshot | null> {
  const data = await request<GeometrySnapshot | null>(
    `/api/agents/precheck?projectId=${projectId}&modelRefId=${modelRefId}&scope=model_snapshot`
  )
  return GeometrySnapshotSchema.nullable().parse(data)
}

/** Get the project's rule extraction options (returns defaults if not configured). */
export async function getProjectExtractionOptions(
  projectId: string
): Promise<ProjectExtractionOptions> {
  const data = await request<ProjectExtractionOptions>(
    `/api/agents/precheck?projectId=${projectId}&scope=extraction_options`
  )
  return ProjectExtractionOptionsSchema.parse(data)
}

/** Upsert the project's rule extraction options. */
export async function setProjectExtractionOptions(
  input: SetProjectExtractionOptionsInput
): Promise<ProjectExtractionOptions> {
  const data = await request<ProjectExtractionOptions>("/api/agents/precheck", {
    method: "POST",
    body: JSON.stringify({ action: "set_extraction_options", payload: input }),
  })
  return ProjectExtractionOptionsSchema.parse(data)
}

// ── Report data ──────────────────────────────────────────────────────────────

/**
 * Fetch the full structured report payload for a run.
 * Used by ComplianceSummaryTab (on-screen) and the PDF download flow.
 * Both views derive from this same payload, so they can never diverge.
 */
export async function getRunReportData(
  runId: string,
  init?: Pick<RequestInit, "signal">
): Promise<RunReportData> {
  const data = await request<RunReportData>(
    `/api/agents/precheck?runId=${runId}&scope=report_data`,
    init,
  )
  return RunReportDataSchema.parse(data)
}

/**
 * Trigger a PDF download for a run's compliance report.
 * Fetches the binary PDF from the backend via the Next.js proxy and
 * triggers a browser download using a temporary object URL.
 *
 * The run name (or a fallback) is used as the suggested filename.
 * If the run is stale, the PDF is still downloaded but contains a
 * prominent stale warning — no blocking, just transparency.
 */
export async function downloadRunReportPdf(
  runId: string,
  suggestedFilename?: string
): Promise<void> {
  const response = await fetch(
    `/api/agents/precheck?runId=${runId}&scope=report_pdf`,
    { cache: "no-store" }
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Failed to generate report: ${response.status}`)
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  // Filename format: "{run_name} - summary.pdf"
  // Sanitise: keep alphanumeric, spaces, hyphens, underscores, dots.
  const safeName = suggestedFilename
    ? suggestedFilename.replace(/[^a-z0-9_\-. ]/gi, "_").trim() || "run"
    : "run"
  a.download = `${safeName} - summary.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
