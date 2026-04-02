/**
 * /api/site-context/gugik-wfs
 *
 * Server-side proxy for Polish GUGiK ULDK (Usługa Lokalizacji Działek Katastralnych).
 * ULDK is the official GUGiK REST API for parcel lookup by XY coordinates.
 * It is used instead of WFS because WFS returns HTML error pages for this use case.
 *
 * Supported query types (via ?type= param):
 *   parcels      — GetParcelByXY — returns parcel boundary + metadata as GeoJSON
 *   jurisdiction — GetCommuneByXY — returns commune boundary as GeoJSON
 *
 * ULDK docs: https://uldk.gugik.gov.pl/
 * // COUNTRY: Poland
 */

import { NextRequest, NextResponse } from 'next/server'
import proj4 from 'proj4'

// EPSG:2180 — Polish national coordinate system PUWG 1992
// ULDK expects input coordinates in EPSG:2180; srid=4326 only controls output geometry CRS
// // COUNTRY: Poland
proj4.defs('EPSG:2180', '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs')

function lngLatToEPSG2180(lng: number, lat: number): [number, number] {
  // proj4 returns [easting, northing] for projected CRS
  const [easting, northing] = proj4('EPSG:4326', 'EPSG:2180', [lng, lat]) as [number, number]
  // ULDK xy parameter expects easting,northing order despite EPSG:2180 axis definition
  // // COUNTRY: Poland
  return [easting, northing]
}

// ULDK base URL — official GUGiK parcel lookup service
// // COUNTRY: Poland
const ULDK_URL = 'https://uldk.gugik.gov.pl/'

// Allowed hostnames for the proxy — never proxy arbitrary URLs
const ALLOWED_HOSTS = ['uldk.gugik.gov.pl']

function isTrustedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_HOSTS.some((h) => parsed.hostname === h)
  } catch {
    return false
  }
}

/**
 * Parse a WKT POLYGON or MULTIPOLYGON string into a GeoJSON Feature.
 * ULDK returns POLYGON for parcels and MULTIPOLYGON for regions/communes.
 * // COUNTRY: Poland — ULDK-specific WKT format
 */
function wktToGeoJSONFeature(
  wkt: string,
  props: Record<string, string>,
): object | null {
  try {
    const cleaned = wkt.replace(/^SRID=\d+;/, '').trim()

    if (cleaned.startsWith('MULTIPOLYGON')) {
      // Format: MULTIPOLYGON(((x y,x y,...),(x y,...))),((...)))
      const inner = cleaned.replace(/^MULTIPOLYGON\s*\(\s*\(\s*\(/, '').replace(/\)\s*\)\s*\)$/, '')
      const rings = inner.split(')),((')
      const coordinates = rings.map((ring) => [
        ring.split(',').map((pair) => {
          const [x, y] = pair.trim().split(/\s+/)
          return [parseFloat(x), parseFloat(y)]
        }),
      ])
      return {
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates },
        properties: props,
      }
    }

    if (cleaned.startsWith('POLYGON')) {
      const inner = cleaned.replace(/^POLYGON\s*\(\s*\(/, '').replace(/\)\s*\)$/, '')
      const coordinates = inner.split(',').map((pair) => {
        const [x, y] = pair.trim().split(/\s+/)
        return [parseFloat(x), parseFloat(y)]
      })
      if (coordinates.some(([x, y]) => isNaN(x) || isNaN(y))) return null
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coordinates] },
        properties: props,
      }
    }

    return null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')

  if (type === 'parcels') {
    return handleParcels(searchParams)
  }
  if (type === 'jurisdiction') {
    return handleJurisdiction(searchParams)
  }

  return NextResponse.json({ error: 'Invalid type. Use: parcels | jurisdiction' }, { status: 400 })
}

// ── Parcel lookup by XY ───────────────────────────────────────────────────────
// Uses ULDK GetParcelByXY — returns the cadastral parcel (działka) at the given point.
// // COUNTRY: Poland

