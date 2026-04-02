/**
 * /api/site-context/parcel-report
 *
 * Fetches the official GUGiK parcel report PDF server-side and streams it
 * back to the browser. Two endpoints are tried in order with fallback:
 *
 *   1. ULDK PDF report: https://uldk.gugik.gov.pl/pdfReport?numer={region}.{parcelId}
 *      This is a public endpoint that requires no authentication.
 *
 *   2. Geoportal SLN report: https://mapy.geoportal.gov.pl/wss/service/SLN/guest/sln/dzialka/raport?numer={teryt}
 *      Requires a valid full TERYT identifier. Tried as fallback if ULDK PDF fails.
 *
 * Query params:
 *   parcelId  — parcel number returned by ULDK (e.g. "33")
 *   region    — obręb code from ULDK (e.g. "0001_5.0003")
 *
 * // COUNTRY: Poland
 */

import { NextRequest, NextResponse } from 'next/server'

// Allowed report hostnames — never proxy arbitrary URLs
const ALLOWED_HOSTS = [
  'uldk.gugik.gov.pl',
  'mapy.geoportal.gov.pl',
]

function isTrustedReportUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_HOSTS.some((h) => parsed.hostname === h)
  } catch {
    return false
  }
}

async function tryFetchPdf(url: string): Promise<Response | null> {
  if (!isTrustedReportUrl(url)) return null
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/pdf, */*' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      console.warn(`[parcel-report] ${url} returned ${res.status}`)
      return null
    }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('pdf') && !ct.includes('octet-stream')) {
      // Not a PDF — endpoint returned HTML/JSON error
      const preview = await res.text()
      console.warn(`[parcel-report] ${url} returned non-PDF content-type: ${ct}, body: ${preview.substring(0, 200)}`)
      return null
    }
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.warn(`[parcel-report] ${url} fetch error: ${msg}`)
    return null
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const parcelId = searchParams.get('parcelId')
  const region   = searchParams.get('region')

  if (!parcelId || !region) {
    return NextResponse.json({ error: 'parcelId and region are required' }, { status: 400 })
  }

  // ── Attempt 1: ULDK PDF report endpoint ─────────────────────────────────────
  // Format: {region}.{parcelId}   e.g. "0001_5.0003.33"
  // ULDK strips internal dots in region code — the numer param is region.parcelId
  // // COUNTRY: Poland
  const uldkNumer = `${region}.${parcelId}`
  const uldkUrl = `https://uldk.gugik.gov.pl/pdfReport?numer=${encodeURIComponent(uldkNumer)}`

  console.log('[parcel-report] attempt 1 — ULDK pdfReport:', uldkUrl)
  let pdfRes = await tryFetchPdf(uldkUrl)

  if (pdfRes) {
    console.log('[parcel-report] success via ULDK pdfReport')
  } else {
    // ── Attempt 2: Geoportal SLN raport endpoint ──────────────────────────────
    // Requires full TERYT identifier — same numer format works here too
    // // COUNTRY: Poland
    const slnUrl = `https://mapy.geoportal.gov.pl/wss/service/SLN/guest/sln/dzialka/raport?numer=${encodeURIComponent(uldkNumer)}`
    console.log('[parcel-report] attempt 2 — Geoportal SLN raport:', slnUrl)
    pdfRes = await tryFetchPdf(slnUrl)

    if (pdfRes) {
      console.log('[parcel-report] success via Geoportal SLN raport')
    }
  }

  if (!pdfRes) {
    console.error('[parcel-report] both endpoints failed for parcel:', uldkNumer)
    return NextResponse.json(
      { error: 'Parcel report unavailable', numer: uldkNumer },
      { status: 502 }
    )
  }

  const body = await pdfRes.arrayBuffer()
  const safeParcelId = parcelId.replace(/[^a-zA-Z0-9_\-]/g, '_')

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="parcel-report-${safeParcelId}.pdf"`,
      'Cache-Control': 'public, max-age=300',
    },
  })
}
