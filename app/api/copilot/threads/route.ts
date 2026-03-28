/**
 * POST /api/copilot/threads
 *
 * Creates a new copilot thread for a project.
 * Proxies to POST /copilot/threads on FastAPI.
 *
 * Body (JSON):
 *   projectId:    string (UUID)  — required
 *   title?:       string         — optional; auto-generated from first message if absent
 *   activeRunId?: string (UUID)  — optional; run active when thread was opened
 *   pageContext?: string         — optional; e.g. "viewer", "precheck"
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, proxyFastApi } from '@/lib/api/proxy'

const CreateThreadSchema = z.object({
  projectId:    z.string().uuid(),
  title:        z.string().max(200).optional(),
  activeRunId:  z.string().uuid().optional(),
  pageContext:  z.string().max(100).optional(),
})

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateThreadSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: '/copilot/threads',
    method: 'POST',
    body: parsed.data,
  })
}
