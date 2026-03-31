'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { FloatingToolbar } from './FloatingToolbar'
import { ViewerAnnotationController } from './precheck/ViewerAnnotationController'
import { ViewerInspectorPanel } from './ViewerInspectorPanel'
import { ViewerLegend, type ViewerHighlightMode } from './ViewerLegend'
import { cn } from '@/lib/utils'
import type { ComplianceIssue, SpeckleModelRef } from '@/lib/precheck/types'
import type { ViewerSelectedObject } from '@/types'

/**
 * Resolves a Speckle commit/version ID to its referencedObject hash via
 * the Speckle GraphQL API. SpeckleLoader only accepts URLs in the form
 * /streams/{id}/objects/{objectId} — commit URLs are rejected internally,
 * which leaves loader.loader undefined and causes the getTotalObjectCount crash.
 */
async function resolveCommitToObjectId(
  serverUrl: string,
  streamId: string,
  versionId: string,
  token: string,
): Promise<string> {
  const res = await fetch(`${serverUrl}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query: `query GetCommitObject($streamId: String!, $commitId: String!) {
        stream(id: $streamId) {
          commit(id: $commitId) {
            referencedObject
          }
        }
      }`,
      variables: { streamId, commitId: versionId },
    }),
  })

  if (!res.ok) {
    throw new Error(`Speckle GraphQL API responded ${res.status} — check NEXT_PUBLIC_SPECKLE_SERVER_URL`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await res.json() as any
  const objectId = json?.data?.stream?.commit?.referencedObject as string | undefined

  if (!objectId) {
    const gqlError = json?.errors?.[0]?.message as string | undefined
    throw new Error(
      gqlError
        ? `Speckle API error: ${gqlError}`
        : 'Could not resolve commit to object — verify stream ID and version ID',
    )
  }

  return objectId
}

interface SpeckleViewerProps {
  /** Compliance issue to highlight in the viewer (null = no highlight). */
  selectedIssue: ComplianceIssue | null
  /** When set, the Speckle viewer mounts and loads this model. */
  modelRef: SpeckleModelRef | null
  /**
   * Optional callback fired whenever the user clicks an object in the viewer.
   * Receives null when clicking empty space (deselect).
   */
  onObjectClick?: (obj: ViewerSelectedObject | null) => void
}

/**
 * SpeckleViewer — shared 3D viewer used across the dashboard.
 *
 * Mounts @speckle/viewer when a modelRef is available and
 * NEXT_PUBLIC_SPECKLE_SERVER_URL is configured. Falls back to a
 * blueprint-grid placeholder when either is absent.
 *
 * Viewer load URL (resolved at runtime):
 *   1. GET {NEXT_PUBLIC_SPECKLE_SERVER_URL}/graphql → resolve versionId → objectId
 *   2. Pass {serverUrl}/streams/{streamId}/objects/{objectId} to SpeckleLoader
 *
 * Required env vars (add to .env.local):
 *   NEXT_PUBLIC_SPECKLE_SERVER_URL=http://127.0.0.1
 *   NEXT_PUBLIC_SPECKLE_TOKEN=your_token   (omit for public streams)
 *
 * SPECKLE VIEWER WILL BE MOUNTED HERE
 */
export function SpeckleViewer({ selectedIssue, modelRef, onObjectClick }: SpeckleViewerProps) {
  const viewerContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerInstanceRef = useRef<any>(null)
  const [viewerState, setViewerState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [selectedObject, setSelectedObject] = useState<ViewerSelectedObject | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  // Stable callback ref so the ObjectClicked handler closure always has the latest version.
  const onObjectClickRef = useRef(onObjectClick)
  useEffect(() => { onObjectClickRef.current = onObjectClick }, [onObjectClick])

  // Measure-active ref: used inside the ObjectClicked closure (which is captured at mount time)
  // to skip normal selection while measurement is active.
  // Synced from FloatingToolbar via onMeasureChange callback.
  const measureActiveRef = useRef(false)

  const handleMeasureChange = useCallback((active: boolean) => {
    measureActiveRef.current = active
    // When exiting measure mode, clear any lingering selection state so the legend resets.
    if (!active) {
      setSelectedObject(null)
    }
  }, [])

  const handleToggleProperties = useCallback(() => {
    setInspectorOpen((prev) => {
      const next = !prev
      // When closing the inspector, clear the viewer selection highlight too
      if (!next) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (window as any).__speckleViewer
        void v?.resetSelection?.()
        setSelectedObject(null)
      }
      return next
    })
  }, [])

  const speckleServerUrl = process.env.NEXT_PUBLIC_SPECKLE_SERVER_URL
  const speckleToken     = process.env.NEXT_PUBLIC_SPECKLE_TOKEN ?? ''

  useEffect(() => {
    if (!modelRef || !speckleServerUrl || !viewerContainerRef.current) {
      // When modelRef is cleared (e.g. new run with no synced model yet), dispose
      // any stale viewer so the canvas and the empty-state message agree.
      if (viewerInstanceRef.current) {
        try { viewerInstanceRef.current.dispose?.() } catch { /* ignore */ }
        viewerInstanceRef.current = null
      }
      if (viewerContainerRef.current) {
        viewerContainerRef.current.innerHTML = ''
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__speckleViewer = null
      setViewerState('idle')
      setViewerError(null)
      setSelectedObject(null)
      setInspectorOpen(false)
      return
    }

    let cancelled = false

    async function mountViewer() {
      setViewerState('loading')
      setViewerError(null)

      try {
        // Dynamic import keeps the heavy renderer out of the SSR bundle.
        // LegacyViewer extends Viewer and bundles CameraController, SelectionExtension,
        // filtering, and highlight extensions — required for highlightObjects() API.
        const { LegacyViewer, DefaultViewerParams, SpeckleLoader, ViewerEvent } =
          await import('@speckle/viewer')

        if (cancelled || !viewerContainerRef.current) return

        // Dispose previous instance before creating a new one to free GPU memory.
        if (viewerInstanceRef.current) {
          try { viewerInstanceRef.current.dispose?.() } catch { /* ignore */ }
          viewerInstanceRef.current = null
          viewerContainerRef.current.innerHTML = ''
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(window as any).__speckleViewer = null
        }

        console.debug('[SpeckleViewer] Initialising viewer...')
        const viewer = new LegacyViewer(viewerContainerRef.current, {
          ...DefaultViewerParams,
          showStats: false,
          verbose: false,
          // Restrict keyboard events to the canvas element so that typing in the
          // Copilot composer (or any other text input) does not trigger viewer
          // keyboard controls (orbit, fly, etc.).
          // With this flag, camera keyboard shortcuts only fire when the viewer
          // canvas has pointer/focus — which is the correct interaction model.
          restrictInputToCanvas: true,
        })
        await viewer.init()
        if (cancelled) { viewer.dispose?.(); return }
        console.debug('[SpeckleViewer] Viewer initialised.')

        viewerInstanceRef.current = viewer
        // Expose for ViewerAnnotationController — issue highlight calls read this ref.
        // LegacyViewer registers CameraController internally; do NOT call createExtension again.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).__speckleViewer = viewer

        const base = speckleServerUrl!.replace(/\/$/, '')

        // SpeckleLoader requires an *object* URL in the form:
        //   {serverUrl}/streams/{streamId}/objects/{objectId}
        // A commit/version URL (.../commits/{versionId}) is rejected by the
        // loader's internal URL validation and silently leaves loader.loader
        // undefined, which causes "Cannot read properties of undefined
        // (reading 'getTotalObjectCount')" when load() is called.
        //
        // Resolution: query the Speckle GraphQL API to resolve the versionId
        // (commit ID) to its referencedObject hash, then build the object URL.
        console.debug('[SpeckleViewer] Resolving commit to objectId...', {
          streamId: modelRef!.streamId,
          versionId: modelRef!.versionId,
        })
        const objectId = await resolveCommitToObjectId(
          base,
          modelRef!.streamId,
          modelRef!.versionId,
          speckleToken,
        )
        if (cancelled) return
        console.debug('[SpeckleViewer] Resolved objectId:', objectId)

        const objectUrl = `${base}/streams/${modelRef!.streamId}/objects/${objectId}`
        console.debug('[SpeckleViewer] Loading object:', objectUrl)

        const loader = new SpeckleLoader(
          viewer.getWorldTree(),
          objectUrl,
          speckleToken || undefined,
        )

        // Guard: if SpeckleLoader failed to initialise its internal loader
        // (e.g. URL was still rejected for an unexpected reason) loader.finished
        // will be false but loader itself is defined. The real guard is that
        // objectUrl is now in the correct /objects/ format, so this should not
        // be reachable — but we log defensively just in case.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((loader as any).loader == null) {
          throw new Error(
            'SpeckleLoader failed to initialise — verify NEXT_PUBLIC_SPECKLE_SERVER_URL and model IDs',
          )
        }

        console.debug('[SpeckleViewer] Starting model load...')
        await viewer.loadObject(loader, /* zoomToObject */ true)
        console.debug('[SpeckleViewer] Model loaded successfully.')

        if (cancelled) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(window as any).__speckleViewer = null
          return
        }

        // Wire object click → selection highlight + inspector state.
        //
        // Measure mode guard: when measureActiveRef.current is true, MeasurementsExtension
        // owns pointer interactions. We must NOT call selectObjects in that case, otherwise
        // selection overwrites the measurement visual state and makes measurement non-functional.
        // We also do not open the inspector during measurement.
        //
        // SelectionEvent.hits[0].node.model carries { id: string; raw: { [k]: any } }.
        // Cast raw to Record<string, unknown> to keep strict mode clean without widening to any.
        viewer.on(ViewerEvent.ObjectClicked, (selectionEvent) => {
          // Do not intercept clicks while measurement mode is active —
          // MeasurementsExtension handles pointer events for point picking.
          if (measureActiveRef.current) return

          if (!selectionEvent || selectionEvent.hits.length === 0) {
            // Empty-space click → clear selection both visually and in state
            void viewer.resetSelection()
            setSelectedObject(null)
            onObjectClickRef.current?.(null)
            return
          }
          const firstHit = selectionEvent.hits[0]
          const id: string = firstHit.node.model.id
          // NodeData.raw is typed { [prop: string]: any } — narrow to Record<string, unknown>
          const raw = firstHit.node.model.raw as Record<string, unknown>
          const obj: ViewerSelectedObject = { id, raw }

          // Visually select the object via the filtering/selection layer.
          // selectObjects() highlights the chosen object using the viewer's
          // SelectionExtension material (blue outline by default in LegacyViewer).
          void viewer.selectObjects([id])

          setSelectedObject(obj)
          setInspectorOpen(true)
          onObjectClickRef.current?.(obj)
        })

        setViewerState('ready')
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        const friendly =
          msg.includes('Cannot find module')
            ? 'Run `npm install @speckle/viewer` to enable 3D rendering'
            : msg.includes('401') || msg.includes('Unauthorized')
              ? 'Authentication failed — check NEXT_PUBLIC_SPECKLE_TOKEN'
              : msg.includes('404') || msg.includes('Not Found')
                ? 'Model not found — check server URL and model IDs'
                : msg
        console.error('[SpeckleViewer] Viewer error:', err)
        setViewerError(friendly)
        setViewerState('error')
      }
    }

    void mountViewer()
    return () => { cancelled = true }
  // Re-mount whenever the user syncs a different model version.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelRef?.streamId, modelRef?.versionId, speckleServerUrl])

  // Relay container resize events to the Speckle viewer so the WebGL canvas
  // redraws at the correct pixel dimensions and camera aspect ratio after any
  // panel drag or layout change. Without this, viewer.init() bakes the canvas
  // size at mount time: the canvas CSS stretches to fill the new container but
  // the WebGL drawingBuffer stays at the old pixel size → stretched image.
  //
  // viewer.resize() reads container.offsetWidth/offsetHeight internally and
  // also calls extension.onResize() on CameraController, which recomputes
  // perspectiveCamera.aspect and calls updateProjectionMatrix().
  //
  // We use contentRect to guard against zero-size observations (e.g. when the
  // panel is collapsed or the viewer is not yet painted) which would corrupt
  // the renderer state.
  useEffect(() => {
    const container = viewerContainerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry || !viewerInstanceRef.current) return
      const { width, height } = entry.contentRect
      // Skip degenerate sizes — renderer.setSize(0, 0) corrupts state.
      if (width < 1 || height < 1) return
      try {
        viewerInstanceRef.current.resize()
      } catch { /* ignore — viewer may not be fully initialised yet */ }
    })
    observer.observe(container)
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    return () => {
      if (viewerInstanceRef.current) {
        try { viewerInstanceRef.current.dispose?.() } catch { /* ignore */ }
        viewerInstanceRef.current = null
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__speckleViewer = null
    }
  }, [])

  const isReady = viewerState === 'ready'

  // Legend shows 'selection' only while the inspector is open AND an object is selected.
  // This prevents the legend getting stuck in 'selection' state after the panel is closed.
  const highlightMode: ViewerHighlightMode =
    selectedIssue                           ? 'issue'
    : (inspectorOpen && selectedObject)     ? 'selection'
    : 'none'

  return (
    <div className="relative h-full w-full bg-archai-black overflow-hidden">
      {/* Blueprint grid — fades out once viewer renders */}
      <div
        className={cn(
          'absolute inset-0 bg-blueprint-grid opacity-30 pointer-events-none transition-opacity duration-500',
          isReady && 'opacity-0',
        )}
      />

      {/* Speckle viewer mount point — SPECKLE VIEWER WILL BE MOUNTED HERE */}
      <div
        ref={viewerContainerRef}
        id="speckle-viewer"
        className="absolute inset-0 z-0"
        aria-label="3D model viewer"
      />

      {/* Empty state: no model linked */}
      {!modelRef && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-muted-foreground/40 pointer-events-none select-none">
          <div className="w-16 h-16 rounded-2xl border border-archai-graphite/40 flex items-center justify-center">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <p className="text-sm">Sync a Speckle model to see 3D view</p>
        </div>
      )}

      {/* Config missing: model linked but server URL not set in env */}
      {modelRef && !speckleServerUrl && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none select-none px-8">
          <AlertTriangle className="h-6 w-6 text-archai-amber/60" />
          <p className="text-xs text-archai-amber/80 text-center">
            Set <code className="font-mono bg-archai-graphite px-1 rounded">NEXT_PUBLIC_SPECKLE_SERVER_URL</code> in{' '}
            <code className="font-mono bg-archai-graphite px-1 rounded">.env.local</code> to enable 3D rendering.
          </p>
          <p className="text-[10px] text-muted-foreground/50 text-center mt-1">
            Model is synced — metrics and compliance checks work without the viewer.
          </p>
        </div>
      )}

      {/* Loading */}
      {modelRef && speckleServerUrl && viewerState === 'loading' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-muted-foreground/60 pointer-events-none select-none">
          <Loader2 className="h-7 w-7 animate-spin text-archai-orange/60" />
          <p className="text-xs">Loading model…</p>
        </div>
      )}

      {/* Error */}
      {viewerState === 'error' && viewerError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none select-none px-10">
          <AlertTriangle className="h-6 w-6 text-red-400/70" />
          <p className="text-xs text-red-400/80 text-center">{viewerError}</p>
        </div>
      )}

      {/* Issue-to-object highlight bridge */}
      <ViewerAnnotationController selectedIssue={selectedIssue} />

      {/* Object properties inspector — slides in when an object is selected */}
      <ViewerInspectorPanel
        selectedObject={inspectorOpen ? selectedObject : null}
        modelRef={modelRef}
        onClose={() => {
          // Close panel and clear viewer selection highlight
          setInspectorOpen(false)
          setSelectedObject(null)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const v = (window as any).__speckleViewer
          void v?.resetSelection?.()
        }}
      />

      {/* Color legend for current highlight mode */}
      <ViewerLegend highlightMode={highlightMode} />

      {/* Viewer toolbar — real camera, section, measure, and visibility controls */}
      <FloatingToolbar
        onToggleProperties={handleToggleProperties}
        propertiesOpen={inspectorOpen}
        onMeasureChange={handleMeasureChange}
      />
    </div>
  )
}
