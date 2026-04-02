/**
 * /api/site-context/fetch-document
 *
 * Server-side proxy that fetches a PDF from a trusted Polish government
 * domain and either streams it back to the browser (for view/download)
 * or uploads it to Supabase Storage and registers it as a project document.
 *
 * Query params:
 *   url        — the PDF URL to fetch (must be from a trusted gov.pl domain)
 *   mode       — "stream" (default) | "upload"
 *   projectId  — required when mode=upload
 *   fileName   — optional display name; falls back to the URL basename
 *
 * // COUNTRY: Poland
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'

// Only fetch PDFs from these trusted Polish government domains
// // COUNTRY: Poland
const TRUSTED_DOMAINS = [
  'geoportal.gov.pl',
  'gugik.gov.pl',
  'mpzp.net',        // common MPZP hosting
  'bip.gov.pl',      // BIP (Public Information Bulletin) — some gminas host MPZP here
]

const STORAGE_BUCKET = 'precheck-documents'

function isTrustedDomain(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return TRUSTED_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    )
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url')
  const mode = searchParams.get('mode') ?? 'stream'
  const projectId = searchParams.get('projectId')
  const fileNameParam = searchParams.get('fileName')

  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  if (!isTrustedDomain(url)) {
    return NextResponse.json(
      { error: 'URL domain is not in the trusted government domain list' },
      { status: 403 }
    )
  }

  // Fetch the PDF server-side
  let pdfRes: Response
  try {
    pdfRes = await fetch(url, {
      headers: { Accept: 'application/pdf,*/*' },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Fetch failed: ${message}` }, { status: 502 })
  }

  if (!pdfRes.ok) {
    return NextResponse.json(
      { error: `Remote server returned ${pdfRes.status}` },
      { status: 502 }
    )
  }

  const contentType = pdfRes.headers.get('content-type') ?? 'application/pdf'
  const rawName = fileNameParam ?? decodeURIComponent(url.split('/').pop() ?? 'document.pdf')
  const fileName = rawName.endsWith('.pdf') ? rawName : `${rawName}.pdf`

  // ── Stream mode: return PDF bytes directly to browser ─────────────────────
  if (mode === 'stream') {
    const body = await pdfRes.arrayBuffer()
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${fileName}"`,
        // Allow browser to cache for 5 minutes
        'Cache-Control': 'public, max-age=300',
      },
    })
  }

  // ── Upload mode: store in Supabase + register document ────────────────────
  if (mode === 'upload') {
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required when mode=upload' }, { status: 400 })
    }

    // Validate auth — user must be logged in to upload
    const supabase = await getSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const buffer = await pdfRes.arrayBuffer()
    const storagePath = `projects/${projectId}/${crypto.randomUUID()}-${fileName}`

    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        upsert: false,
      })

    if (storageError) {
      return NextResponse.json(
        { error: `Storage upload failed: ${storageError.message}` },
        { status: 500 }
      )
    }

    // Register document in DB — reuse the existing project-level registration endpoint
    // We call the internal API function directly (same process, no extra HTTP hop)
    try {
      // registerProjectDocument is a client-side fetch wrapper — we need to call
      // the action route directly from the server. Use Supabase service client to
      // insert the row instead of going through the Next.js API route.
      const { data: doc, error: dbError } = await supabase
        .from('uploaded_documents')
        .insert({
          project_id: projectId,
          storage_path: storagePath,
          file_name: fileName,
          mime_type: 'application/pdf',
          document_type: 'zoning_code',
          // Source URL stored as jurisdiction_code comment for traceability
          jurisdiction_code: null,
        })
        .select()
        .single()

      if (dbError || !doc) {
        // Roll back storage upload if DB insert fails
        await supabase.storage.from(STORAGE_BUCKET).remove([storagePath])
        return NextResponse.json(
          { error: `Database registration failed: ${dbError?.message ?? 'unknown'}` },
          { status: 500 }
        )
      }

      return NextResponse.json({ ok: true, document: doc })
    } catch (err) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath])
      const message = err instanceof Error ? err.message : 'Unknown error'
      return NextResponse.json({ error: `Registration failed: ${message}` }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'mode must be stream or upload' }, { status: 400 })
}
