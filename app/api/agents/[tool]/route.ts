import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { ToolId } from '@/types'
import {
  CreatePrecheckRunInputSchema,
  IngestSiteInputSchema,
  IngestDocumentsInputSchema,
  ExtractRulesInputSchema,
  SyncSpeckleModelInputSchema,
  EvaluateComplianceInputSchema,
} from '@/lib/precheck/schemas'

/**
 * Dynamic API route handler for all AI tool endpoints.
 * Path: /api/agents/[tool]
 *
 * All calls are auth-gated — returns 401 if no valid session.
 * Currently returns placeholder responses with console logging.
 *
 * Future integration:
 * - Replace the stub responses with fetch() calls to FastAPI
 * - Pass the Supabase JWT in Authorization: Bearer header to FastAPI
 * - FastAPI verifies JWT using the Supabase JWT secret
 * - Stream responses using SSE for long-running LangGraph agent runs
 *
 * FASTAPI CALL PLACEHOLDER
 * LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
 *
 * NOTE: In Next.js 15+, `params` is a Promise — must be awaited.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tool: string }> }
) {
  // Auth check — CRITICAL: always use getUser(), not getSession()
  const supabase = await getSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (!user || error) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { tool } = await params
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // Empty body is acceptable for some tool calls
  }

  console.log(`→ Calling FastAPI /${tool}`, { userId: user.id, tool, body })

  // ── Precheck: action-based dispatch ─────────────────────────────────────────
  if (tool === 'precheck') {
    return handlePrecheckPost(body)
  }

  // Tool-specific placeholder responses
  // FASTAPI CALL PLACEHOLDER — replace each case with:
  // const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/${tool}`, {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Authorization': `Bearer ${session.access_token}`,
  //   },
  //   body: JSON.stringify(body),
  // })
  // return NextResponse.json(await res.json(), { status: res.status })

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

  const toolData = TOOL_STUBS[tool as ToolId]

  if (!toolData) {
    return NextResponse.json(
      { error: `Unknown tool: ${tool}` },
      { status: 404 }
    )
  }

  return NextResponse.json({
    tool,
    userId: user.id,
    timestamp: new Date().toISOString(),
    ...toolData,
  })
}

/**
 * GET handler — returns tool metadata/status, or precheck run details if ?runId= is provided.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tool: string }> }
) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { tool } = await params

  if (tool === 'precheck') {
    return handlePrecheckGet(request)
  }

  return NextResponse.json({
    tool,
    status: 'placeholder',
    message: `Tool '${tool}' endpoint active — backend integration pending`,
    // FASTAPI CALL PLACEHOLDER
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Precheck handlers
// FASTAPI CALL PLACEHOLDER — each action will proxy to FastAPI /precheck/*
// LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
// ─────────────────────────────────────────────────────────────────────────────

function handlePrecheckPost(body: Record<string, unknown>): NextResponse {
  const action = body.action
  const payload = body.payload as Record<string, unknown> | undefined

  if (typeof action !== 'string') {
    return NextResponse.json({ error: 'Missing action field' }, { status: 400 })
  }

  switch (action) {
    case 'create_run': {
      const result = CreatePrecheckRunInputSchema.safeParse(payload)
      if (!result.success) {
        return NextResponse.json({ error: result.error.flatten() }, { status: 422 })
      }
      // FASTAPI CALL PLACEHOLDER
      return NextResponse.json({
        action,
        status: 'stub',
        runId: crypto.randomUUID(),
        message: 'Precheck run created (stub) — FastAPI integration pending',
      })
    }

    case 'ingest_site': {
      const result = IngestSiteInputSchema.safeParse(payload)
      if (!result.success) {
        return NextResponse.json({ error: result.error.flatten() }, { status: 422 })
      }
      // FASTAPI CALL PLACEHOLDER
      return NextResponse.json({
        action,
        status: 'stub',
        message: 'Site context ingested (stub) — site data provider integration pending',
      })
    }

    case 'ingest_documents': {
      const result = IngestDocumentsInputSchema.safeParse(payload)
      if (!result.success) {
        return NextResponse.json({ error: result.error.flatten() }, { status: 422 })
      }
      // FASTAPI CALL PLACEHOLDER
      return NextResponse.json({
        action,
        status: 'stub',
        message: 'Documents ingested (stub) — Supabase Storage + embedding pipeline pending',
      })
    }

    case 'extract_rules': {
      const result = ExtractRulesInputSchema.safeParse(payload)
      if (!result.success) {
        return NextResponse.json({ error: result.error.flatten() }, { status: 422 })
      }
      // FASTAPI CALL PLACEHOLDER
      // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
      return NextResponse.json({
        action,
        status: 'stub',
        rules: [],
        message: 'Rule extraction (stub) — LangGraph agent pending',
      })
    }

    case 'sync_speckle_model': {
      const result = SyncSpeckleModelInputSchema.safeParse(payload)
      if (!result.success) {
        return NextResponse.json({ error: result.error.flatten() }, { status: 422 })
      }
      // FASTAPI CALL PLACEHOLDER
      // SPECKLE VIEWER WILL BE MOUNTED HERE
      return NextResponse.json({
        action,
        status: 'stub',
        message: 'Speckle model synced (stub) — Speckle geometry extraction pending',
      })
    }

    case 'evaluate_compliance': {
      const result = EvaluateComplianceInputSchema.safeParse(payload)
      if (!result.success) {
        return NextResponse.json({ error: result.error.flatten() }, { status: 422 })
      }
      // FASTAPI CALL PLACEHOLDER
      // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
      return NextResponse.json({
        action,
        status: 'stub',
        issues: [],
        readinessScore: null,
        message: 'Compliance evaluation (stub) — rule engine + LangGraph agent pending',
      })
    }

    default:
      return NextResponse.json({ error: `Unknown precheck action: ${action}` }, { status: 400 })
  }
}

function handlePrecheckGet(request: NextRequest): NextResponse {
  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('runId')
  const projectId = searchParams.get('projectId')

  if (runId) {
    // FASTAPI CALL PLACEHOLDER — GET /precheck/runs/:runId
    return NextResponse.json({
      run: null,
      siteContext: null,
      modelRef: null,
      geometrySnapshot: null,
      issues: [],
      checklist: [],
      status: 'stub',
      message: `Run details for ${runId} (stub) — FastAPI integration pending`,
    })
  }

  if (projectId) {
    // FASTAPI CALL PLACEHOLDER — GET /precheck/runs?projectId=
    return NextResponse.json({
      runs: [],
      status: 'stub',
      message: `Project runs for ${projectId} (stub) — FastAPI integration pending`,
    })
  }

  return NextResponse.json({
    tool: 'precheck',
    status: 'placeholder',
    message: 'Precheck tool endpoint active — provide ?runId= or ?projectId= for data',
  })
}
