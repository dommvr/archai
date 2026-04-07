import { NextRequest, NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { ToolId } from '@/types'
import {
  ApproveRuleInputSchema,
  AssignModelRefInputSchema,
  AssignSiteContextInputSchema,
  ComputeRunMetricsInputSchema,
  CreateManualRuleInputSchema,
  CreatePrecheckRunInputSchema,
  CreateProjectSiteContextInputSchema,
  DeleteProjectSiteContextInputSchema,
  DeleteDocumentInputSchema,
  DeleteProjectModelInputSchema,
  DeleteRunInputSchema,
  EvaluateComplianceInputSchema,
  ExtractRulesInputSchema,
  IngestDocumentsInputSchema,
  IngestSiteInputSchema,
  RejectRuleInputSchema,
  RegisterDocumentInputSchema,
  RegisterProjectDocumentInputSchema,
  SetActiveProjectModelInputSchema,
  SetDefaultSiteContextInputSchema,
  SetProjectExtractionOptionsInputSchema,
  SyncProjectModelInputSchema,
  SyncSpeckleModelInputSchema,
  UpdateManualRuleInputSchema,
  DeleteManualRuleInputSchema,
} from '@/lib/precheck/schemas'

type PrecheckAction =
  | 'create_run'
  | 'ingest_site'
  | 'ingest_documents'
  | 'extract_rules'
  | 'sync_speckle_model'
  | 'assign_model_ref'
  | 'assign_site_context'
  | 'evaluate_compliance'
  | 'register_document'
  | 'delete_document'
  | 'delete_run'
  // Project-level actions (no run required)
  | 'register_project_document'
  | 'sync_project_model'
  | 'set_active_project_model'
  | 'delete_project_model'
  | 'set_default_site_context'
  | 'create_project_site_context'
  | 'delete_project_site_context'
  | 'compute_run_metrics'
  // Rule management (V2)
  | 'approve_rule'
  | 'unapprove_rule'
  | 'reject_rule'
  | 'create_manual_rule'
  | 'update_manual_rule'
  | 'delete_manual_rule'
  | 'set_extraction_options'

type PrecheckPayload = Record<string, unknown>

const TOOL_STUBS: Partial<Record<ToolId | string, object>> = {
  'site-analysis': {
    analysis: null,
    violations: [],
    status: 'stub',
    message: 'Site analysis not yet implemented — FastAPI integration pending',
  },
  'massing-generator': {
    model: null,
    options: [],
    status: 'stub',
    message: 'Massing generator not yet implemented — FastAPI integration pending',
  },
  'space-planner': {
    layout: null,
    rooms: [],
    status: 'stub',
    message: 'Space planner not yet implemented — FastAPI integration pending',
  },
  'live-metrics': {
    gfa: 4250,
    carbon: 312000,
    efficiency: 78,
    codeRisk: 'low',
    status: 'stub',
    message: 'Returning demo values — FastAPI integration pending',
  },
  'option-comparison': {
    options: [],
    comparison: null,
    status: 'stub',
    message: 'Option comparison not yet implemented — FastAPI integration pending',
  },
  'sustainability-copilot': {
    carbonBreakdown: null,
    solarAnalysis: null,
    status: 'stub',
    message: 'Sustainability copilot not yet implemented — Ladybug integration pending',
  },
  'firm-knowledge': {
    results: [],
    citations: [],
    status: 'stub',
    message: 'Firm knowledge RAG not yet implemented — pgvector integration pending',
  },
  'brief-translator': {
    program: null,
    rooms: [],
    status: 'stub',
    message: 'Brief translator not yet implemented — LangGraph agent pending',
  },
  'spec-writer': {
    specification: null,
    sections: [],
    status: 'stub',
    message: 'Spec writer not yet implemented — LangGraph agent pending',
  },
  'sketch-to-bim': {
    elements: [],
    status: 'stub',
    message: 'Sketch-to-BIM not yet implemented — Replicate vision model pending',
  },
  'export-sync': {
    exportUrl: null,
    status: 'stub',
    message: 'Export sync not yet implemented — Speckle export integration pending',
  },
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tool: string }> }
) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) {
    return auth
  }

  const { tool } = await params
  let body: Record<string, unknown> = {}

  try {
    body = await request.json()
  } catch {
    body = {}
  }

  if (tool === 'precheck') {
    return handlePrecheckPost(body, auth.accessToken)
  }

  const toolData = TOOL_STUBS[tool as ToolId]
  if (!toolData) {
    return NextResponse.json({ error: `Unknown tool: ${tool}` }, { status: 404 })
  }

  return NextResponse.json({
    tool,
    userId: auth.userId,
    timestamp: new Date().toISOString(),
    ...toolData,
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tool: string }> }
) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) {
    return auth
  }

  const { tool } = await params
  if (tool === 'precheck') {
    return handlePrecheckGet(request, auth.accessToken)
  }

  return NextResponse.json({
    tool,
    status: 'placeholder',
    message: `Tool '${tool}' endpoint active — backend integration pending`,
    // FASTAPI CALL PLACEHOLDER
  })
}

