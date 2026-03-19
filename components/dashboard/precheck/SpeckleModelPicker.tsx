'use client'

import { useState, useEffect } from 'react'
import { Box, CheckCircle2, Loader2, AlertTriangle, XCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type {
  GeometrySnapshot,
  PrecheckRun,
  SpeckleModelRef,
  SyncSpeckleModelInput,
} from '@/lib/precheck/types'

interface SpeckleModelPickerProps {
  runId:             string
  onSync:            (input: SyncSpeckleModelInput) => Promise<void>
  modelRef?:         SpeckleModelRef | null
  geometrySnapshot?: GeometrySnapshot | null
  /** The current run — used to detect failed syncs and show the error. */
  run?:              PrecheckRun | null
  isLoading?:        boolean
}

export function SpeckleModelPicker({
  runId,
  onSync,
  modelRef,
  geometrySnapshot,
  run,
  isLoading,
}: SpeckleModelPickerProps) {
  const [streamId,       setStreamId]       = useState(modelRef?.streamId  ?? '')
  const [versionId,      setVersionId]      = useState(modelRef?.versionId ?? '')
  const [branchName,     setBranchName]     = useState(modelRef?.branchName ?? '')
  const [modelName,      setModelName]      = useState(modelRef?.modelName  ?? '')
  const [submitting,     setSubmitting]     = useState(false)
  const [reviewOpen,     setReviewOpen]     = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)

  // When modelRef changes (after a successful sync), repopulate the form so the
  // user can see what was synced and make incremental edits for a re-sync.
  useEffect(() => {
    if (modelRef && !submitting) {
      setStreamId(modelRef.streamId)
      setVersionId(modelRef.versionId)
      setBranchName(modelRef.branchName ?? '')
      setModelName(modelRef.modelName  ?? '')
    }
  }, [modelRef, submitting])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!streamId.trim() || !versionId.trim()) return
    setSubmitting(true)
    try {
      await onSync({
        runId,
        streamId:   streamId.trim(),
        versionId:  versionId.trim(),
        branchName: branchName.trim() || undefined,
        modelName:  modelName.trim()  || undefined,
      })
      // After sync completes the parent refreshes runDetails → modelRef updates →
      // the useEffect above repopulates these fields. No manual clear needed.
    } finally {
      setSubmitting(false)
    }
  }

  const isSyncing = Boolean(isLoading || submitting)
  const disabled  = isSyncing

  // A sync failure is when the run has a modelRef (ref was created before the
  // object fetch) but the background task then failed — status is 'failed' and
  // errorMessage is populated. This is distinct from "no metrics" which means
  // the object fetch succeeded but geometry was not extractable.
  const syncFailed = modelRef != null && run?.status === 'failed'

  return (
    <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Box className="h-4 w-4 text-archai-orange" />
        <p className="text-sm font-medium text-white">Speckle Model</p>
      </div>

      {/* Linked model confirmation — shown after sync attempt */}
      {modelRef && (() => {
        const metricCount = geometrySnapshot?.metrics?.length ?? null
        // metricCount === null  → no snapshot (either still syncing, or sync failed)
        // metricCount === 0     → snapshot exists but no geometry extracted
        // metricCount > 0       → real metrics extracted
        const hasSnapshot = geometrySnapshot != null
        const hasMetrics  = metricCount !== null && metricCount > 0
        const noMetrics   = metricCount === 0

        // Unit normalization — full report stored in rawMetrics by the pipeline
        const unitNorm = geometrySnapshot?.rawMetrics?.unit_normalization as
          | {
              length_conversion_applied?: boolean
              heuristic_applied?: boolean
              resolved_length_units?: string
              declared_length_units?: string | null
              height_before_conversion?: number | null
              height_after_conversion?: number | null
              gfa_before_conversion?: number | null
              gfa_after_conversion?: number | null
              plausibility_warnings?: string[]
              heuristic_detail?: string
              storey_heuristic_ran?: boolean
              storey_heuristic_valid_count?: number
              storey_heuristic_skip_reason?: string
            }
          | null | undefined
        const unitConverted = Boolean(unitNorm?.length_conversion_applied)
        const unitHeuristic = Boolean(unitNorm?.heuristic_applied)
        const resolvedUnit  = unitNorm?.resolved_length_units ?? null
        const unitWarnings  = unitNorm?.plausibility_warnings ?? []

        // Per-metric lookup helpers
        const heightMetric = geometrySnapshot?.metrics?.find((m) => m.key === 'building_height_m') ?? null
        const gfaMetric    = geometrySnapshot?.metrics?.find((m) => m.key === 'gross_floor_area_m2') ?? null
        const farMetric    = geometrySnapshot?.metrics?.find((m) => m.key === 'far') ?? null

        // Height derivation diagnostics — structured data from the Python pipeline
        // stored in rawMetrics.metric_derivation.height by _derive_metrics_from_candidates.
        const heightDiag = (
          (geometrySnapshot?.rawMetrics?.metric_derivation as Record<string, unknown> | undefined)
            ?.height as
          | {
              chosen_source_tier?: string
              chosen_source_kind?: string
              chosen_source?: string
              whole_building_source?: boolean
              by_kind?: Record<string, number>
              rejected_kinds?: string[]
              storey_elevations_found?: boolean
              storey_count?: number
              storey_span_m?: number
              avg_floor_to_floor_m?: number
              warning?: string
              chosen_source_obj_id?: string
            }
          | null | undefined
        ) ?? null

        // Extraction notes (string array in rawMetrics)
        const extractionNotes = (geometrySnapshot?.rawMetrics?.extraction_notes as string[] | undefined) ?? []

        // ── Compact status label ─────────────────────────────
        const statusLabel =
          isSyncing   ? 'syncing…' :
          syncFailed  ? 'sync failed' :
          hasMetrics  ? `synced · ${metricCount} metric${metricCount === 1 ? '' : 's'}` :
          noMetrics   ? 'synced, no geometry metrics' :
          hasSnapshot ? 'synced' :
          'model linked'

        // ── Compact inline note (max one, the most important) ─
        // Priority: error > no-metrics warning > heuristic notice > warnings notice
        const compactNote: { text: string; tone: 'error' | 'warn' | 'info' } | null = (() => {
          if (syncFailed)         return null // error shown separately
          if (noMetrics && !syncFailed)
            return { text: 'No geometry extracted — check token/model', tone: 'warn' }
          if (!hasMetrics)        return null
          if (unitWarnings.length > 0)
            return { text: `${unitWarnings.length} unit warning${unitWarnings.length > 1 ? 's' : ''}`, tone: 'warn' }
          if (unitHeuristic)
            return { text: 'Unit heuristic applied — verify model units', tone: 'warn' }
          if (unitConverted && resolvedUnit && resolvedUnit !== 'm')
            return { text: `Units normalised: ${resolvedUnit} → m`, tone: 'info' }
          return null
        })()

        // Whether there is anything meaningful to show in the review panel
        const hasReviewContent = hasMetrics && (heightMetric != null || gfaMetric != null || farMetric != null || unitConverted || unitWarnings.length > 0 || extractionNotes.length > 0)

        return (
          <>
            {/* ── Compact status card ──────────────────────── */}
            <div className={cn(
              'rounded-lg border px-3 py-2 space-y-1',
              syncFailed
                ? 'border-red-400/20 bg-red-400/5'
                : hasMetrics
                  ? 'border-emerald-400/20 bg-emerald-400/5'
                  : 'border-archai-amber/20 bg-archai-amber/5',
            )}>
              <div className="flex items-start gap-2">
                {isSyncing ? (
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-archai-amber" />
                ) : syncFailed ? (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                ) : hasMetrics ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-archai-amber" />
                )}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className={cn(
                    'text-xs font-medium truncate',
                    syncFailed ? 'text-red-400' : hasMetrics ? 'text-emerald-400' : 'text-archai-amber',
                  )}>
                    {modelRef.modelName ?? 'Model'} · {statusLabel}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground truncate">
                    {modelRef.streamId} / {modelRef.versionId}
                  </p>
                  {modelRef.branchName && (
                    <p className="text-[10px] text-muted-foreground truncate">branch: {modelRef.branchName}</p>
                  )}
                  {/* Sync failure error */}
                  {syncFailed && run?.errorMessage && (
                    <p className="text-[10px] text-red-400/80 mt-0.5 break-words">{run.errorMessage}</p>
                  )}
                  {syncFailed && !run?.errorMessage && (
                    <p className="text-[10px] text-red-400/70 mt-0.5">
                      Geometry extraction failed. Re-sync or check backend logs.
                    </p>
                  )}
                  {/* Single compact note — long details moved to review panel */}
                  {compactNote && (
                    <p className={cn(
                      'text-[10px] mt-0.5',
                      compactNote.tone === 'error' ? 'text-red-400/80' :
                      compactNote.tone === 'warn'  ? 'text-archai-amber/80' :
                                                     'text-sky-400/70',
                    )}>
                      {compactNote.text}
                    </p>
                  )}
                </div>
              </div>

              {/* Review metrics action — only shown when there is something to review */}
              {hasReviewContent && (
                <button
                  type="button"
                  onClick={() => setReviewOpen((v) => !v)}
                  className="flex w-full items-center justify-between pt-1 text-[10px] font-medium text-muted-foreground hover:text-white transition-colors"
                >
                  <span>Review metrics</span>
                  {reviewOpen
                    ? <ChevronUp className="h-3 w-3" />
                    : <ChevronDown className="h-3 w-3" />
                  }
                </button>
              )}
            </div>

            {/* ── Inline review panel ──────────────────────── */}
            {reviewOpen && hasReviewContent && (
              <div className="rounded-lg border border-archai-graphite bg-archai-black/60 p-3 space-y-3 text-[10px]">

                {/* A. Building height */}
                {heightMetric && (() => {
                  const tier      = heightDiag?.chosen_source_tier ?? null
                  const sourceField = heightDiag?.chosen_source ?? null
                  const isWholeBuilding = heightDiag?.whole_building_source ?? null
                  const isWeakFallback  = tier === 'weak_fallback_element_dimension'
                  const byKind    = heightDiag?.by_kind ?? {}

                  // Confidence label derived from the tier
                  const tierLabel = ((): { label: string; tone: 'good' | 'ok' | 'warn' | 'bad' } => {
                    switch (tier) {
                      case 'roof_peak':                          return { label: 'roof peak',              tone: 'good' }
                      case 'absolute_elevation':                 return { label: 'absolute elevation',      tone: 'good' }
                      case 'bbox_building_extent':               return { label: 'global bbox',             tone: 'ok'   }
                      case 'storey_elevation_estimated':         return { label: 'storey elevations',       tone: 'ok'   }
                      case 'storey_elevation_inferred_estimated':return { label: 'inferred storeys',        tone: 'warn' }
                      case 'weak_fallback_element_dimension':    return { label: 'element dimension',       tone: 'bad'  }
                      default:                                   return { label: tier ?? 'unknown',         tone: 'ok'   }
                    }
                  })()

                  // Sources found summary (which kinds had candidates)
                  const foundKinds  = Object.entries(byKind).filter(([, n]) => n > 0).map(([k]) => k)
                  const chosenKind  = heightDiag?.chosen_source_kind ?? null

                  return (
                    <div className="space-y-1">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Building Height</p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-white">
                          {heightMetric.value.toFixed(2)}
                        </span>
                        <span className="text-muted-foreground">{heightMetric.units ?? 'm'}</span>
                        {unitHeuristic && <span className="text-archai-amber/70">· unit heuristic</span>}
                        {unitConverted && !unitHeuristic && <span className="text-sky-400/70">· converted</span>}
                      </div>

                      {/* Structured source summary */}
                      <div className="space-y-0.5">
                        {/* Source tier */}
                        <p className="text-muted-foreground">
                          Source:{' '}
                          <span className={cn(
                            tierLabel.tone === 'good' ? 'text-emerald-400/80' :
                            tierLabel.tone === 'ok'   ? 'text-sky-400/70' :
                            tierLabel.tone === 'warn' ? 'text-archai-amber/70' :
                                                        'text-red-400/70',
                          )}>
                            {tierLabel.label}
                          </span>
                          {sourceField && <span className="text-muted-foreground/50"> ({sourceField})</span>}
                        </p>

                        {/* Whole-building vs weak fallback */}
                        {isWholeBuilding === false && (
                          <p className="text-red-400/70">
                            Not a whole-building measurement — single element dimension only.
                          </p>
                        )}
                        {isWeakFallback && heightDiag?.warning && (
                          <p className="text-red-400/60 break-words">{heightDiag.warning}</p>
                        )}

                        {/* Unit conversion note */}
                        {unitHeuristic && unitNorm?.height_before_conversion != null && unitNorm.height_after_conversion != null && (
                          <p className="text-archai-amber/70">
                            Unit conversion: {unitNorm.height_before_conversion.toFixed(2)} → {unitNorm.height_after_conversion.toFixed(2)} m
                            {' '}({unitNorm.resolved_length_units} → m)
                          </p>
                        )}
                        {unitNorm?.declared_length_units && !unitHeuristic && (
                          <p className="text-muted-foreground/60">
                            Declared units: {unitNorm.declared_length_units}
                            {unitNorm.resolved_length_units !== unitNorm.declared_length_units
                              ? ` → ${unitNorm.resolved_length_units}` : ''}
                          </p>
                        )}

                        {/* Storey detail */}
                        {(tier === 'storey_elevation_estimated' || tier === 'storey_elevation_inferred_estimated') &&
                          heightDiag?.storey_count != null && (
                          <p className="text-muted-foreground/60">
                            {heightDiag.storey_count} storey{heightDiag.storey_count !== 1 ? 's' : ''} found
                            {heightDiag.storey_span_m != null ? `, span ${heightDiag.storey_span_m.toFixed(2)} m` : ''}
                            {heightDiag.avg_floor_to_floor_m != null ? ` + ${heightDiag.avg_floor_to_floor_m.toFixed(2)} m/floor` : ''}
                            {' '}→ estimated top
                          </p>
                        )}

                        {/* Which sources were found vs. not */}
                        {foundKinds.length > 0 && (
                          <p className="text-muted-foreground/50">
                            Candidates found: {foundKinds.join(', ')}
                            {chosenKind && foundKinds.length > 1
                              ? ` · chose ${chosenKind}`
                              : ''}
                          </p>
                        )}
                      </div>

                      {/* Source object IDs — same highlight seam as GFA */}
                      {heightMetric.sourceObjectIds.length > 0 ? (
                        <div className="space-y-1 pt-0.5">
                          <p className="text-muted-foreground">
                            {heightMetric.sourceObjectIds.length} source object{heightMetric.sourceObjectIds.length !== 1 ? 's' : ''}
                            {' '}
                            <span className="text-muted-foreground/50">(height source elements)</span>
                          </p>
                          <div className="space-y-0.5 max-h-[72px] overflow-y-auto">
                            {heightMetric.sourceObjectIds.map((id) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => {
                                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                  const v = (window as any).__speckleViewer
                                  void v?.highlightObjects?.([id])
                                }}
                                className="block w-full text-left font-mono text-[10px] text-muted-foreground/60 hover:text-sky-400 hover:bg-archai-graphite/40 rounded px-1 py-0.5 transition-colors truncate"
                              >
                                {id}
                              </button>
                            ))}
                          </div>
                          <p className="text-muted-foreground/40">Click an object ID to highlight it in the viewer.</p>
                        </div>
                      ) : (
                        <p className="text-muted-foreground/40">
                          {tier === 'bbox_building_extent'
                            ? 'Height derived from global bbox — no individual object IDs available.'
                            : tier === 'storey_elevation_estimated' || tier === 'storey_elevation_inferred_estimated'
                              ? 'Height estimated from storey elevations — no individual object IDs available.'
                              : 'No source object IDs recorded for this metric.'}
                        </p>
                      )}
                    </div>
                  )
                })()}

                {/* B. Gross floor area */}
                {gfaMetric && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Gross Floor Area</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-white">
                        {gfaMetric.value.toFixed(1)}
                      </span>
                      <span className="text-muted-foreground">{gfaMetric.units ?? 'm²'}</span>
                    </div>
                    {unitHeuristic && unitNorm?.gfa_before_conversion != null && unitNorm.gfa_after_conversion != null && (
                      <p className="text-archai-amber/70">
                        Before conversion: {unitNorm.gfa_before_conversion.toFixed(1)} → after: {unitNorm.gfa_after_conversion.toFixed(1)} m²
                      </p>
                    )}
                    {/* Source object IDs — included slab/floor objects */}
                    {gfaMetric.sourceObjectIds.length > 0 ? (
                      <div className="space-y-1">
                        <p className="text-muted-foreground">
                          {gfaMetric.sourceObjectIds.length} source object{gfaMetric.sourceObjectIds.length !== 1 ? 's' : ''} included
                          {' '}
                          <span className="text-muted-foreground/50">(floor/slab elements)</span>
                        </p>
                        {/* Selectable rows — clicking highlights in viewer */}
                        <div className="space-y-0.5 max-h-[96px] overflow-y-auto">
                          {gfaMetric.sourceObjectIds.map((id) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => {
                                // Highlight this slab in the Speckle viewer.
                                // Uses the same window.__speckleViewer global as ViewerAnnotationController.
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                const v = (window as any).__speckleViewer
                                void v?.highlightObjects?.([id])
                              }}
                              className="block w-full text-left font-mono text-[10px] text-muted-foreground/60 hover:text-sky-400 hover:bg-archai-graphite/40 rounded px-1 py-0.5 transition-colors truncate"
                            >
                              {id}
                            </button>
                          ))}
                        </div>
                        <p className="text-muted-foreground/40 leading-relaxed">
                          Floor-level labels not yet available. Click an object ID to highlight it in the viewer.
                        </p>
                      </div>
                    ) : (
                      <p className="text-muted-foreground/50">No source object IDs recorded for this metric.</p>
                    )}
                    {gfaMetric.computationNotes && (
                      <p className="text-muted-foreground/60 break-words">{gfaMetric.computationNotes}</p>
                    )}
                  </div>
                )}

                {/* C. FAR — display only, no verification workflow */}
                {farMetric && (
                  <div className="space-y-1 border-t border-archai-graphite pt-2">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Floor Area Ratio</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-white">
                        {farMetric.value.toFixed(2)}
                      </span>
                      <span className="text-muted-foreground">FAR</span>
                    </div>
                    {farMetric.computationNotes && (
                      <p className="text-muted-foreground/60">{farMetric.computationNotes}</p>
                    )}
                  </div>
                )}

                {/* D. Diagnostics — collapsed by default */}
                {(unitWarnings.length > 0 || extractionNotes.length > 0) && (
                  <div className="space-y-1 border-t border-archai-graphite pt-2">
                    <button
                      type="button"
                      onClick={() => setDiagnosticsOpen((v) => !v)}
                      className="flex w-full items-center justify-between text-[10px] font-medium text-muted-foreground hover:text-white transition-colors"
                    >
                      <span>Diagnostics</span>
                      {diagnosticsOpen
                        ? <ChevronUp className="h-3 w-3" />
                        : <ChevronDown className="h-3 w-3" />
                      }
                    </button>
                    {diagnosticsOpen && (
                      <div className="space-y-1.5 pt-1">
                        {unitWarnings.map((w, i) => (
                          <p key={i} className="text-archai-amber/70 leading-relaxed break-words">{w}</p>
                        ))}
                        {extractionNotes.map((n, i) => (
                          <p key={`note-${i}`} className="text-muted-foreground/60 leading-relaxed break-words">{n}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )
      })()}

      {/* Sync form — always visible so the user can re-sync a different version */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          {/* UI label uses "Speckle Project ID", backend payload remains legacy "streamId" */}
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Speckle Project ID <span className="text-archai-orange">*</span>
          </label>
          <Input
            placeholder="abc123def456…"
            value={streamId}
            onChange={(e) => setStreamId(e.target.value)}
            className="bg-archai-black border-archai-graphite text-sm h-8 font-mono"
            required
            disabled={disabled}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Version ID <span className="text-archai-orange">*</span>
          </label>
          <Input
            placeholder="commit hash…"
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
            className="bg-archai-black border-archai-graphite text-sm h-8 font-mono"
            required
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Branch</label>
            <Input
              placeholder="main"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              className="bg-archai-black border-archai-graphite text-sm h-8"
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Model Name</label>
            <Input
              placeholder="Tower Option A"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="bg-archai-black border-archai-graphite text-sm h-8"
              disabled={disabled}
            />
          </div>
        </div>

        <Button
          type="submit"
          variant="archai"
          size="sm"
          className={cn('w-full', modelRef && 'variant-outline')}
          disabled={!streamId.trim() || !versionId.trim() || disabled}
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
          {isSyncing
            ? 'Syncing Model…'
            : syncFailed
              ? 'Retry Sync'
              : modelRef
                ? 'Re-sync Model'
                : 'Sync Speckle Model'}
        </Button>
      </form>

      {/* SPECKLE VIEWER WILL BE MOUNTED HERE */}
    </div>
  )
}
