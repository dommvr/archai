/**
 * GET    /api/copilot/threads/[threadId]  — get a single thread
 * PATCH  /api/copilot/threads/[threadId]  — update title or archive
 * DELETE /api/copilot/threads/[threadId]  — archive (soft-delete)
 *
 * All proxy to the FastAPI /copilot/threads/{threadId} endpoints.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, proxyFastApi } from '@/lib/api/proxy'

const UpdateThreadSchema = z.object({
  title:    z.string().max(200).optional(),
  archived: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ threadId: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { threadId } = await params

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/threads/${threadId}`,
    method: 'GET',
  })
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { threadId } = await params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateThreadSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/threads/${threadId}`,
    method: 'PATCH',
    body: parsed.data,
  })
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { threadId } = await params

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/threads/${threadId}`,
    method: 'DELETE',
  })
}
