'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Plus,
  RefreshCw,
  Calculator,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import * as precheckApi from '@/lib/precheck/api'
import type {
  GeometrySnapshot,
  PrecheckRun,
  SpeckleModelRef,
  SyncSpeckleModelInput,
} from '@/lib/precheck/types'

interface SpeckleModelPickerProps {
  runId:             string
  projectId:         string
  onSync:            (input: SyncSpeckleModelInput) => Promise<void>
  /**
   * Called when the user picks an existing project model ref from the library.
   * Assigns the ref to the run without creating a new speckle_model_refs row.
   */
  onAssignExisting:  (modelRefId: string) => Promise<void>
  modelRef?:         SpeckleModelRef | null
  geometrySnapshot?: GeometrySnapshot | null
  /** The current run — used to detect failed syncs, show errors, and read run_metrics. */
  run?:              PrecheckRun | null
  isLoading?:        boolean
  /**
   * Project-level active model ref id — used to highlight the active model
   * in the project library picker.
   */
  defaultModelRef?:  { streamId: string; versionId: string; branchName?: string; modelName?: string } | null
  /** Called after compute-run-metrics succeeds so the parent can refresh the run. */
  onRunMetricsComputed?: (updatedRun: PrecheckRun) => void
}

export function SpeckleModelPicker({
  runId,
  projectId,
  onSync,
  onAssignExisting,
  modelRef,
  geometrySnapshot,
  run,
  isLoading,
  defaultModelRef,
  onRunMetricsComputed,
}: SpeckleModelPickerProps) {
  // Project model library
  const [projectModels, setProjectModels]   = useState<SpeckleModelRef[]>([])
  const [modelsLoading, setModelsLoading]   = useState(false)
  const [activeRefId,   setActiveRefId]     = useState<string | null>(null)

  // UI state
  const [showChangePanel,  setShowChangePanel]  = useState(false) // visible when modelRef exists and user wants to switch
  const [showNewForm,      setShowNewForm]      = useState(false) // raw ID form for syncing a new model
  const [submitting,       setSubmitting]       = useState(false)
  const [reviewOpen,       setReviewOpen]       = useState(false)
  const [diagnosticsOpen,  setDiagnosticsOpen]  = useState(false)
  const [computingMetrics, setComputingMetrics] = useState(false)

  // New-model form fields
  const [streamId,   setStreamId]   = useState('')
  const [versionId,  setVersionId]  = useState('')
  const [branchName, setBranchName] = useState('')
  const [modelName,  setModelName]  = useState('')

  const loadProjectModels = useCallback(() => {
    if (!projectId) return
    let cancelled = false
    setModelsLoading(true)
    Promise.all([
      precheckApi.listProjectModelRefs(projectId),
      precheckApi.getProjectActiveModelRef(projectId),
    ])
      .then(([{ modelRefs }, activeRef]) => {
        if (cancelled) return
        setProjectModels(modelRefs)
        setActiveRefId(activeRef?.id ?? null)
        setModelsLoading(false)
      })
      .catch(() => { if (!cancelled) setModelsLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    const cleanup = loadProjectModels()
    return cleanup
  }, [loadProjectModels])

  // Pre-seed new-form from defaultModelRef when visible
  useEffect(() => {
    if (!showNewForm) return
    const src = defaultModelRef ?? null
    if (src && !streamId) {
      setStreamId(src.streamId)
      setVersionId(src.versionId)
      setBranchName(src.branchName ?? '')
      setModelName(src.modelName  ?? '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewForm])

  async function handlePickModel(ref: SpeckleModelRef) {
    setSubmitting(true)
    try {
      // Assign the existing ref to the run — no new speckle_model_refs row created
      await onAssignExisting(ref.id)
      setShowChangePanel(false)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleNewFormSubmit(e: React.FormEvent) {
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
      setShowChangePanel(false)
      setShowNewForm(false)
      // Refresh library so the newly synced model appears
      loadProjectModels()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleComputeRunMetrics() {
    setComputingMetrics(true)
    try {
      const updatedRun = await precheckApi.computeRunMetrics({ runId })
      onRunMetricsComputed?.(updatedRun)
    } finally {
      setComputingMetrics(false)
    }
  }

  const isSyncing = Boolean(isLoading || submitting)
  const syncFailed = modelRef != null && run?.status === 'failed'

  // ── Already synced — show status card ──────────────────────────────────────
  const syncedStatusCard = modelRef ? (() => {
    const metricCount = geometrySnapshot?.metrics?.length ?? null
    const hasSnapshot = geometrySnapshot != null
    const hasMetrics  = metricCount !== null && metricCount > 0
    const noMetrics   = metricCount === 0

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

    const heightMetric = geometrySnapshot?.metrics?.find((m) => m.key === 'building_height_m') ?? null
    const gfaMetric    = geometrySnapshot?.metrics?.find((m) => m.key === 'gross_floor_area_m2') ?? null
    // FAR is a run-specific metric (requires parcel area) — read from run.runMetrics, not snapshot
    const runFar = (run?.runMetrics as Record<string, unknown> | null | undefined)?.far as number | null | undefined

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

    const extractionNotes = (geometrySnapshot?.rawMetrics?.extraction_notes as string[] | undefined) ?? []

    const statusLabel =
      isSyncing   ? 'syncing…' :
      syncFailed  ? 'sync failed' :
      hasMetrics  ? `synced · ${metricCount} metric${metricCount === 1 ? '' : 's'}` :
      noMetrics   ? 'synced, no geometry metrics' :
      hasSnapshot ? 'synced' :
      'model linked'

    const compactNote: { text: string; tone: 'error' | 'warn' | 'info' } | null = (() => {
      if (syncFailed)       return null
      if (noMetrics && !syncFailed)
        return { text: 'No geometry extracted — check token/model', tone: 'warn' }
      if (!hasMetrics)      return null
      if (unitWarnings.length > 0)
        return { text: `${unitWarnings.length} unit warning${unitWarnings.length > 1 ? 's' : ''}`, tone: 'warn' }
      if (unitHeuristic)
        return { text: 'Unit heuristic applied — verify model units', tone: 'warn' }
      if (unitConverted && resolvedUnit && resolvedUnit !== 'm')
        return { text: `Units normalised: ${resolvedUnit} → m`, tone: 'info' }
      return null
    })()

    // Show "Review metrics" toggle whenever model metrics exist (run metrics section always appears inside)
    const hasReviewContent = hasMetrics && (heightMetric != null || gfaMetric != null || unitConverted || unitWarnings.length > 0 || extractionNotes.length > 0 || true)

    return (
      <>
        {/* Compact status card */}
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
              {syncFailed && run?.errorMessage && (
                <p className="text-[10px] text-red-400/80 mt-0.5 break-words">{run.errorMessage}</p>
              )}
              {syncFailed && !run?.errorMessage && (
                <p className="text-[10px] text-red-400/70 mt-0.5">
                  Geometry extraction failed. Re-sync or check backend logs.
                </p>
              )}
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

          {hasReviewContent && (
            <button
              type="button"
              onClick={() => setReviewOpen((v) => !v)}
              className="flex w-full items-center justify-between pt-1 text-[10px] font-medium text-muted-foreground hover:text-white transition-colors"
            >
              <span>Review metrics</span>
              {reviewOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>

        {/* Inline review panel */}
        {reviewOpen && hasReviewContent && (
          <div className="rounded-lg border border-archai-graphite bg-archai-black/60 p-3 space-y-3 text-[10px]">
            {/* Building height */}
            {heightMetric && (() => {
              const tier            = heightDiag?.chosen_source_tier ?? null
              const sourceField     = heightDiag?.chosen_source ?? null
              const isWholeBuilding = heightDiag?.whole_building_source ?? null
              const isWeakFallback  = tier === 'weak_fallback_element_dimension'
              const byKind          = heightDiag?.by_kind ?? {}

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

              const foundKinds = Object.entries(byKind).filter(([, n]) => n > 0).map(([k]) => k)
              const chosenKind = heightDiag?.chosen_source_kind ?? null

              return (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Building Height</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-white">{heightMetric.value.toFixed(2)}</span>
                    <span className="text-muted-foreground">{heightMetric.units ?? 'm'}</span>
                    {unitHeuristic && <span className="text-archai-amber/70">· unit heuristic</span>}
                    {unitConverted && !unitHeuristic && <span className="text-sky-400/70">· converted</span>}
                  </div>
                  <div className="space-y-0.5">
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
                    {isWholeBuilding === false && (
                      <p className="text-red-400/70">Not a whole-building measurement — single element dimension only.</p>
                    )}
                    {isWeakFallback && heightDiag?.warning && (
                      <p className="text-red-400/60 break-words">{heightDiag.warning}</p>
                    )}
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
                    {(tier === 'storey_elevation_estimated' || tier === 'storey_elevation_inferred_estimated') &&
                      heightDiag?.storey_count != null && (
                      <p className="text-muted-foreground/60">
                        {heightDiag.storey_count} storey{heightDiag.storey_count !== 1 ? 's' : ''} found
                        {heightDiag.storey_span_m != null ? `, span ${heightDiag.storey_span_m.toFixed(2)} m` : ''}
                        {heightDiag.avg_floor_to_floor_m != null ? ` + ${heightDiag.avg_floor_to_floor_m.toFixed(2)} m/floor` : ''}
                        {' '}→ estimated top
                      </p>
                    )}
                    {foundKinds.length > 0 && (
                      <p className="text-muted-foreground/50">
                        Candidates found: {foundKinds.join(', ')}
                        {chosenKind && foundKinds.length > 1 ? ` · chose ${chosenKind}` : ''}
                      </p>
                    )}
                  </div>
                  {heightMetric.sourceObjectIds.length > 0 ? (
                    <div className="space-y-1 pt-0.5">
                      <p className="text-muted-foreground">
                        {heightMetric.sourceObjectIds.length} source object{heightMetric.sourceObjectIds.length !== 1 ? 's' : ''}
                        {' '}<span className="text-muted-foreground/50">(height source elements)</span>
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

            {/* GFA */}
            {gfaMetric && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Gross Floor Area</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-white">{gfaMetric.value.toFixed(1)}</span>
                  <span className="text-muted-foreground">{gfaMetric.units ?? 'm²'}</span>
                </div>
                {unitHeuristic && unitNorm?.gfa_before_conversion != null && unitNorm.gfa_after_conversion != null && (
                  <p className="text-archai-amber/70">
                    Before conversion: {unitNorm.gfa_before_conversion.toFixed(1)} → after: {unitNorm.gfa_after_conversion.toFixed(1)} m²
                  </p>
                )}
                {gfaMetric.sourceObjectIds.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-muted-foreground">
                      {gfaMetric.sourceObjectIds.length} source object{gfaMetric.sourceObjectIds.length !== 1 ? 's' : ''} included
                      {' '}<span className="text-muted-foreground/50">(floor/slab elements)</span>
                    </p>
                    <div className="space-y-0.5 max-h-[96px] overflow-y-auto">
                      {gfaMetric.sourceObjectIds.map((id) => (
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

            {/* Run metrics section — FAR and future site-context-dependent metrics */}
            <div className="space-y-1.5 border-t border-archai-graphite pt-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Run Metrics
                <span className="ml-1 normal-case text-muted-foreground/40 tracking-normal font-normal">(site-context dependent)</span>
              </p>

              {/* FAR */}
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Floor Area Ratio</p>
                {runFar != null ? (
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-white">{runFar.toFixed(3)}</span>
                    <span className="text-muted-foreground">FAR</span>
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground/50 leading-snug">
                    Run metrics not computed yet. Use the <span className="text-archai-amber/70">Compute run metrics</span> button above to calculate FAR and other site-context checks.
                  </p>
                )}
              </div>

              {/* Lot coverage placeholder */}
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Lot Coverage</p>
                <p className="text-[10px] text-muted-foreground/40 leading-snug">
                  Requires site boundary polygon — not yet implemented.
                </p>
              </div>

              {/* Secondary compute button inside the panel for convenience */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2 border-archai-graphite bg-transparent text-muted-foreground hover:text-white"
                disabled={computingMetrics || !modelRef || !run}
                onClick={() => void handleComputeRunMetrics()}
              >
                {computingMetrics
                  ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Computing…</>
                  : <><Calculator className="h-3 w-3 mr-1" />{runFar != null ? 'Recompute run metrics' : 'Compute run metrics'}</>
                }
              </Button>
            </div>

            {/* Diagnostics */}
            {(unitWarnings.length > 0 || extractionNotes.length > 0) && (
              <div className="space-y-1 border-t border-archai-graphite pt-2">
                <button
                  type="button"
                  onClick={() => setDiagnosticsOpen((v) => !v)}
                  className="flex w-full items-center justify-between text-[10px] font-medium text-muted-foreground hover:text-white transition-colors"
                >
                  <span>Diagnostics</span>
                  {diagnosticsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
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

        {/* Change model button — opens the picker panel */}
        {!showChangePanel && !isSyncing && (
          <button
            type="button"
            onClick={() => setShowChangePanel(true)}
            className="text-[10px] text-muted-foreground hover:text-white transition-colors"
          >
            {syncFailed ? 'Re-sync or choose a different model →' : 'Change model →'}
          </button>
        )}
      </>
    )
  })() : null

  // ── Project model library picker ────────────────────────────────────────────
  const libraryPicker = (
    <div className="space-y-2">
      {modelsLoading ? (
        <div className="space-y-1.5">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 rounded-lg border border-archai-graphite bg-archai-black/40 animate-pulse" />
          ))}
        </div>
      ) : projectModels.length === 0 ? (
        <p className="text-[10px] text-muted-foreground py-2">
          No models in the project library yet. Sync a new model below or add one from the Models page.
        </p>
      ) : (
        <div className="space-y-1.5">
          {/* Active model pinned first, then the rest sorted by selectedAt DESC */}
          {[...projectModels]
            .sort((a, b) => {
              if (a.id === activeRefId) return -1
              if (b.id === activeRefId) return  1
              return new Date(b.selectedAt).getTime() - new Date(a.selectedAt).getTime()
            })
            .map((ref) => {
            const isActive = ref.id === activeRefId
            return (
              <button
                key={ref.id}
                type="button"
                disabled={isSyncing}
                onClick={() => void handlePickModel(ref)}
                className={cn(
                  'w-full text-left rounded-lg border px-3 py-2.5 flex items-center gap-3 transition-colors',
                  isActive
                    ? 'border-archai-orange/30 bg-archai-orange/5 hover:bg-archai-orange/10'
                    : 'border-archai-graphite bg-archai-black/40 hover:bg-archai-charcoal',
                )}
              >
                <Box className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-archai-orange' : 'text-muted-foreground')} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-white truncate">{ref.modelName ?? 'Speckle Model'}</p>
                    {isActive && (
                      <span className="text-[9px] font-medium text-archai-orange border border-archai-orange/30 rounded-full px-1.5 py-0.5 shrink-0">
                        active
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[10px] text-muted-foreground truncate">
                    {ref.streamId} / {ref.versionId}
                  </p>
                </div>
                {submitting ? null : (
                  <span className="text-[10px] text-muted-foreground shrink-0">Use →</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Add a new model version — collapsible raw form */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowNewForm((v) => !v)}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-white transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add a new model version
          {showNewForm ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
        </button>

        {showNewForm && (
          <form onSubmit={handleNewFormSubmit} className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Speckle Project ID <span className="text-archai-orange">*</span>
              </label>
              <Input
                placeholder="abc123def456…"
                value={streamId}
                onChange={(e) => setStreamId(e.target.value)}
                className="bg-archai-black border-archai-graphite text-sm h-8 font-mono"
                required
                disabled={isSyncing}
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
                disabled={isSyncing}
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
                  disabled={isSyncing}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Model Name</label>
                <Input
                  placeholder="Tower Option A"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  className="bg-archai-black border-archai-graphite text-sm h-8"
                  disabled={isSyncing}
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="archai"
              size="sm"
              className="w-full"
              disabled={!streamId.trim() || !versionId.trim() || isSyncing}
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
              {isSyncing ? 'Adding…' : 'Add This Model'}
            </Button>
          </form>
        )}
      </div>

      {/* Cancel (when changing an existing model) */}
      {showChangePanel && (
        <button
          type="button"
          onClick={() => { setShowChangePanel(false); setShowNewForm(false) }}
          className="text-[10px] text-muted-foreground hover:text-white transition-colors"
        >
          ← Keep current model
        </button>
      )}
    </div>
  )

  return (
    <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Box className="h-4 w-4 text-archai-orange" />
        <p className="text-sm font-medium text-white">Speckle Model</p>
        {modelsLoading && !modelRef && (
          <RefreshCw className="h-3 w-3 text-muted-foreground animate-spin ml-auto" />
        )}
      </div>

      {/* Already synced: show status card, picker appears only on "Change model" */}
      {modelRef ? (
        <>
          {syncedStatusCard}
          {showChangePanel && (
            <div className="rounded-lg border border-archai-graphite bg-archai-black/40 p-3 space-y-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Choose from project library
              </p>
              {libraryPicker}
            </div>
          )}
        </>
      ) : (
        /* No model yet: show library picker directly */
        <>
          <p className="text-[10px] text-muted-foreground -mt-2">
            Choose a model from the project library or sync a new version.
          </p>
          {libraryPicker}
        </>
      )}

      {/* SPECKLE VIEWER WILL BE MOUNTED HERE */}
    </div>
  )
}
