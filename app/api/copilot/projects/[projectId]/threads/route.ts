/**
 * GET /api/copilot/projects/[projectId]/threads
 *
 * Lists all non-archived copilot threads for the project.
 * Proxies to GET /copilot/projects/{projectId}/threads on FastAPI.
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
    path: `/copilot/projects/${projectId}/threads`,
    method: 'GET',
    queryParams: {
      ...(searchParams.get('include_archived') === 'true' && { include_archived: 'true' }),
      ...(searchParams.get('limit') && { limit: searchParams.get('limit')! }),
      ...(searchParams.get('offset') && { offset: searchParams.get('offset')! }),
    },
  })
}
