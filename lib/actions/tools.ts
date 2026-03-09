'use server'

/**
 * ArchAI Tool Server Action Stubs
 *
 * These are placeholder Server Actions for all 11 AI tools.
 * Each function logs a placeholder message indicating which FastAPI endpoint
 * it will call when the backend is implemented.
 *
 * Pattern for wiring to FastAPI:
 *   const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/[endpoint]`, {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify(payload),
 *   })
 *   return res.json()
 *
 * Remove the placeholder comments when implementing real logic.
 */

import { headers } from 'next/headers'
import type { ToolResult } from '@/types'
import { GetRunDetailsResponseSchema, PrecheckRunSchema, ProjectRunsResponseSchema } from '@/lib/precheck/schemas'
import type {
  CreatePrecheckRunInput,
  IngestSiteInput,
  IngestDocumentsInput,
  ExtractRulesInput,
  SyncSpeckleModelInput,
  EvaluateComplianceInput,
  GetRunDetailsResponse,
  PrecheckRun,
} from '@/lib/precheck/types'

type ToolPayload = Record<string, unknown>

// ─────────────────────────────────────────────────────────────────────────────
// Tool 1: Site Analysis & Zoning Checker
// READY FOR TOOL 1 INTEGRATION HERE
// ─────────────────────────────────────────────────────────────────────────────
export async function runSiteAnalysis(projectId: string, payload?: ToolPayload): Promise<ToolResult> {
  console.log('→ Calling FastAPI /site-analysis', { projectId, payload })
  // FASTAPI CALL PLACEHOLDER
  // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
  await simulateDelay()
  return {
    toolId: 'site-analysis',
    status: 'ok',
    data: null,
    message: 'Site Analysis stub — not yet implemented',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 2: Massing Generator
// READY FOR TOOL 2 INTEGRATION HERE
// ─────────────────────────────────────────────────────────────────────────────
export async function runMassingGenerator(projectId: string, payload?: ToolPayload): Promise<ToolResult> {
  console.log('→ Calling FastAPI /massing', { projectId, payload })
  // FASTAPI CALL PLACEHOLDER
  // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
  await simulateDelay()
  return {
    toolId: 'massing-generator',
    status: 'ok',
    data: null,
    message: 'Massing Generator stub — not yet implemented',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 3: Space Planner / Test-Fit Generator
// READY FOR TOOL 3 INTEGRATION HERE
// ─────────────────────────────────────────────────────────────────────────────
export async function runSpacePlanner(projectId: string, payload?: ToolPayload): Promise<ToolResult> {
  console.log('→ Calling FastAPI /space-planner', { projectId, payload })
  // FASTAPI CALL PLACEHOLDER
  // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
  await simulateDelay()
  return {
    toolId: 'space-planner',
    status: 'ok',
    data: null,
    message: 'Space Planner stub — not yet implemented',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 4: Live Metrics
// READY FOR TOOL 4 INTEGRATION HERE
// SUPABASE REALTIME SUBSCRIPTION PLACEHOLDER
// ─────────────────────────────────────────────────────────────────────────────
export async function runLiveMetrics(projectId: string, payload?: ToolPayload): Promise<ToolResult> {
  console.log('→ Calling FastAPI /live-metrics', { projectId, payload })
  // FASTAPI CALL PLACEHOLDER
  await simulateDelay()
  return {
    toolId: 'live-metrics',
    status: 'ok',
    data: {
      gfa: 4250,
      carbon: 312000,
      efficiency: 78,
      codeRisk: 'low',
    },
    message: 'Live Metrics stub — returning demo values',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 5: Option Comparison Board
// READY FOR TOOL 5 INTEGRATION HERE
// ─────────────────────────────────────────────────────────────────────────────
export async function runOptionComparison(projectId: string, optionIds: string[]): Promise<ToolResult> {
  console.log('→ Calling FastAPI /option-comparison', { projectId, optionIds })
  // FASTAPI CALL PLACEHOLDER
  await simulateDelay()
  return {
    toolId: 'option-comparison',
    status: 'ok',
    data: null,
    message: 'Option Comparison stub — not yet implemented',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 6: Sustainability Copilot
// READY FOR TOOL 6 INTEGRATION HERE
// (Ladybug Tools integration point)
// ─────────────────────────────────────────────────────────────────────────────
export async function runSustainabilityCopilot(projectId: string, payload?: ToolPayload): Promise<ToolResult> {
  console.log('→ Calling FastAPI /sustainability', { projectId, payload })
  // FASTAPI CALL PLACEHOLDER
  // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
  // Ladybug Tools integration will run server-side via FastAPI
  await simulateDelay()
  return {
    toolId: 'sustainability-copilot',
    status: 'ok',
    data: null,
    message: 'Sustainability Copilot stub — not yet implemented',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 7: Firm Knowledge Assistant
// READY FOR TOOL 7 INTEGRATION HERE
// (pgvector RAG integration point)
// ─────────────────────────────────────────────────────────────────────────────
export async function runFirmKnowledge(query: string, projectId?: string): Promise<ToolResult> {
  console.log('→ Calling FastAPI /firm-knowledge', { query, projectId })
  // FASTAPI CALL PLACEHOLDER
  // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
  // Supabase pgvector RAG query will happen here
  await simulateDelay()
  return {
    toolId: 'firm-knowledge',
    status: 'ok',
    data: null,
    message: 'Firm Knowledge stub — not yet implemented',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 8: Brief-to-Program Translator
// READY FOR TOOL 8 INTEGRATION HERE
// ─────────────────────────────────────────────────────────────────────────────
export async function runBriefTranslator(briefText: string, projectId?: string): Promise<ToolResult> {
  console.log('→ Calling FastAPI /brief-translator', { briefLength: briefText.length, projectId })
  // FASTAPI CALL PLACEHOLDER
  // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
  await simulateDelay()
  return {
    toolId: 'brief-translator',
    status: 'ok',
    data: null,
    message: 'Brief Translator stub — not yet implemented',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 9: Spec Writer
// READY FOR TOOL 9 INTEGRATION HERE
// ─────────────────────────────────────────────────────────────────────────────
export async function runSpecWriter(projectId: string, payload?: ToolPayload): Promise<ToolResult> {
  console.log('→ Calling FastAPI /spec-writer', { projectId, payload })
  // FASTAPI CALL PLACEHOLDER
  // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
  await simulateDelay()
  return {
    toolId: 'spec-writer',
    status: 'ok',
    data: null,
    message: 'Spec Writer stub — not yet implemented',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 10: Sketch-to-BIM (part of Spec Writer module)
// READY FOR TOOL 10 INTEGRATION HERE
// (Replicate API for image-to-BIM sketch interpretation)
// ─────────────────────────────────────────────────────────────────────────────
export async function runSketchToBim(imageData: string, projectId?: string): Promise<ToolResult> {
  console.log('→ Calling FastAPI /sketch-to-bim', { imageLength: imageData.length, projectId })
  // FASTAPI CALL PLACEHOLDER
  // Replicate API call will happen here for vision model inference
  await simulateDelay()
  return {
    toolId: 'spec-writer', // shares the spec-writer tool slot
    status: 'ok',
    data: null,
    message: 'Sketch-to-BIM stub — not yet implemented',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 11: Export & Revit Sync
// READY FOR TOOL 11 INTEGRATION HERE
// SPECKLE EXPORT PLACEHOLDER
// ─────────────────────────────────────────────────────────────────────────────
export async function runExportSync(projectId: string, format: 'ifc' | 'revit' | 'rhino' | 'speckle'): Promise<ToolResult> {
  console.log('→ Calling FastAPI /export-sync', { projectId, format })
  // FASTAPI CALL PLACEHOLDER
  // SPECKLE EXPORT PLACEHOLDER — Speckle Connector sync will happen here
  // IFC export via web-ifc or IfcOpenShell will happen here
  await simulateDelay()
  return {
    toolId: 'export-sync',
    status: 'ok',
    data: null,
    message: `Export (${format}) stub — not yet implemented`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 1: Smart Zoning & Code Checker — typed precheck action wrappers
// READY FOR TOOL 1 INTEGRATION HERE
// ─────────────────────────────────────────────────────────────────────────────

export async function createPrecheckRun(
  input: CreatePrecheckRunInput
): Promise<ToolResult<PrecheckRun>> {
  const data = PrecheckRunSchema.parse(
    await callPrecheckRoute('POST', { action: 'create_run', payload: input })
  )
  return {
    toolId: 'site-analysis',
    status: 'ok',
    data,
  }
}

export async function ingestSiteContext(input: IngestSiteInput): Promise<ToolResult> {
  await callPrecheckRoute('POST', { action: 'ingest_site', payload: input })
  return {
    toolId: 'site-analysis',
    status: 'ok',
    data: null,
  }
}

export async function ingestPrecheckDocuments(input: IngestDocumentsInput): Promise<ToolResult> {
  await callPrecheckRoute('POST', { action: 'ingest_documents', payload: input })
  return {
    toolId: 'site-analysis',
    status: 'ok',
    data: null,
  }
}

export async function extractPrecheckRules(input: ExtractRulesInput): Promise<ToolResult> {
  await callPrecheckRoute('POST', { action: 'extract_rules', payload: input })
  return {
    toolId: 'site-analysis',
    status: 'ok',
    data: null,
  }
}

export async function syncPrecheckSpeckleModel(input: SyncSpeckleModelInput): Promise<ToolResult> {
  await callPrecheckRoute('POST', { action: 'sync_speckle_model', payload: input })
  return {
    toolId: 'site-analysis',
    status: 'ok',
    data: null,
  }
}

export async function evaluatePrecheckCompliance(input: EvaluateComplianceInput): Promise<ToolResult> {
  await callPrecheckRoute('POST', { action: 'evaluate_compliance', payload: input })
  return {
    toolId: 'site-analysis',
    status: 'ok',
    data: null,
  }
}

export async function getPrecheckRunDetails(runId: string): Promise<ToolResult<GetRunDetailsResponse>> {
  const data = GetRunDetailsResponseSchema.parse(
    await callPrecheckRoute('GET', undefined, `?runId=${encodeURIComponent(runId)}`)
  )
  return {
    toolId: 'site-analysis',
    status: 'ok',
    data,
  }
}

export async function listProjectPrecheckRuns(projectId: string): Promise<ToolResult<PrecheckRun[]>> {
  const data = ProjectRunsResponseSchema.parse(
    await callPrecheckRoute('GET', undefined, `?projectId=${encodeURIComponent(projectId)}`)
  )
  return {
    toolId: 'site-analysis',
    status: 'ok',
    data: data.runs,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: simulate async delay for demo feel
// Remove when implementing real backend calls
// ─────────────────────────────────────────────────────────────────────────────
function simulateDelay(ms = 800): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callPrecheckRoute(
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
  search = ''
) {
  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http'

  if (!host) {
    throw new Error('Missing host header for precheck route')
  }

  const response = await fetch(`${protocol}://${host}/api/agents/precheck${search}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return response.json()
}
