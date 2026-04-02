/**
 * /api/site-context/mpzp-check
 *
 * Server-side proxy for the Geoportal MPZP WMS GetFeatureInfo endpoint.
 * Called server-side to avoid CORS errors — geoportal.gov.pl does not send
 * Access-Control-Allow-Origin headers for browser-direct requests.
 *
 * Returns a JSON response with any MPZP (Miejscowy Plan Zagospodarowania
 * Przestrzennego — local zoning plan) features found at the given coordinates,
 * or { found: false, reason: 'unavailable' } if the endpoint is inaccessible.
 *
 * // COUNTRY: Poland
 */

import { NextRequest, NextResponse } from 'next/server'

// Public Geoportal ArcGIS MapServer WMS for MPZP (local zoning plans)
// LAYER 0 = plany miejscowe (local plans)
// // COUNTRY: Poland
const MPZP_WMS_URL = 'https://mapy.geoportal.gov.pl/wss/service/pub/guest/kompozycja_MPZP_WMS/MapServer/WMSServer'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')

  if (!lat || !lng) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }

  const latNum = parseFloat(lat)
  const lngNum = parseFloat(lng)

  if (isNaN(latNum) || isNaN(lngNum)) {
    return NextResponse.json({ error: 'lat and lng must be numbers' }, { status: 400 })
  }

  // Small bbox around the clicked point for WMS GetFeatureInfo
  // BBOX for WMS 1.3.0 with CRS=EPSG:4326 is lat_min,lng_min,lat_max,lng_max
  // // COUNTRY: Poland
  const delta = 0.001
  const wmsParams = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetFeatureInfo',
    LAYERS: '0',
    QUERY_LAYERS: '0',
    INFO_FORMAT: 'text/plain',
    I: '50',
    J: '50',
    WIDTH: '101',
    HEIGHT: '101',
    CRS: 'EPSG:4326',
    BBOX: `${latNum - delta},${lngNum - delta},${latNum + delta},${lngNum + delta}`,
    STYLES: '',
    FORMAT: 'image/png',
  })

  const targetUrl = `${MPZP_WMS_URL}?${wmsParams.toString()}`

  console.log('[mpzp-check] request URL:', targetUrl)

  try {
    const res = await fetch(targetUrl, {
      headers: { Accept: 'text/plain, application/json, */*' },
      signal: AbortSignal.timeout(10_000),
    })

    console.log('[mpzp-check] response status:', res.status, res.headers.get('content-type'))

    // 401/403 = endpoint requires auth or is unavailable — known Polish geoportal limitation
    // Return a clean unavailable signal instead of an error so the UI can show an info message
    // // COUNTRY: Poland
    if (res.status === 401 || res.status === 403) {
      console.warn('[mpzp-check] endpoint returned', res.status, '— geoportal auth required')
      return NextResponse.json({ found: false, reason: 'unavailable' })
    }

    if (!res.ok) {
      const body = await res.text()
      console.error('[mpzp-check] error body:', body.substring(0, 300))
      return NextResponse.json({ found: false, reason: 'unavailable' })
    }

    const text = await res.text()
    console.log('[mpzp-check] response body:', text.substring(0, 300))

    // Try JSON parse first; geoportal sometimes returns JSON
    try {
      const json = JSON.parse(text) as {
        features?: Array<{
          properties?: {
            tytul?: string
            nazwa?: string
            url_do_dokumentu?: string
            adres_url?: string
            gmina?: string
          }
        }>
      }
      return NextResponse.json({ features: json.features ?? [], found: (json.features?.length ?? 0) > 0 })
    } catch {
      // Plain text — scan for plan indicators
      // // COUNTRY: Poland
      const hasPlan = text.includes('tytul') || text.includes('plany') || text.includes('MPZP')
      console.log('[mpzp-check] non-JSON response, hasPlan:', hasPlan)
      return NextResponse.json({
        features: [],
        found: hasPlan,
        rawText: hasPlan ? text.substring(0, 500) : null,
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[mpzp-check] fetch error:', message)
    return NextResponse.json({ found: false, reason: 'unavailable' })
  }
}
