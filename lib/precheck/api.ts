import type {
  CreatePrecheckRunInput,
  EvaluateComplianceInput,
  ExtractRulesInput,
  GetRunDetailsResponse,
  IngestDocumentsInput,
  IngestSiteInput,
  PrecheckRun,
  ProjectRunsResponse,
  RegisterDocumentInput,
  SyncSpeckleModelInput,
  UploadedDocument,
} from "./types"
import {
  GetRunDetailsResponseSchema,
  PrecheckRunSchema,
  ProjectRunsResponseSchema,
  UploadedDocumentSchema,
} from "./schemas"

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

export async function getRunDetails(
  runId: string,
  init?: Pick<RequestInit, "signal">
): Promise<GetRunDetailsResponse> {
  const data = await request<GetRunDetailsResponse>(`/api/agents/precheck?runId=${runId}`, init)
  return GetRunDetailsResponseSchema.parse(data)
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
