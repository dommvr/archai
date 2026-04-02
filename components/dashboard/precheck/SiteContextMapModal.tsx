'use client'

/**
 * SiteContextMapModal
 *
 * Full-screen map modal for selecting a parcel as site context.
 *
 * Features:
 *  - Mapbox GL JS map with light-v11 tiles (map tiles are light; UI shell is dark)
 *  - Mapbox Geocoder search bar, scoped to Poland, with proximity bias
 *  - Layer toggles: plot/parcel borders (GUGIK WFS), jurisdiction boundary (GUGIK WFS)
 *  - Click a parcel → highlight it, show its metadata
 *  - MPZP (zoning plan) document lookup via Geoportal WMS GetFeatureInfo
 *  - View / Download / Add-to-project actions for found documents
 *  - "Use this parcel" fills the parent SiteContextPicker form (does NOT auto-save)
 *
 * All Polish-specific API/layer logic is marked with // COUNTRY: Poland
 * so future localization can be added without hunting through the file.
 *
 * Depends on:
 *  - mapbox-gl  (dynamic import — never SSR'd)
 *  - @mapbox/mapbox-gl-geocoder  (dynamic import)
 *  - /api/site-context/gugik-wfs  (server proxy for GUGIK WFS CORS)
 *  - /api/site-context/fetch-document  (server proxy for PDF download/upload)
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  X,
  Layers,
  MapPin,
  CheckCircle2,
  Loader2,
  FileText,
  FileDown,
  Eye,
  Download,
  Paperclip,
  AlertTriangle,
  Info,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
// Mapbox CSS — must be imported at module level so Next.js bundles it before
// the map container mounts. CDN link tags in JSX are not reliable for this.
import 'mapbox-gl/dist/mapbox-gl.css'
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParcelSelection {
  address: string
  municipality: string
  district: string
  province: string
  jurisdictionCode: string
  parcelId: string
  /** Cadastral precinct (obręb) code from ULDK — used to construct parcel report URL */
  region: string
  parcelAreaM2: number | undefined
  centroid: { lat: number; lng: number }
  /** GeoJSON Polygon in EPSG:4326 */
  parcelBoundary: {
    type: 'Polygon'
    coordinates: number[][][]
  } | undefined
}

interface ZoningDocument {
  title: string
  url: string
  /** Which municipality the plan covers */
  area: string
}

interface SiteContextMapModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  /** Called when user clicks "Use this parcel" — does NOT save to DB */
  onConfirm: (selection: ParcelSelection) => void
  /** If set, map opens centred on this location */
  initialLng?: number
  initialLat?: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

// // COUNTRY: Poland — default map centre (Warsaw, Poland)
const DEFAULT_LNG = 21.0122
const DEFAULT_LAT = 52.2297
const DEFAULT_ZOOM = 11

// Mapbox style — dark tiles to match the ArchAI dark UI shell
const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11'

// // COUNTRY: Poland — geocoder country restriction
const GEOCODER_COUNTRY = 'pl'

// ── Inline status banner ───────────────────────────────────────────────────────

interface BannerProps {
  type: 'success' | 'error' | 'info'
  message: string
  onDismiss: () => void
}

