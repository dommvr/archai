/**
 * GET  /api/copilot/threads/[threadId]/attachments            — list attachments
 * POST /api/copilot/threads/[threadId]/attachments            — register attachment
 * POST /api/copilot/threads/[threadId]/attachments/upload-url — get signed upload URL
 *
 * The attachment flow:
 *   1. Client requests a signed upload URL (POST /upload-url)
 *   2. Client uploads file directly to Supabase Storage using the signed URL
 *   3. Client registers the attachment (POST /) linking it to the thread
 *   4. The attachment ID is passed in SendMessageRequest.attachmentIds
 *
 * TODO: The upload-url route requires the "copilot-attachments" Supabase Storage
 * bucket to exist. See MANUAL_SETUP.md for instructions.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, proxyFastApi } from '@/lib/api/proxy'

const AttachmentTypeSchema = z.enum(['image', 'document', 'screenshot'])

const UploadUrlSchema = z.object({
  threadId:       z.string().uuid(),
  projectId:      z.string().uuid(),
  filename:       z.string().min(1).max(255),
  mimeType:       z.string(),
  attachmentType: AttachmentTypeSchema,
  fileSizeBytes:  z.number().int().positive().optional(),
})

const CreateAttachmentSchema = z.object({
  projectId:       z.string().uuid(),
  attachmentType:  AttachmentTypeSchema,
  filename:        z.string().min(1).max(255),
  mimeType:        z.string().optional(),
  storagePath:     z.string().min(1),
  fileSizeBytes:   z.number().int().positive().optional(),
  contextMetadata: z.record(z.string(), z.unknown()).optional(),
})

type RouteParams = { params: Promise<{ threadId: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { threadId } = await params

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/threads/${threadId}/attachments`,
    method: 'GET',
  })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateRequest(request)
  if (auth instanceof NextResponse) return auth

  const { threadId } = await params
  const { searchParams } = new URL(request.url)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // POST /attachments/upload-url — handled by checking `action` or a separate
  // sub-path. Since Next.js route segments are folders, we use a query flag.
  if (searchParams.get('action') === 'upload-url') {
    const parsed = UploadUrlSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
    }
    return proxyFastApi({
      accessToken: auth.accessToken,
      path: `/copilot/threads/${threadId}/attachments/upload-url`,
      method: 'POST',
      body: parsed.data,
    })
  }

  const parsed = CreateAttachmentSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  return proxyFastApi({
    accessToken: auth.accessToken,
    path: `/copilot/threads/${threadId}/attachments`,
    method: 'POST',
    body: parsed.data,
  })
}
