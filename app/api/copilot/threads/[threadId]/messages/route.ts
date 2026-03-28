/**
 * GET  /api/copilot/threads/[threadId]/messages  — list messages
 * POST /api/copilot/threads/[threadId]/messages  — send message → get GPT-5.4 response
 *
 * POST is the main Copilot turn endpoint. It persists the user message,
 * calls GPT-5.4 with project context + tools, and returns both messages.
 *
 * Body for POST (JSON):
 *   content:        string               — required; the user's message text
 *   uiContext?:     CopilotUiContext     — optional; current page, run, selected objects
 *   attachmentIds?: string[]             — optional; UUIDs of pre-uploaded attachments
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, proxyFastApi } from '@/lib/api/proxy'

const UiContextSchema = z.object({
  currentPage:       z.string().optional(),
  activeRunId:       z.string().uuid().optional(),
  selectedObjectIds: z.array(z.string()).optional(),
  selectedIssueId:   z.string().uuid().optional(),
})

const SendMessageSchema = z.object({
  content:       z.string().min(1).max(8000),
  uiContext:     UiContextSchema.optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
})

type RouteParams = { params: Promise<{ threadId: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { threadId } = await params
  const { searchParams } = new URL(request.url)

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/threads/${threadId}/messages`,
    method: 'GET',
    queryParams: {
      ...(searchParams.get('limit')  && { limit:  searchParams.get('limit')!  }),
      ...(searchParams.get('offset') && { offset: searchParams.get('offset')! }),
    },
  })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { threadId } = await params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SendMessageSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  // Forward using camelCase — FastAPI's alias_generator handles the conversion
  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/threads/${threadId}/messages`,
    method: 'POST',
    body: parsed.data,
  })
}