async function handlePrecheckPost(
  body: Record<string, unknown>,
  accessToken: string
) {
  const action = body.action
  const payload = (body.payload ?? {}) as PrecheckPayload

  if (typeof action !== 'string') {
    return NextResponse.json({ error: 'Missing action field' }, { status: 400 })
  }

  switch (action as PrecheckAction) {
    case 'create_run': {
      const parsed = validatePayload(CreatePrecheckRunInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: '/precheck/runs',
        method: 'POST',
        body: { projectId: parsed.projectId, name: parsed.name },
      })
    }

    case 'ingest_site': {
      const parsed = validatePayload(IngestSiteInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${parsed.runId}/ingest-site`,
        method: 'POST',
        body: {
          address: parsed.address,
          centroid: parsed.centroid,
          parcelBoundary: parsed.parcelBoundary,
          manualOverrides: parsed.manualOverrides,
        },
      })
    }

    case 'ingest_documents': {
      const parsed = validatePayload(IngestDocumentsInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${parsed.runId}/ingest-documents`,
        method: 'POST',
        body: { documentIds: parsed.documentIds },
      })
    }

    case 'extract_rules': {
      const parsed = validatePayload(ExtractRulesInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${parsed.runId}/extract-rules`,
        method: 'POST',
      })
    }

    case 'sync_speckle_model': {
      const parsed = validatePayload(SyncSpeckleModelInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${parsed.runId}/sync-speckle-model`,
        method: 'POST',
        body: {
          streamId: parsed.streamId,
          versionId: parsed.versionId,
          branchName: parsed.branchName,
          modelName: parsed.modelName,
        },
      })
    }

    case 'assign_model_ref': {
      const parsed = validatePayload(AssignModelRefInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${parsed.runId}/assign-model-ref`,
        method: 'POST',
        body: { modelRefId: parsed.modelRefId },
      })
    }

    case 'assign_site_context': {
      const parsed = validatePayload(AssignSiteContextInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${parsed.runId}/assign-site-context`,
        method: 'POST',
        body: { siteContextId: parsed.siteContextId },
      })
    }

    case 'evaluate_compliance': {
      const parsed = validatePayload(EvaluateComplianceInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${parsed.runId}/evaluate`,
        method: 'POST',
      })
    }

    case 'compute_run_metrics': {
      const parsed = validatePayload(ComputeRunMetricsInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${parsed.runId}/compute-run-metrics`,
        method: 'POST',
      })
    }

    case 'register_document': {
      const parsed = validatePayload(RegisterDocumentInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${parsed.runId}/register-document`,
        method: 'POST',
        body: {
          storagePath: parsed.storagePath,
          fileName: parsed.fileName,
          mimeType: parsed.mimeType,
          documentType: parsed.documentType,
        },
      })
    }

    case 'delete_document': {
      const parsed = validatePayload(DeleteDocumentInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/documents/${parsed.documentId}`,
        method: 'DELETE',
      })
    }

    case 'delete_run': {
      const parsed = validatePayload(DeleteRunInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${parsed.runId}`,
        method: 'DELETE',
      })
    }

    // ── Project-level actions (no run required) ────────────────────────────

    case 'register_project_document': {
      const parsed = validatePayload(RegisterProjectDocumentInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/projects/${parsed.projectId}/documents`,
        method: 'POST',
        body: {
          storagePath: parsed.storagePath,
          fileName: parsed.fileName,
          mimeType: parsed.mimeType,
          documentType: parsed.documentType,
        },
      })
    }

    case 'sync_project_model': {
      const parsed = validatePayload(SyncProjectModelInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/projects/${parsed.projectId}/model-refs`,
        method: 'POST',
        body: {
          streamId: parsed.streamId,
          versionId: parsed.versionId,
          branchName: parsed.branchName,
          modelName: parsed.modelName,
        },
      })
    }

    case 'set_active_project_model': {
      const parsed = validatePayload(SetActiveProjectModelInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/projects/${parsed.projectId}/active-model`,
        method: 'POST',
        body: { modelRefId: parsed.modelRefId },
      })
    }

    case 'delete_project_model': {
      const parsed = validatePayload(DeleteProjectModelInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/projects/${parsed.projectId}/model-refs/${parsed.modelRefId}`,
        method: 'DELETE',
      })
    }

    case 'set_default_site_context': {
      const parsed = validatePayload(SetDefaultSiteContextInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/projects/${parsed.projectId}/default-site-context`,
        method: 'POST',
        body: { siteContextId: parsed.siteContextId },
      })
    }

    case 'create_project_site_context': {
      const parsed = validatePayload(CreateProjectSiteContextInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/projects/${parsed.projectId}/site-contexts`,
        method: 'POST',
        body: {
          address: parsed.address,
          manualOverrides: parsed.manualOverrides,
          setAsDefault: parsed.setAsDefault ?? false,
        },
      })
    }

    case 'delete_project_site_context': {
      const parsed = validatePayload(DeleteProjectSiteContextInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/projects/${parsed.projectId}/site-contexts/${parsed.siteContextId}`,
        method: 'DELETE',
      })
    }

    // ── Rule management (V2) ───────────────────────────────────────────────

    case 'approve_rule': {
      const parsed = validatePayload(ApproveRuleInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/rules/${parsed.ruleId}/approve`,
        method: 'POST',
      })
    }

    case 'unapprove_rule': {
      const parsed = validatePayload(ApproveRuleInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/rules/${parsed.ruleId}/unapprove`,
        method: 'POST',
      })
    }

    case 'reject_rule': {
      const parsed = validatePayload(RejectRuleInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/rules/${parsed.ruleId}/reject`,
        method: 'POST',
      })
    }

    case 'create_manual_rule': {
      const parsed = validatePayload(CreateManualRuleInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/projects/${parsed.projectId}/rules`,
        method: 'POST',
        body: parsed,
      })
    }

    case 'update_manual_rule': {
      const parsed = validatePayload(UpdateManualRuleInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      const { ruleId, ...updates } = parsed
      return proxyFastApi({
        accessToken,
        path: `/precheck/rules/${ruleId}`,
        method: 'PATCH',
        body: updates,
      })
    }

    case 'delete_manual_rule': {
      const parsed = validatePayload(DeleteManualRuleInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      return proxyFastApi({
        accessToken,
        path: `/precheck/rules/${parsed.ruleId}`,
        method: 'DELETE',
      })
    }

    case 'set_extraction_options': {
      const parsed = validatePayload(SetProjectExtractionOptionsInputSchema, payload)
      if (parsed instanceof NextResponse) {
        return parsed
      }

      const { projectId, ...options } = parsed
      return proxyFastApi({
        accessToken,
        path: `/projects/${projectId}/extraction-options`,
        method: 'PUT',
        body: options,
      })
    }

    default:
      return NextResponse.json({ error: `Unknown precheck action: ${action}` }, { status: 400 })
  }
}

