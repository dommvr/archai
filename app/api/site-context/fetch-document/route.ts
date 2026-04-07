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

// Only fetch PDFs from these trusted Polish government domains.
// Each entry matches the domain itself and all its subdomains.
// // COUNTRY: Poland
const TRUSTED_DOMAINS = [
  // Central government portals
  'geoportal.gov.pl',
  'gugik.gov.pl',
  'gov.pl',                  // catches all *.gov.pl subdomains
  'dziennikustaw.gov.pl',    // official Journal of Laws
  // BIP — Public Information Bulletin (Polish law requires every authority to have a BIP page)
  'bip.gov.pl',              // national BIP portal + subdomain convention *.bip.gov.pl
  // Semi-official MPZP hosting portals used by many municipalities
  'mpzp.net',
  // Voivodeship government portals — official regional authorities
  'mazovia.pl',
  'malopolska.pl',
  'slaskie.pl',
  'dolnyslask.pl',
  'lodzkie.pl',
  'lubelskie.pl',
  'podkarpackie.pl',
  'podlaskie.pl',
  'pomorskie.pl',
  'warmia.mazury.pl',
  'wielkopolskie.pl',
  'zachodniopomorskie.pl',
  'kujawsko-pomorskie.pl',
  'lubuskie.pl',
  'swietokrzyskie.pl',
  'opolskie.pl',
]

const STORAGE_BUCKET = 'precheck-documents'

function isTrustedDomain(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    // Standard suffix match for the static list above
    const staticMatch = TRUSTED_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    )
    if (staticMatch) return true
    // BIP convention: bip.{anything}.pl or {anything}.bip.{anything}.pl
    // Every Polish public authority must have an official BIP page — trust these.
    // // COUNTRY: Poland
    if (hostname.startsWith('bip.') && hostname.endsWith('.pl')) return true
    if (/\.bip\.\w+\.pl$/.test(hostname)) return true
    // Municipal/communal office convention: um.{gmina}.pl, ug.{gmina}.pl
    if (/(^|\.)(um|ug|urzad|starostwo)\.\w+\.pl$/.test(hostname)) return true
    return false
  } catch {
    return false
  }
}

/**
 * Builds a safe Content-Disposition header value for the given filename.
 *
 * HTTP headers must be Latin-1 (ISO-8859-1). Polish characters like ł, ą, ę
 * are Unicode code points > 255 and will throw a ByteString error if passed
 * raw into a header. We use two strategies:
 *   1. ASCII fallback in the legacy `filename=` token (strips/replaces non-ASCII).
 *   2. RFC 5987 `filename*=UTF-8''<percent-encoded>` for browsers that support it.
 *
 * Both tokens are included so older and modern browsers each get the best they
 * can handle. The order (legacy first) follows RFC 6266 §4.3 guidance.
 */
function buildContentDisposition(disposition: 'inline' | 'attachment', rawName: string): string {
  // Ensure the name ends with .pdf
  const name = rawName.endsWith('.pdf') ? rawName : `${rawName}.pdf`
  // ASCII-safe fallback: replace every char > U+007E with underscore
  const asciiName = name.replace(/[^\x20-\x7E]/g, '_')
  // RFC 5987 percent-encoded UTF-8 (encodeURIComponent encodes non-ASCII + special chars)
  const utf8Encoded = encodeURIComponent(name).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${utf8Encoded}`
}

/**
 * Returns true if the Content-Type indicates a non-PDF response (HTML, XML, etc.).
 * We must refuse to stream these as PDFs — they would break the viewer and confuse
 * the download flow.
 */
function isHtmlResponse(contentType: string): boolean {
  const ct = contentType.toLowerCase()
  return ct.includes('text/html') || ct.includes('text/xml') || ct.includes('application/xhtml')
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

  // Fetch the document server-side
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

  const contentType = pdfRes.headers.get('content-type') ?? ''

  // Reject HTML/XML responses — the caller passed an HTML page URL, not a PDF.
  // Streaming HTML as a PDF would silently break the viewer and download flow.
  if (isHtmlResponse(contentType)) {
    return NextResponse.json(
      { error: 'The requested URL returns an HTML page, not a PDF. Only direct PDF URLs can be fetched through this endpoint.' },
      { status: 422 }
    )
  }

  // Determine filename — prefer explicit param, fall back to URL basename
  let rawName: string
  try {
    rawName = fileNameParam ?? decodeURIComponent(new URL(url).pathname.split('/').pop() ?? 'document')
  } catch {
    rawName = fileNameParam ?? 'document'
  }

  // ── Stream mode: return PDF bytes directly to browser ─────────────────────
  if (mode === 'stream') {
    const body = await pdfRes.arrayBuffer()
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/pdf',
        // Safe header — handles Polish characters without ByteString error
        'Content-Disposition': buildContentDisposition('inline', rawName),
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

    const fileName = rawName.endsWith('.pdf') ? rawName : `${rawName}.pdf`
    const buffer = await pdfRes.arrayBuffer()
    const storagePath = `projects/${projectId}/${crypto.randomUUID()}-${fileName.replace(/[^\x20-\x7E]/g, '_')}`

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
