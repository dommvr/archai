/**
 * lib/api/proxy.ts
 *
 * Shared FastAPI proxy helpers used by all Next.js API routes.
 * Extracted so the pattern is not duplicated across route files.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'

export interface AuthResult {
  userId: string
  accessToken: string
}

/**
 * Validate the Supabase session and extract the access token from the request
 * cookies. Returns a 401 NextResponse on failure, or the auth data on success.
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<AuthResult | NextResponse> {
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

/**
 * Proxy a request to the FastAPI backend, forwarding the Supabase JWT.
 * Thin wrapper — no business logic.
 */
export async function proxyFastApi(input: {
  accessToken: string
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  queryParams?: Record<string, string>
}): Promise<NextResponse> {
  const baseUrl = getFastApiBaseUrl()
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'FastAPI backend URL is not configured. Set NEXT_PUBLIC_API_URL.' },
      { status: 503 }
    )
  }

  let url = `${baseUrl}${input.path}`
  if (input.queryParams) {
    const qs = new URLSearchParams(input.queryParams).toString()
    if (qs) url += `?${qs}`
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: input.method,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      cache: 'no-store',
    })
  } catch (err) {
    // FastAPI is not reachable (not running, wrong port, etc.)
    return NextResponse.json(
      {
        error: 'Backend unavailable',
        detail: err instanceof Error ? err.message : 'Could not connect to FastAPI',
      },
      { status: 503 }
    )
  }

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

function getFastApiBaseUrl(): string | null {
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ??
    process.env.API_URL?.replace(/\/$/, '') ??
    null
  )
}

/**
 * Extract the Supabase access token from the request cookies.
 *
 * @supabase/ssr stores the session token under a key of the form:
 *   sb-<project-ref>-auth-token
 *
 * Two complications this handles correctly:
 *
 * 1. CHUNKING — when the serialised token exceeds the browser cookie size
 *    limit, @supabase/ssr splits it into numbered chunks:
 *      sb-abc123-auth-token.0
 *      sb-abc123-auth-token.1
 *    We must reassemble them in order before parsing.
 *
 * 2. BASE64 ENCODING — newer versions of @supabase/ssr write the value as
 *    "base64-<url-safe-base64>" instead of raw JSON. We decode it first.
 *
 * This implementation is intentionally identical to the one in
 * app/api/agents/[tool]/route.ts, which is proven to work in this repo.
 * Do not simplify it — the naive JSON.parse-only version breaks in prod.
 */
function extractAccessToken(request: NextRequest): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return null

  let projectRef: string
  try {
    projectRef = new URL(supabaseUrl).hostname.split('.')[0] ?? ''
  } catch {
    return null
  }

  const storageKey = `sb-${projectRef}-auth-token`
  const cookieValue = combineCookieChunks(request, storageKey)
  if (!cookieValue) return null

  // Decode base64url encoding if present
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

/**
 * Reassemble a potentially chunked cookie value.
 *
 * Looks for cookies named exactly `storageKey` (unchunked) or
 * `storageKey.0`, `storageKey.1`, … (chunked), sorts by index,
 * and concatenates the values.
 */
function combineCookieChunks(request: NextRequest, storageKey: string): string | null {
  const allCookies = request.cookies.getAll()

  // Fast path: single unchunked cookie
  const direct = allCookies.find((c) => c.name === storageKey)?.value
  if (direct) return direct

  // Chunked path: collect all `storageKey.N` cookies
  const chunks = allCookies
    .filter((c) => c.name === storageKey || c.name.startsWith(`${storageKey}.`))
    .sort((a, b) => chunkIndex(a.name, storageKey) - chunkIndex(b.name, storageKey))
    .map((c) => c.value)

  return chunks.length > 0 ? chunks.join('') : null
}

function chunkIndex(name: string, storageKey: string): number {
  if (name === storageKey) return -1
  const suffix = name.slice(storageKey.length + 1)
  const n = Number.parseInt(suffix, 10)
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8')
}