async function handlePrecheckGet(request: NextRequest, accessToken: string) {
  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('runId')
  const projectId = searchParams.get('projectId')
  const scope = searchParams.get('scope')

  if (runId) {
    if (scope === 'summary') {
      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${runId}/summary`,
        method: 'GET',
      })
    }
    if (scope === 'report_data') {
      return proxyFastApi({
        accessToken,
        path: `/precheck/runs/${runId}/report-data`,
        method: 'GET',
      })
    }
    if (scope === 'report_pdf') {
      return proxyFastApiBinary({
        accessToken,
        path: `/precheck/runs/${runId}/report.pdf`,
      })
    }
    return proxyFastApi({
      accessToken,
      path: `/precheck/runs/${runId}`,
      method: 'GET',
    })
  }

  if (projectId) {
    // Project-level scoped queries
    if (scope === 'documents') {
      return proxyFastApi({
        accessToken,
        path: `/projects/${projectId}/documents`,
        method: 'GET',
      })
    }

    if (scope === 'model_refs') {
      return proxyFastApi({
        accessToken,
        path: `/projects/${projectId}/model-refs`,
        method: 'GET',
      })
    }

    if (scope === 'active_model') {
      return proxyFastApi({
        accessToken,
        path: `/projects/${projectId}/active-model`,
        method: 'GET',
      })
    }

    if (scope === 'site_contexts') {
      return proxyFastApi({
        accessToken,
        path: `/projects/${projectId}/site-contexts`,
        method: 'GET',
      })
    }

    if (scope === 'default_site_context') {
      return proxyFastApi({
        accessToken,
        path: `/projects/${projectId}/default-site-context`,
        method: 'GET',
      })
    }

    if (scope === 'rules') {
      return proxyFastApi({
        accessToken,
        path: `/projects/${projectId}/rules`,
        method: 'GET',
      })
    }

    if (scope === 'extraction_options') {
      return proxyFastApi({
        accessToken,
        path: `/projects/${projectId}/extraction-options`,
        method: 'GET',
      })
    }

    if (scope === 'model_snapshot') {
      const modelRefId = searchParams.get('modelRefId')
      if (!modelRefId) {
        return NextResponse.json({ error: 'Missing modelRefId parameter' }, { status: 400 })
      }
      return proxyFastApi({
        accessToken,
        path: `/projects/${projectId}/model-refs/${modelRefId}/snapshot`,
        method: 'GET',
      })
    }

    // Default: list precheck runs for the project
    return proxyFastApi({
      accessToken,
      path: `/projects/${projectId}/precheck-runs`,
      method: 'GET',
    })
  }

  return NextResponse.json({
    tool: 'precheck',
    status: 'placeholder',
    message: 'Precheck tool endpoint active — provide ?runId= or ?projectId= for data',
  })
}

async function authenticateRequest(request: NextRequest) {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (!user || error) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accessToken = extractAccessToken(request)
  if (!accessToken) {
    return NextResponse.json({ error: 'Missing access token' }, { status: 401 })
  }

  return { userId: user.id, accessToken }
}

function validatePayload<T>(
  schema: ZodType<T>,
  payload: PrecheckPayload
): T | NextResponse {
  const result = schema.safeParse(payload)
  if (!result.success) {
    return NextResponse.json({ error: result.error.flatten() }, { status: 422 })
  }

  return result.data
}

async function proxyFastApi(input: {
  accessToken: string
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}) {
  const baseUrl = getFastApiBaseUrl()
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'FastAPI backend URL is not configured' },
      { status: 500 }
    )
  }

  const response = await fetch(`${baseUrl}${input.path}`, {
    method: input.method,
    headers: {
      'Authorization': `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    cache: 'no-store',
  })

  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? 'application/json'

  if (contentType.includes('application/json')) {
    const data = text ? JSON.parse(text) : null
    return NextResponse.json(data, { status: response.status })
  }

  return new NextResponse(text, {
    status: response.status,
    headers: { 'Content-Type': contentType },
  })
}