async function handleParcels(params: URLSearchParams) {
  const lng = params.get('lng')
  const lat = params.get('lat')

  if (!lng || !lat) {
    return NextResponse.json({ error: 'lng and lat are required' }, { status: 400 })
  }

  const lngNum = parseFloat(lng)
  const latNum = parseFloat(lat)

  if (isNaN(lngNum) || isNaN(latNum)) {
    return NextResponse.json({ error: 'lng and lat must be numbers' }, { status: 400 })
  }

  // Convert EPSG:4326 → EPSG:2180 — ULDK requires input in Polish national grid
  // srid=4326 is kept as a separate param to request output geometry in EPSG:4326 (for Mapbox)
  // // COUNTRY: Poland
  const [x2180, y2180] = lngLatToEPSG2180(lngNum, latNum)
  console.log(`[gugik-wfs] parcels coord: lng=${lngNum} lat=${latNum} → easting=${x2180.toFixed(2)} northing=${y2180.toFixed(2)}`)

  const uldkParams = new URLSearchParams({
    request: 'GetParcelByXY',
    xy: `${x2180},${y2180}`,
    result: 'geom_wkt,parcel,region,commune,county,voivodeship',
    srid: '4326',
  })

  const targetUrl = `${ULDK_URL}?${uldkParams.toString()}`

  if (!isTrustedUrl(targetUrl)) {
    return NextResponse.json({ error: 'Target URL not allowed' }, { status: 403 })
  }

  console.log('[gugik-wfs] parcels ULDK request:', targetUrl)

  async function uldkFetch(url: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      return await fetch(url, { headers: { Accept: 'text/plain, */*' }, signal: controller.signal })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('[gugik-wfs] parcels timeout — retrying once')
        return await fetch(url, { headers: { Accept: 'text/plain, */*' }, signal: AbortSignal.timeout(20_000) })
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const res = await uldkFetch(targetUrl)

    console.log('[gugik-wfs] parcels response status:', res.status)

    const text = await res.text()
    console.log('[gugik-wfs] parcels ULDK raw response:', JSON.stringify(text))

    if (!res.ok) {
      console.error('[gugik-wfs] parcels error body:', text.substring(0, 300))
      return NextResponse.json({ type: 'FeatureCollection', features: [] })
    }

    // ULDK plain-text format:
    //   Line 0: status code — 0 = success, negative = error/not found
    //   Line 1: pipe-separated: SRID=4326;POLYGON(...)|parcelId|region|commune|county|voivodeship
    // // COUNTRY: Poland
    const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean)
    const status = parseInt(lines[0] ?? '-1', 10)

    console.log('[gugik-wfs] parcels ULDK count line:', lines[0])

    if (status < 0 || lines.length < 2) {
      // Negative status = error or no parcel at this point (water, forest outside cadastral system)
      return NextResponse.json({ type: 'FeatureCollection', features: [] })
    }

    const features: object[] = []
    // status === 0 means success — parse lines[1+]
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('|')
      if (parts.length < 6) continue
      const [geomPart, parcelId, region, commune, county, voivodeship] = parts
      const feature = wktToGeoJSONFeature(geomPart ?? '', {
        parcelId: parcelId ?? '',
        region:   region ?? '',
        municipality: commune ?? '',    // gmina
        district:     county ?? '',     // powiat
        province:     voivodeship ?? '', // województwo
      })
      if (feature) features.push(feature)
    }

    console.log('[gugik-wfs] parcels parsed features:', features.length)
    return NextResponse.json({ type: 'FeatureCollection', features })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[gugik-wfs] parcels fetch error:', message)
    return NextResponse.json({ error: `ULDK request failed: ${message}` }, { status: 502 })
  }
}

// ── Cadastral precinct (obręb) lookup by XY ───────────────────────────────────
// Uses ULDK GetRegionByXY — returns the cadastral precinct (obręb ewidencyjny) boundary.
// GetCommuneByXY (gmina) times out because gmina polygons are too large.
// Obręb is smaller than gmina but still useful for architects as a jurisdiction boundary.
// If GetRegionByXY also fails, returns an empty FeatureCollection with a warning log.
// // COUNTRY: Poland

async function handleJurisdiction(params: URLSearchParams) {
  const lng = params.get('lng')
  const lat = params.get('lat')

  if (!lng || !lat) {
    return NextResponse.json({ error: 'lng and lat are required' }, { status: 400 })
  }

  const lngNum = parseFloat(lng)
  const latNum = parseFloat(lat)

  if (isNaN(lngNum) || isNaN(latNum)) {
    return NextResponse.json({ error: 'lng and lat must be numbers' }, { status: 400 })
  }

  // Convert EPSG:4326 → EPSG:2180 — same requirement as parcels
  // // COUNTRY: Poland
  const [x2180, y2180] = lngLatToEPSG2180(lngNum, latNum)
  console.log(`[gugik-wfs] jurisdiction coord: lng=${lngNum} lat=${latNum} → easting=${x2180.toFixed(2)} northing=${y2180.toFixed(2)}`)

  // GetRegionByXY returns cadastral precinct (obręb) — smaller than gmina, reliable response time
  // // COUNTRY: Poland
  const uldkParams = new URLSearchParams({
    request: 'GetRegionByXY',
    xy: `${x2180},${y2180}`,
    result: 'geom_wkt,region,commune,county,voivodeship',
    srid: '4326',
  })

  const targetUrl = `${ULDK_URL}?${uldkParams.toString()}`

  if (!isTrustedUrl(targetUrl)) {
    return NextResponse.json({ error: 'Target URL not allowed' }, { status: 403 })
  }

  console.log('[gugik-wfs] jurisdiction ULDK request:', targetUrl)

  try {
    const res = await fetch(targetUrl, {
      headers: { Accept: 'text/plain, */*' },
      signal: AbortSignal.timeout(10_000),
    })

    console.log('[gugik-wfs] jurisdiction response status:', res.status)

    const text = await res.text()
    console.log('[gugik-wfs] jurisdiction ULDK raw response:', JSON.stringify(text.substring(0, 200)))

    if (!res.ok) {
      console.error('[gugik-wfs] jurisdiction error body:', text.substring(0, 300))
      return NextResponse.json({ type: 'FeatureCollection', features: [] })
    }

    // Same plain-text format as parcels: status line then pipe-separated data lines
    // // COUNTRY: Poland
    const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean)
    const status = parseInt(lines[0] ?? '-1', 10)

    console.log('[gugik-wfs] jurisdiction ULDK count line:', lines[0])

    if (status < 0 || lines.length < 2) {
      console.warn('[gugik-wfs] jurisdiction: GetRegionByXY returned no results for', lngNum, latNum)
      return NextResponse.json({ type: 'FeatureCollection', features: [] })
    }

    const features: object[] = []
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('|')
      if (parts.length < 5) continue
      const [geomPart, region, commune, county, voivodeship] = parts
      const feature = wktToGeoJSONFeature(geomPart ?? '', {
        region:       region ?? '',
        municipality: commune ?? '',
        district:     county ?? '',
        province:     voivodeship ?? '',
      })
      if (feature) features.push(feature)
    }

    console.log('[gugik-wfs] jurisdiction parsed features:', features.length)
    return NextResponse.json({ type: 'FeatureCollection', features })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[gugik-wfs] jurisdiction fetch error:', message)
    return NextResponse.json({ error: `ULDK request failed: ${message}` }, { status: 502 })
  }
}