function StatusBanner({ type, message, onDismiss }: BannerProps) {
  const colours = {
    success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    error:   'border-red-400/30 bg-red-400/10 text-red-300',
    info:    'border-archai-amber/30 bg-archai-amber/10 text-archai-amber',
  }
  return (
    <div className={cn(
      'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
      colours[type],
    )}>
      <span className="flex-1 leading-snug">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ── Zoning documents panel ────────────────────────────────────────────────────

interface ZoningDocPanelProps {
  projectId: string
  docs: ZoningDocument[]
  loading: boolean
  error: string | null
  /** null = not yet checked; false = checked, none found */
  checked: boolean | null
  /** true when the geoportal endpoint is unavailable — show info not error */
  unavailable?: boolean
}

function ZoningDocPanel({ projectId, docs, loading, error, checked, unavailable }: ZoningDocPanelProps) {
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)
  const [uploadedIdx,  setUploadedIdx]  = useState<Set<number>>(new Set())
  const [uploadError,  setUploadError]  = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  async function handleAddToProject(doc: ZoningDocument, idx: number) {
    if (uploadingIdx !== null) return
    setUploadingIdx(idx)
    setUploadError(null)
    try {
      const params = new URLSearchParams({
        url: doc.url,
        mode: 'upload',
        projectId,
        fileName: doc.title,
      })
      const res = await fetch(`/api/site-context/fetch-document?${params.toString()}`)
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? `Upload failed (${res.status})`)
      }
      setUploadedIdx((prev) => new Set([...prev, idx]))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingIdx(null)
    }
  }

  function handleView(doc: ZoningDocument) {
    const params = new URLSearchParams({ url: doc.url, mode: 'stream' })
    window.open(`/api/site-context/fetch-document?${params.toString()}`, '_blank')
  }

  function handleDownload(doc: ZoningDocument) {
    const params = new URLSearchParams({
      url: doc.url,
      mode: 'stream',
      fileName: doc.title,
    })
    const a = document.createElement('a')
    a.href = `/api/site-context/fetch-document?${params.toString()}`
    a.download = doc.title.endsWith('.pdf') ? doc.title : `${doc.title}.pdf`
    a.click()
  }

  return (
    <div className="rounded-lg border border-archai-graphite bg-archai-charcoal overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <FileText className="h-3.5 w-3.5 text-archai-orange shrink-0" />
        <p className="text-xs font-medium text-white flex-1">Zoning Documents (MPZP)</p>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {!loading && checked !== null && docs.length > 0 && (
          <span className="text-[10px] font-medium text-emerald-400 shrink-0">{docs.length} found</span>
        )}
        {!loading && checked === false && (
          <span className="text-[10px] text-muted-foreground shrink-0">None found</span>
        )}
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-archai-graphite px-3 pb-3 pt-2 space-y-2">
          {loading && (
            <div className="space-y-1.5">
              {[0, 1].map((i) => (
                <div key={i} className="h-10 rounded bg-archai-black/60 animate-pulse" />
              ))}
            </div>
          )}

          {unavailable && (
            // Known Polish geoportal limitation — not a user-actionable error
            // // COUNTRY: Poland
            <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
              <Info className="h-3 w-3 shrink-0 mt-0.5" />
              <span>Zoning document check is currently unavailable. <a href="https://mapy.geoportal.gov.pl" target="_blank" rel="noopener noreferrer" className="text-archai-orange hover:underline">Check manually at geoportal.gov.pl</a></span>
            </div>
          )}

          {error && !unavailable && (
            <div className="flex items-start gap-1.5 text-[10px] text-archai-amber/80">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!loading && checked === false && !error && (
            <div className="py-1 space-y-1">
              <p className="text-[11px] text-muted-foreground">
                No zoning plan (MPZP) found for this parcel.
              </p>
              {/* // COUNTRY: Poland */}
              <a
                href="https://mapy.geoportal.gov.pl"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-archai-orange hover:underline"
              >
                Check manually on geoportal.gov.pl
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          )}

          {!loading && docs.length > 0 && (
            <div className="space-y-1.5">
              {docs.map((doc, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-archai-graphite/60 bg-archai-black/40 px-3 py-2 space-y-1.5"
                >
                  <p className="text-[11px] font-medium text-white leading-snug">{doc.title}</p>
                  {doc.area && (
                    <p className="text-[10px] text-muted-foreground">{doc.area}</p>
                  )}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleView(doc)}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-white transition-colors border border-archai-graphite/60 rounded px-1.5 py-0.5"
                    >
                      <Eye className="h-3 w-3" />
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownload(doc)}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-white transition-colors border border-archai-graphite/60 rounded px-1.5 py-0.5"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </button>
                    {uploadedIdx.has(idx) ? (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Added
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={uploadingIdx !== null}
                        onClick={() => void handleAddToProject(doc, idx)}
                        className="flex items-center gap-1 text-[10px] text-archai-orange hover:text-archai-amber transition-colors border border-archai-orange/30 rounded px-1.5 py-0.5 disabled:opacity-50"
                      >
                        {uploadingIdx === idx
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Paperclip className="h-3 w-3" />}
                        Add to project
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {uploadError && (
            <p className="text-[10px] text-red-400 leading-snug">{uploadError}</p>
          )}

          {checked === null && !loading && (
            <p className="text-[10px] text-muted-foreground">
              Select a parcel to check for zoning documents.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function SiteContextMapModal({
  open,
  onClose,
  projectId,
  onConfirm,
  initialLng,
  initialLat,
}: SiteContextMapModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geocoderRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parcelSourceRef = useRef<any>(null)

  const [mapReady,         setMapReady]         = useState(false)
  const [tokenMissing,     setTokenMissing]     = useState(false)
  const [showParcels,      setShowParcels]      = useState(true)
  const [showJurisdiction, setShowJurisdiction] = useState(true)
  const [loadingParcels,   setLoadingParcels]   = useState(false)
  const [loadingJuris,     setLoadingJuris]     = useState(false)

  const [selectedParcel, setSelectedParcel] = useState<ParcelSelection | null>(null)
  const [banner,         setBanner]         = useState<{ type: BannerProps['type']; message: string } | null>(null)

  // Zoning documents state
  const [zoningDocs,        setZoningDocs]        = useState<ZoningDocument[]>([])
  const [zoningLoading,     setZoningLoading]     = useState(false)
  const [zoningError,       setZoningError]       = useState<string | null>(null)
  const [zoningUnavailable, setZoningUnavailable] = useState(false)
  // null = not checked yet; false = checked, none found; true = found
  const [zoningChecked,     setZoningChecked]     = useState<boolean | null>(null)

  // Parcel report state
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError,   setReportError]   = useState<string | null>(null)

  // ── Parcel fetch (via server proxy) ───────────────────────────────────────
  // // COUNTRY: Poland

  const fetchParcelsAt = useCallback(async (lng: number, lat: number) => {
    if (!mapRef.current) return
    setLoadingParcels(true)
    setBanner(null)

    try {
      const res = await fetch(
        `/api/site-context/gugik-wfs?type=parcels&lng=${lng}&lat=${lat}`
      )
      const geojson = await res.json() as {
        features?: Array<{
          geometry: { type: string; coordinates: number[][][] }
          properties: Record<string, unknown>
        }>
      }

      if (!res.ok || !geojson.features) {
        setBanner({ type: 'info', message: 'No parcel data found for this location.' })
        setLoadingParcels(false)
        return
      }

      const map = mapRef.current

      // Update or create the parcels GeoJSON source
      if (map.getSource('gugik-parcels')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(map.getSource('gugik-parcels') as any).setData(geojson)
      } else {
        map.addSource('gugik-parcels', { type: 'geojson', data: geojson })
        // Fill layer
        map.addLayer({
          id: 'gugik-parcels-fill',
          type: 'fill',
          source: 'gugik-parcels',
          paint: {
            'fill-color': 'rgba(193, 93, 46, 0.07)',
            'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.25, 0.07],
          },
        })
        // Outline layer
        map.addLayer({
          id: 'gugik-parcels-outline',
          type: 'line',
          source: 'gugik-parcels',
          paint: {
            'line-color': '#E8A24F',  // archai-amber — brighter, visible on dark-v11 tiles
            'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 1],
            'line-opacity': 0.8,
          },
        })
      }

      // Visibility follows the toggle
      const vis = showParcels ? 'visible' : 'none'
      if (map.getLayer('gugik-parcels-fill'))   map.setLayoutProperty('gugik-parcels-fill',    'visibility', vis)
      if (map.getLayer('gugik-parcels-outline')) map.setLayoutProperty('gugik-parcels-outline', 'visibility', vis)

      // Merge ULDK metadata into the existing selectedParcel so the report button
      // appears once the API call completes, regardless of whether the user clicked
      // directly on the rendered parcel feature layer.
      const firstFeature = geojson.features[0]
      if (firstFeature?.properties) {
        const p = firstFeature.properties as Record<string, string>
        setSelectedParcel((prev) => prev ? {
          ...prev,
          parcelId:     p.parcelId     ?? prev.parcelId,
          region:       p.region       ?? prev.region,
          municipality: p.municipality ?? prev.municipality,
          district:     p.district     ?? prev.district,
          province:     p.province     ?? prev.province,
        } : prev)
      }

    } catch {
      setBanner({ type: 'error', message: 'Failed to load parcel boundaries from GUGIK.' })
    } finally {
      setLoadingParcels(false)
    }
  }, [showParcels])

  // ── Jurisdiction fetch ────────────────────────────────────────────────────
  // // COUNTRY: Poland

  const fetchJurisdictionAt = useCallback(async (lng: number, lat: number) => {
    if (!mapRef.current) return
    setLoadingJuris(true)

    try {
      const res = await fetch(
        `/api/site-context/gugik-wfs?type=jurisdiction&lng=${lng}&lat=${lat}`
      )
      const geojson = await res.json() as {
        features?: Array<{
          geometry: { type: string; coordinates: number[][][] }
          properties: Record<string, unknown>
        }>
      }

      if (!res.ok || !geojson.features?.length) {
        setLoadingJuris(false)
        return
      }

      const map = mapRef.current

      if (map.getSource('gugik-jurisdiction')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(map.getSource('gugik-jurisdiction') as any).setData(geojson)
      } else {
        map.addSource('gugik-jurisdiction', { type: 'geojson', data: geojson })
        map.addLayer({
          id: 'gugik-jurisdiction-fill',
          type: 'fill',
          source: 'gugik-jurisdiction',
          paint: {
            'fill-color': 'rgba(232, 162, 79, 0.04)',
          },
        })
        map.addLayer({
          id: 'gugik-jurisdiction-outline',
          type: 'line',
          source: 'gugik-jurisdiction',
          paint: {
            'line-color': '#E8A24F',  // archai-amber
            'line-width': 1.5,
            'line-dasharray': [4, 3],
            'line-opacity': 0.6,
          },
        })
      }

      const vis = showJurisdiction ? 'visible' : 'none'
      if (map.getLayer('gugik-jurisdiction-fill'))   map.setLayoutProperty('gugik-jurisdiction-fill',    'visibility', vis)
      if (map.getLayer('gugik-jurisdiction-outline')) map.setLayoutProperty('gugik-jurisdiction-outline', 'visibility', vis)

    } catch {
      // Jurisdiction is optional — fail silently
    } finally {
      setLoadingJuris(false)
    }
  }, [showJurisdiction])

  // ── MPZP document lookup ──────────────────────────────────────────────────
  // // COUNTRY: Poland

  const checkMpzpAt = useCallback(async (lng: number, lat: number) => {
    setZoningLoading(true)
    setZoningError(null)
    setZoningUnavailable(false)
    setZoningDocs([])
    setZoningChecked(null)

    try {
      // Call server-side proxy to avoid CORS — geoportal.gov.pl blocks browser-direct requests
      // // COUNTRY: Poland
      const mpzpRes = await fetch(
        `/api/site-context/mpzp-check?lat=${lat}&lng=${lng}`
      )

      let found = false
      const docs: ZoningDocument[] = []

      if (mpzpRes.ok) {
        const data = await mpzpRes.json() as {
          features?: Array<{
            properties?: {
              tytul?: string
              nazwa?: string
              url_do_dokumentu?: string
              adres_url?: string
              gmina?: string
            }
          }>
          found?: boolean
          reason?: string
          rawText?: string | null
        }

        // Endpoint unavailable (401/403 from geoportal) — known Polish geoportal limitation
        // // COUNTRY: Poland
        if (data.reason === 'unavailable') {
          setZoningUnavailable(true)
          setZoningChecked(null)
          return
        }

        if (data.features && data.features.length > 0) {
          found = true
          for (const f of data.features) {
            const p = f.properties ?? {}
            const url = p.url_do_dokumentu ?? p.adres_url
            if (url) {
              docs.push({
                title: p.tytul ?? p.nazwa ?? 'Miejscowy Plan Zagospodarowania Przestrzennego',
                url,
                area: p.gmina ?? '',
              })
            }
          }
        } else if (data.rawText) {
          // Server found plan indicators in non-JSON response
          found = true
          setZoningError('Zoning plan data found but could not be parsed. Check geoportal.gov.pl manually.')
        }
      }

      setZoningDocs(docs)
      setZoningChecked(found ? true : false)
    } catch {
      setZoningError('Could not check zoning documents. Verify manually at geoportal.gov.pl.')
      setZoningChecked(null)
    } finally {
      setZoningLoading(false)
    }
  }, [])

  // ── Parcel click handler ──────────────────────────────────────────────────

  const handleLocationSelected = useCallback(async (lng: number, lat: number, fromGeocoder = false) => {
    if (!mapRef.current) return
    const map = mapRef.current

    // Place or move the marker
    if (!markerRef.current) {
      // Lazy-import Mapbox to avoid SSR
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapboxgl = (await import('mapbox-gl')).default as any
      markerRef.current = new mapboxgl.Marker({ color: '#C15D2E' })
        .setLngLat([lng, lat])
        .addTo(map)
    } else {
      markerRef.current.setLngLat([lng, lat])
    }

    if (fromGeocoder) {
      map.flyTo({ center: [lng, lat], zoom: 16, duration: 1200 })
    }

    // Fetch parcel + jurisdiction data in parallel
    await Promise.all([
      fetchParcelsAt(lng, lat),
      fetchJurisdictionAt(lng, lat),
    ])

    // Check for zoning documents
    void checkMpzpAt(lng, lat)

    // Attempt reverse geocode for address using Mapbox Geocoding API
    // This gives us a human-readable address from coordinates
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    let address = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    let municipality = ''

    if (token) {
      try {
        const geocodeRes = await fetch(
          // // COUNTRY: Poland — language and country bias
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&language=pl&country=pl&types=address,place`
        )
        const geocodeData = await geocodeRes.json() as {
          features?: Array<{
            place_name?: string
            context?: Array<{ id: string; text: string }>
          }>
        }
        if (geocodeData.features?.[0]) {
          address = geocodeData.features[0].place_name ?? address
          // Extract municipality (place level)
          const ctx = geocodeData.features[0].context ?? []
          const placeCtx = ctx.find((c) => c.id.startsWith('place.'))
          if (placeCtx) municipality = placeCtx.text
        }
      } catch {
        // Reverse geocode failed — keep coordinate string
      }
    }

    // Merge address + coordinates into whatever fetchParcelsAt already populated.
    // Do NOT replace the full object — fetchParcelsAt runs concurrently and may
    // have already written parcelId/region/municipality; overwriting with a fresh
    // object would wipe those fields and hide the parcel report button.
    setSelectedParcel((prev) => ({
      address,
      // Prefer richer municipality from ULDK (set by fetchParcelsAt) if available
      municipality: prev?.municipality || municipality,
      district:      prev?.district     ?? '',
      province:      prev?.province     ?? '',
      jurisdictionCode: '',
      parcelId:      prev?.parcelId     ?? '',
      region:        prev?.region       ?? '',
      parcelAreaM2:  prev?.parcelAreaM2,
      centroid: { lat, lng },
      parcelBoundary: prev?.parcelBoundary,
    }))
  }, [fetchParcelsAt, fetchJurisdictionAt, checkMpzpAt])

  // When a GUGIK parcel feature is clicked, extract its metadata
  const handleParcelFeatureClick = useCallback((
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    feature: any,
    lng: number,
    lat: number,
    currentAddress: string,
    currentMunicipality: string,
  ) => {
    const props = feature.properties ?? {}
    // ULDK response property names — // COUNTRY: Poland
    const parcelId    = String(props.parcelId ?? '')
    const parcelArea  = undefined  // ULDK does not return area; may be derived from geometry later
    const obreb        = String(props.region ?? '')
    const gmina        = String(props.municipality ?? currentMunicipality ?? '')
    const powiat       = String(props.district ?? '')
    const wojewodztwo  = String(props.province ?? '')

    // Extract GeoJSON polygon from the clicked feature
    let parcelBoundary: ParcelSelection['parcelBoundary'] = undefined
    if (feature.geometry?.type === 'Polygon') {
      parcelBoundary = {
        type: 'Polygon',
        coordinates: feature.geometry.coordinates as number[][][],
      }
    }

    setSelectedParcel({
      address: currentAddress,
      municipality: gmina || obreb || currentMunicipality,
      district: powiat,
      province: wojewodztwo,
      jurisdictionCode: '',
      parcelId,
      region: obreb,
      parcelAreaM2: parcelArea,
      centroid: { lat, lng },
      parcelBoundary,
    })
  }, [])

  // ── Parcel report download ────────────────────────────────────────────────
  // // COUNTRY: Poland — GUGIK parcel report PDF via ULDK pdfReport endpoint

  const handleDownloadReport = useCallback(async () => {
    if (!selectedParcel?.parcelId || !selectedParcel.region) return
    setReportLoading(true)
    setReportError(null)
    try {
      const params = new URLSearchParams({
        parcelId: selectedParcel.parcelId,
        region:   selectedParcel.region,
      })
      const res = await fetch(`/api/site-context/parcel-report?${params.toString()}`)
      if (!res.ok) {
        setReportError('Report unavailable — view on geoportal.gov.pl')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      // Revoke after a short delay to allow the tab to load the blob
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      setReportError('Report unavailable — view on geoportal.gov.pl')
    } finally {
      setReportLoading(false)
    }
  }, [selectedParcel])

  // ── Map initialisation ────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    if (mapRef.current) return

    let destroyed = false

    async function initMap() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapboxgl = (await import('mapbox-gl')).default as any
      const MapboxGeocoder = (await import('@mapbox/mapbox-gl-geocoder')).default

      if (destroyed || !mapContainerRef.current) return

      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
      if (!token) {
        console.error(
          '[SiteContextMapModal] NEXT_PUBLIC_MAPBOX_TOKEN is missing or empty. ' +
          'Add it to .env.local to enable the map. ' +
          'Get a token at https://account.mapbox.com/'
        )
        setTokenMissing(true)
        return
      }
      mapboxgl.accessToken = token

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAP_STYLE,
        center: [initialLng ?? DEFAULT_LNG, initialLat ?? DEFAULT_LAT],
        zoom: initialLng ? 16 : DEFAULT_ZOOM,
        attributionControl: false,
      })

      map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right')

      // ── Geocoder ──────────────────────────────────────────────────────────
      // // COUNTRY: Poland — scoped to pl, with proximity to Warsaw as initial bias
      const geocoder = new MapboxGeocoder({
        accessToken: token,
        mapboxgl,
        marker: false,          // we handle marker placement ourselves
        placeholder: 'Search address or street…',
        countries: GEOCODER_COUNTRY,
        language: 'pl',
        proximity: { longitude: DEFAULT_LNG, latitude: DEFAULT_LAT },
        types: 'address,place,neighborhood,postcode',
      })

      map.addControl(geocoder, 'top-left')
      geocoderRef.current = geocoder

      geocoder.on('result', (e: { result: { center: [number, number] } }) => {
        const [lng, lat] = e.result.center
        void handleLocationSelected(lng, lat, true)
      })

      // ── Map click → parcel selection ──────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on('click', (e: any) => {
        const { lng, lat } = e.lngLat
        void handleLocationSelected(lng, lat, false)
      })

      // ── Parcel feature click for richer metadata ──────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on('click', 'gugik-parcels-fill', (e: any) => {
        if (!e.features?.length) return
        const feature = e.features[0]
        const coords = e.lngLat
        void (async () => {
          // Get current selected parcel address/municipality for fallback
          setSelectedParcel((prev) => {
            handleParcelFeatureClick(
              feature,
              coords.lng,
              coords.lat,
              prev?.address ?? '',
              prev?.municipality ?? '',
            )
            return prev
          })
        })()
        e.preventDefault()
      })

      map.on('mouseenter', 'gugik-parcels-fill', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'gugik-parcels-fill', () => {
        map.getCanvas().style.cursor = ''
      })

      map.on('load', () => {
        if (!destroyed) {
          // Call resize() after the modal's open animation finishes.
          // The dialog animates in over ~200 ms; if the map initialises during
          // the animation the container has the wrong dimensions and renders
          // black/empty. A short timeout lets the CSS transition settle first.
          setTimeout(() => {
            if (!destroyed && mapRef.current) {
              mapRef.current.resize()
            }
          }, 250)

          setMapReady(true)
          // If we have an initial location, fetch parcels immediately
          if (initialLng && initialLat) {
            void handleLocationSelected(initialLng, initialLat, false)
          }
        }
      })

      mapRef.current = map
    }

    const timer = setTimeout(() => {
      if (!mapContainerRef.current) {
        console.error('[SiteContextMapModal] map container ref is null after dialog animation — cannot init map')
        return
      }
      void initMap()
    }, 300)

    return () => {
      clearTimeout(timer)
      destroyed = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        geocoderRef.current = null
        markerRef.current = null
        setMapReady(false)
        setSelectedParcel(null)
        setZoningDocs([])
        setZoningChecked(null)
        setZoningUnavailable(false)
        setReportError(null)
      }
    }
    // Intentionally only runs on open change + initial coords
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Layer visibility toggles ──────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const vis = showParcels ? 'visible' : 'none'
    if (map.getLayer('gugik-parcels-fill'))   map.setLayoutProperty('gugik-parcels-fill',    'visibility', vis)
    if (map.getLayer('gugik-parcels-outline')) map.setLayoutProperty('gugik-parcels-outline', 'visibility', vis)
  }, [showParcels, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const vis = showJurisdiction ? 'visible' : 'none'
    if (map.getLayer('gugik-jurisdiction-fill'))   map.setLayoutProperty('gugik-jurisdiction-fill',    'visibility', vis)
    if (map.getLayer('gugik-jurisdiction-outline')) map.setLayoutProperty('gugik-jurisdiction-outline', 'visibility', vis)
  }, [showJurisdiction, mapReady])

  // ── Confirm selection ─────────────────────────────────────────────────────

  function handleConfirm() {
    if (!selectedParcel) return
    onConfirm(selectedParcel)
    onClose()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-[92vw] w-[92vw] h-[88vh] p-0 overflow-hidden flex flex-col gap-0 border-archai-graphite bg-archai-charcoal">
        {/* Header bar — title + loading indicator only; layer toggles live on the map */}
        <DialogHeader className="shrink-0 flex-row items-center gap-2 px-4 py-3 border-b border-archai-graphite">
          <MapPin className="h-4 w-4 text-archai-orange shrink-0" />
          <DialogTitle className="text-sm font-semibold text-white flex-1">
            Select Site Parcel
          </DialogTitle>
          {(loadingParcels || loadingJuris) && (
            <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
          )}
          {/* Radix DialogContent renders its own close button top-right — no extra X needed */}
        </DialogHeader>

        {/* Main content: map + right panel */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Map */}
          <div className="flex-1 min-h-0" style={{ position: 'relative' }}>
            {/* Map container — inline styles used so Mapbox's own CSS cannot override positioning */}
            <div
              ref={mapContainerRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />

            {/* Token-missing error — shown instead of (black) map */}
            {tokenMissing && (
              <div className="absolute inset-0 flex items-center justify-center bg-archai-black/90 z-10">
                <div className="flex flex-col items-center gap-3 text-center px-6 max-w-sm">
                  <AlertTriangle className="h-8 w-8 text-archai-amber" />
                  <p className="text-sm font-medium text-white">Mapbox token not configured</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Add <code className="text-archai-amber font-mono">NEXT_PUBLIC_MAPBOX_TOKEN</code> to{' '}
                    <code className="text-archai-amber font-mono">.env.local</code> and restart the
                    dev server. Get a free token at{' '}
                    <a
                      href="https://account.mapbox.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-archai-orange underline"
                    >
                      account.mapbox.com
                    </a>.
                  </p>
                </div>
              </div>
            )}

            {/* Floating layer-toggle panel — bottom-left of map, above navigation controls */}
            {mapReady && (
              <div className="absolute bottom-10 left-2.5 z-10 flex flex-col gap-1 pointer-events-auto">
                <div className="glass-panel rounded-lg px-2 py-1.5 flex flex-col gap-1 shadow-lg">
                  <div className="flex items-center gap-1 mb-0.5">
                    <Layers className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Layers</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowParcels((v) => !v)}
                    className={cn(
                      'flex items-center gap-1.5 text-[10px] rounded px-2 py-0.5 border transition-colors text-left',
                      showParcels
                        ? 'border-archai-orange/40 bg-archai-orange/10 text-archai-orange'
                        : 'border-archai-graphite/60 text-muted-foreground hover:text-white',
                    )}
                    aria-pressed={showParcels}
                  >
                    <span className={cn('h-2 w-2 rounded-sm shrink-0', showParcels ? 'bg-archai-orange' : 'bg-archai-graphite')} />
                    Parcels
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowJurisdiction((v) => !v)}
                    className={cn(
                      'flex items-center gap-1.5 text-[10px] rounded px-2 py-0.5 border transition-colors text-left',
                      showJurisdiction
                        ? 'border-archai-amber/40 bg-archai-amber/10 text-archai-amber'
                        : 'border-archai-graphite/60 text-muted-foreground hover:text-white',
                    )}
                    aria-pressed={showJurisdiction}
                  >
                    <span className={cn('h-2 w-2 rounded-sm shrink-0', showJurisdiction ? 'bg-archai-amber' : 'bg-archai-graphite')} />
                    Jurisdiction
                  </button>
                </div>
              </div>
            )}

            {/* Instruction overlay — shown until a location is selected */}
            {!selectedParcel && mapReady && (
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 pointer-events-none">
                <div className="glass-panel rounded-lg px-3 py-2 text-[11px] text-muted-foreground text-center shadow-lg">
                  Search or click the map to select a parcel
                </div>
              </div>
            )}
          </div>

          {/* Right panel — parcel info + zoning docs */}
          <div className="w-72 shrink-0 border-l border-archai-graphite bg-archai-black/60 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-3 space-y-3">

              {/* Banner */}
              {banner && (
                <StatusBanner
                  type={banner.type}
                  message={banner.message}
                  onDismiss={() => setBanner(null)}
                />
              )}

              {/* Parcel info card */}
              {selectedParcel ? (
                <div className="rounded-lg border border-archai-graphite bg-archai-charcoal p-3 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-archai-orange shrink-0" />
                    <p className="text-xs font-medium text-white">Selected Parcel</p>
                  </div>
                  <div className="space-y-1 text-[10px] text-muted-foreground">
                    {selectedParcel.address && (
                      <p className="text-white/80 leading-snug">{selectedParcel.address}</p>
                    )}
                    {selectedParcel.municipality && (
                      <p>Municipality: <span className="text-white/70">{selectedParcel.municipality}</span></p>
                    )}
                    {selectedParcel.district && (
                      <p>District (powiat): <span className="text-white/70">{selectedParcel.district}</span></p>
                    )}
                    {selectedParcel.province && (
                      <p>Province (woj.): <span className="text-white/70">{selectedParcel.province}</span></p>
                    )}
                    {selectedParcel.parcelId && (
                      <p>Parcel ID: <span className="font-mono text-white/70">{selectedParcel.parcelId}</span></p>
                    )}
                    {selectedParcel.parcelAreaM2 != null && (
                      <p>Area: <span className="text-white/70">{selectedParcel.parcelAreaM2.toLocaleString()} m²</span></p>
                    )}
                    <p className="font-mono text-[9px] text-muted-foreground/50">
                      {selectedParcel.centroid.lat.toFixed(6)}, {selectedParcel.centroid.lng.toFixed(6)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-archai-graphite p-4 text-center">
                  <MapPin className="h-5 w-5 text-muted-foreground/30 mx-auto mb-1.5" />
                  <p className="text-[11px] text-muted-foreground">
                    No parcel selected yet
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    Search above or click the map
                  </p>
                </div>
              )}

              {/* Parcel report — only shown when a parcel with ID+region is selected */}
              {/* // COUNTRY: Poland — GUGIK official parcel report PDF */}
              {selectedParcel?.parcelId && selectedParcel.region && (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => void handleDownloadReport()}
                    disabled={reportLoading}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors',
                      'border-archai-graphite bg-archai-charcoal text-muted-foreground',
                      'hover:border-archai-orange/40 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed',
                    )}
                  >
                    {reportLoading
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                      : <FileDown className="h-3.5 w-3.5 shrink-0" />
                    }
                    {reportLoading ? 'Fetching report…' : 'Download Parcel Report'}
                  </button>
                  {reportError && (
                    <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                      <Info className="h-3 w-3 shrink-0 mt-0.5" />
                      <span>
                        {reportError}{' '}
                        <a
                          href="https://mapy.geoportal.gov.pl"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-archai-orange hover:underline"
                        >
                          Open geoportal.gov.pl
                          <ExternalLink className="inline h-2.5 w-2.5 ml-0.5" />
                        </a>
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Zoning documents */}
              <ZoningDocPanel
                projectId={projectId}
                docs={zoningDocs}
                loading={zoningLoading}
                error={zoningError}
                checked={zoningChecked}
                unavailable={zoningUnavailable}
              />
            </div>

            {/* Footer — confirm button */}
            <div className="shrink-0 border-t border-archai-graphite p-3 space-y-2">
              {selectedParcel && (
                <p className="text-[10px] text-archai-amber/80 leading-snug">
                  This will pre-fill the site context form. Click Save after closing to persist.
                </p>
              )}
              <Button
                variant="archai"
                size="sm"
                className="w-full"
                disabled={!selectedParcel}
                onClick={handleConfirm}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Use this parcel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onClose}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