/**
 * Proxy a binary response (e.g. PDF) from FastAPI to the client.
 * Unlike proxyFastApi, this reads the raw ArrayBuffer and forwards
 * the Content-Disposition header so the browser triggers a download.
 */
async function proxyFastApiBinary(input: {
  accessToken: string
  path: string
}) {
  const baseUrl = getFastApiBaseUrl()
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'FastAPI backend URL is not configured' },
      { status: 500 }
    )
  }

  const response = await fetch(`${baseUrl}${input.path}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${input.accessToken}` },
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text()
    return NextResponse.json(
      { error: text || `Backend returned ${response.status}` },
      { status: response.status }
    )
  }

  const buffer = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  const contentDisposition = response.headers.get('content-disposition') ?? ''

  const headers: Record<string, string> = { 'Content-Type': contentType }
  if (contentDisposition) headers['Content-Disposition'] = contentDisposition

  return new NextResponse(buffer, { status: 200, headers })
}

function getFastApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? process.env.API_URL?.replace(/\/$/, '') ?? null
}

function extractAccessToken(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    return null
  }

  let hostname: string
  try {
    hostname = new URL(supabaseUrl).hostname.split('.')[0] ?? ''
  } catch {
    return null
  }

  const storageKey = `sb-${hostname}-auth-token`
  const cookieValue = combineCookieChunks(request, storageKey)
  if (!cookieValue) {
    return null
  }

  const decoded = cookieValue.startsWith('base64-')
    ? decodeBase64Url(cookieValue.slice('base64-'.length))
    : cookieValue

  try {
    const parsed = JSON.parse(decoded) as
      | { access_token?: string; session?: { access_token?: string } }
      | null

    return parsed?.access_token ?? parsed?.session?.access_token ?? null
  } catch {
    return null
  }
}

function combineCookieChunks(request: NextRequest, storageKey: string) {
  const allCookies = request.cookies.getAll()
  const direct = allCookies.find((cookie) => cookie.name === storageKey)?.value
  if (direct) {
    return direct
  }

  const chunkValues = allCookies
    .filter((cookie) => cookie.name === storageKey || cookie.name.startsWith(`${storageKey}.`))
    .sort((left, right) => getChunkIndex(left.name, storageKey) - getChunkIndex(right.name, storageKey))
    .map((cookie) => cookie.value)

  if (chunkValues.length === 0) {
    return null
  }

  return chunkValues.join('')
}

function getChunkIndex(name: string, storageKey: string) {
  if (name === storageKey) {
    return -1
  }

  const suffix = name.slice(storageKey.length + 1)
  const parsed = Number.parseInt(suffix, 10)
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8')
}
