/**
 * /api/site-context/parcel-report
 *
 * Fetches the official GUGiK parcel report PDF server-side and streams it
 * back to the browser.
 *
 * The caller must supply the full TERYT cadastral identifier as returned by
 * ULDK's `teryt` result field (e.g. "0226021.0001.24/35"). This is the only
 * identifier format accepted by the GUGIK PDF report endpoint. Do NOT attempt
 * to construct it from `region` + `parcelId` — those fields alone do not
 * contain the gmina TERYT code needed to form a valid identifier.
 *
 * Endpoint tried:
 *   https://uldk.gugik.gov.pl/pdfReport?numer={teryt}
 *
 * Query params:
 *   teryt  — full TERYT cadastral parcel identifier from ULDK (required)
 *
 * Error response shape:
 *   { error: string, reason: 'invalid_params'|'not_found'|'forbidden'|'non_pdf'|'upstream_error'|'gateway_error' }
 *
 * // COUNTRY: Poland
 */

import { NextRequest, NextResponse } from 'next/server'

// Only allow the GUGIK/ULDK report host — never proxy arbitrary URLs
const REPORT_HOST = 'uldk.gugik.gov.pl'

function isTrustedReportUrl(url: string): boolean {
  try {
    return new URL(url).hostname === REPORT_HOST
  } catch {
    return false
  }
}

// Structured error helper
function reportError(
  reason: 'invalid_params' | 'not_found' | 'forbidden' | 'non_pdf' | 'upstream_error' | 'gateway_error',
  detail: string,
  status: number,
): NextResponse {
  return NextResponse.json({ error: detail, reason }, { status })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const teryt = searchParams.get('teryt')

  if (!teryt || !teryt.trim()) {
    return reportError('invalid_params', 'teryt is required', 400)
  }

  // Basic sanity check — real ULDK TERYT identifiers contain digits, dots, slashes,
  // hyphens, underscores, and uppercase letters (e.g. "146510_8.0309.24/35").
  // Reject anything that could be path traversal or injection.
  // // COUNTRY: Poland
  if (!/^[\w.\-/]+$/.test(teryt)) {
    return reportError('invalid_params', 'teryt contains invalid characters', 400)
  }

  // ULDK pdfReport endpoint — accepts full TERYT cadastral identifier
  // Format: {gmina_teryt7}.{obreb4}.{parcel_number}  e.g. "0226021.0001.24/35"
  // // COUNTRY: Poland
  const reportUrl = `https://uldk.gugik.gov.pl/dzinfo.php?dzialka=${encodeURIComponent(teryt)}&print=`

  if (!isTrustedReportUrl(reportUrl)) {
    // Should never happen given the constant above, but belt-and-suspenders
    return reportError('gateway_error', 'Computed URL is not on the allowed host', 500)
  }

  console.log('[parcel-report] teryt:', teryt)
  console.log('[parcel-report] fetching:', reportUrl)

  let res: Response
  try {
    res = await fetch(reportUrl, {
      headers: { Accept: 'application/pdf, */*' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error('[parcel-report] network error:', msg)
    return reportError('gateway_error', `Network error: ${msg}`, 502)
  }

  console.log(`[parcel-report] upstream status: ${res.status}, content-type: ${res.headers.get('content-type') ?? 'none'}`)

  if (res.status === 404) {
    return reportError('not_found', `Report not found for teryt: ${teryt}`, 404)
  }
  if (res.status === 401 || res.status === 403) {
    return reportError('forbidden', `Upstream returned ${res.status}`, 502)
  }
  if (!res.ok) {
    const body = await res.text()
    console.error(`[parcel-report] upstream error ${res.status}:`, body.substring(0, 300))
    return reportError('upstream_error', `Upstream returned ${res.status}`, 502)
  }

  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('pdf') && !ct.includes('octet-stream')) {
    const preview = await res.text()
    console.error(`[parcel-report] unexpected content-type: ${ct}, body: ${preview.substring(0, 300)}`)
    return reportError('non_pdf', `Upstream returned unexpected content-type: ${ct}`, 502)
  }

  const body = await res.arrayBuffer()
  const safeId = teryt.replace(/[^a-zA-Z0-9_\-.]/g, '_')
  console.log('[parcel-report] success, streaming', body.byteLength, 'bytes')

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="parcel-report-${safeId}.pdf"`,
      'Cache-Control': 'public, max-age=300',
    },
  })
}
