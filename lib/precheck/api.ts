import type {
  CreatePrecheckRunInput,
  EvaluateComplianceInput,
  ExtractRulesInput,
  GetRunDetailsResponse,
  IngestDocumentsInput,
  IngestSiteInput,
  PrecheckRun,
  ProjectRunsResponse,
  SyncSpeckleModelInput,
} from "./types"
import { GetRunDetailsResponseSchema, PrecheckRunSchema, ProjectRunsResponseSchema } from "./schemas"

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

export async function getRunDetails(runId: string): Promise<GetRunDetailsResponse> {
  const data = await request<GetRunDetailsResponse>(`/api/agents/precheck?runId=${runId}`)
  return GetRunDetailsResponseSchema.parse(data)
}

export async function listProjectRuns(projectId: string): Promise<ProjectRunsResponse> {
  const data = await request<ProjectRunsResponse>(`/api/agents/precheck?projectId=${projectId}`)
  return ProjectRunsResponseSchema.parse(data)
}
