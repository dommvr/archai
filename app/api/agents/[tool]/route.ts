import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { ToolId } from '@/types'

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

  console.log(`→ Calling FastAPI /${tool}`, {
    userId: user.id,
    tool,
    body,
  })

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
 * GET handler — returns tool metadata/status
 * Useful for health checks and tool capability discovery
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

  return NextResponse.json({
    tool,
    status: 'placeholder',
    message: `Tool '${tool}' endpoint active — backend integration pending`,
    // FASTAPI CALL PLACEHOLDER
  })
}
