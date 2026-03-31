/**
 * GET    /api/copilot/notes/[noteId]  — get a single note
 * PATCH  /api/copilot/notes/[noteId]  — update title / content / pinned
 * DELETE /api/copilot/notes/[noteId]  — delete note
 *
 * Proxies to FastAPI /copilot/notes/{noteId}
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, proxyFastApi } from '@/lib/api/proxy'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { noteId } = await params

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/notes/${noteId}`,
    method: 'GET',
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { noteId } = await params
  const body = await request.json()

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/notes/${noteId}`,
    method: 'PATCH',
    body,
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { noteId } = await params

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/notes/${noteId}`,
    method: 'DELETE',
  })
}
