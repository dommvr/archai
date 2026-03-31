/**
 * GET  /api/copilot/projects/[projectId]/notes  — list project notes
 * POST /api/copilot/projects/[projectId]/notes  — create a note
 *
 * Proxies to FastAPI /copilot/projects/{projectId}/notes
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, proxyFastApi } from '@/lib/api/proxy'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { projectId } = await params
  const { searchParams } = new URL(request.url)

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/projects/${projectId}/notes`,
    method: 'GET',
    queryParams: {
      ...(searchParams.get('limit') && { limit: searchParams.get('limit')! }),
    },
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { projectId } = await params
  const body = await request.json()

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/projects/${projectId}/notes`,
    method: 'POST',
    body,
  })
}
