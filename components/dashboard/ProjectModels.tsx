'use client'

/**
 * ProjectModels — project-level model library and active model management.
 *
 * Lists all SpeckleModelRefs synced directly to this project.
 * "Add Model" opens ProjectModelSyncDialog — no redirect to Tool 1.
 *
 * Sync state is driven by SpeckleModelRef.syncedAt (null = never synced /
 * currently syncing; datetime = sync complete). When a sync is triggered,
 * the backend returns immediately and runs geometry extraction in the
 * background. We poll until syncedAt appears, then stop.
 *
 * SPECKLE EXPORT PLACEHOLDER — future: upload IFC, Rhino, Revit files directly
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Box, CheckCircle2, Plus, Star, Loader2, Trash2, Eye, BarChart2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import * as precheckApi from '@/lib/precheck/api'
import type { GeometrySnapshot, SpeckleModelRef } from '@/lib/precheck/types'
import { ProjectModelSyncDialog } from './ProjectModelSyncDialog'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a datetime string as "DD MMM YYYY, HH:MM" — readable, includes time. */
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    day:    '2-digit',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  })
}

const METRIC_LABELS: Record<string, string> = {
  gross_floor_area_m2:    'Gross Floor Area',
  building_height_m:      'Building Height',
  far:                    'Floor Area Ratio',
  lot_coverage_pct:       'Lot Coverage',
  front_setback_m:        'Front Setback',
  side_setback_left_m:    'Side Setback (Left)',
  side_setback_right_m:   'Side Setback (Right)',
  rear_setback_m:         'Rear Setback',
  parking_spaces_provided: 'Parking Spaces',
}

// ── MetricsDialog ─────────────────────────────────────────────────────────────

function MetricsDialog({
  open,
  onOpenChange,
  modelRef,
  projectId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  modelRef: SpeckleModelRef | null
  projectId: string
}) {
  const [snapshot, setSnapshot] = useState<GeometrySnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !modelRef) return
    setLoading(true)
    setError(null)
    precheckApi.getModelRefSnapshot(projectId, modelRef.id)
      .then((s) => { setSnapshot(s); setLoading(false) })
      .catch(() => { setError('Failed to load metrics.'); setLoading(false) })
  }, [open, modelRef, projectId])

  const metrics = snapshot?.metrics ?? []
  const fetchSkipped = snapshot?.rawMetrics?.fetch_skipped as boolean | undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-archai-charcoal border-archai-graphite">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-white">
            {modelRef?.modelName ?? 'Model'} — Metrics
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Loading metrics…</span>
          </div>
        )}

        {!loading && error && (
          <p className="text-xs text-red-400 py-4">{error}</p>
        )}

        {!loading && !error && !snapshot && (
          <div className="py-6 text-center">
            <p className="text-xs text-muted-foreground">
              Metrics not yet computed. They will appear after the model is synced.
            </p>
          </div>
        )}

        {!loading && !error && snapshot && fetchSkipped && (
          <div className="py-4 space-y-2">
            <p className="text-xs text-archai-amber">
              Geometry extraction was skipped (no Speckle token configured).
            </p>
            <p className="text-[10px] text-muted-foreground">
              Configure SPECKLE_TOKEN in the backend .env to enable metric extraction.
            </p>
          </div>
        )}

        {!loading && !error && snapshot && !fetchSkipped && metrics.length === 0 && (
          <p className="text-xs text-muted-foreground py-4">
            No geometry metrics were extracted from this model.
          </p>
        )}

        {!loading && !error && snapshot && metrics.length > 0 && (
          <div className="space-y-2 py-2">
            {metrics.map((m) => (
              <div key={m.key} className="flex items-baseline justify-between gap-2 py-1.5 border-b border-archai-graphite/50 last:border-0">
                <span className="text-xs text-muted-foreground">
                  {METRIC_LABELS[m.key] ?? m.key}
                </span>
                <span className="text-xs font-semibold text-white tabular-nums">
                  {m.value % 1 === 0 ? m.value.toFixed(0) : m.value.toFixed(2)}
                  {m.units ? <span className="font-normal text-muted-foreground ml-1">{m.units}</span> : null}
                </span>
              </div>
            ))}
            {(snapshot.rawMetrics?.extraction_notes as string[] | undefined)?.length ? (
              <div className="pt-2 space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Notes</p>
                {(snapshot.rawMetrics.extraction_notes as string[]).map((n, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground/70">{n}</p>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Sync state helpers ────────────────────────────────────────────────────────

/**
 * Derive a model's sync state from its SpeckleModelRef:
 *   - 'unsynced'  — syncedAt is null/missing (never completed a sync)
 *   - 'synced'    — syncedAt is present
 * The 'syncing' overlay is applied separately by the caller via syncingIds set.
 */
type ModelSyncState = 'unsynced' | 'syncing' | 'synced'

function getSyncState(ref: SpeckleModelRef, syncingIds: Set<string>): ModelSyncState {
  if (syncingIds.has(ref.id)) return 'syncing'
  if (ref.syncedAt) return 'synced'
  return 'unsynced'
}

// ── ProjectModels ─────────────────────────────────────────────────────────────

interface ProjectModelsProps {
  projectId: string
}

/** How often to poll for syncedAt while a sync is in progress (ms). */
const SYNC_POLL_INTERVAL_MS = 2_500
/** Max time to keep polling before giving up (ms). */
const SYNC_POLL_TIMEOUT_MS  = 90_000

export function ProjectModels({ projectId }: ProjectModelsProps) {
  const router = useRouter()
  const [modelRefs,       setModelRefs]       = useState<SpeckleModelRef[]>([])
  const [loading,         setLoading]         = useState(true)
  const [syncDialogOpen,  setSyncDialogOpen]  = useState(false)
  const [activeRefId,     setActiveRefId]     = useState<string | null>(null)
  const [settingActive,   setSettingActive]   = useState<string | null>(null)
  const [activeError,     setActiveError]     = useState<string | null>(null)
  const [deletingId,      setDeletingId]      = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleteError,     setDeleteError]     = useState<string | null>(null)
  const [metricsRef,      setMetricsRef]      = useState<SpeckleModelRef | null>(null)
  const [resyncError,     setResyncError]     = useState<string | null>(null)

  /**
   * Set of model ref IDs that are currently syncing.
   * A ref stays in this set until its syncedAt transitions from null → value.
   * Drives the per-row sync state display.
   */
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set())

  // Track active poll timers so we can clear them on unmount.
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  const pollDeadlines = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    return () => {
      // Clear all polling timers on unmount
      pollTimers.current.forEach((t) => clearInterval(t))
      pollDeadlines.current.forEach((t) => clearTimeout(t))
    }
  }, [])

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      precheckApi.listProjectModelRefs(projectId),
      precheckApi.getProjectActiveModelRef(projectId),
    ])
      .then(([{ modelRefs: refs }, activeRef]) => {
        if (cancelled) return
        setModelRefs(refs)
        setActiveRefId(activeRef?.id ?? null)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(load, [load])

  /**
   * Start polling for a specific model ref until syncedAt appears.
   * Updates the ref in modelRefs state and removes it from syncingIds when done.
   */
  function startSyncPoller(refId: string) {
    // Don't double-start
    if (pollTimers.current.has(refId)) return

    const deadline = setTimeout(() => {
      // Timed out — stop polling, remove from syncing
      clearInterval(pollTimers.current.get(refId))
      pollTimers.current.delete(refId)
      pollDeadlines.current.delete(refId)
      setSyncingIds((prev) => {
        const next = new Set(prev)
        next.delete(refId)
        return next
      })
    }, SYNC_POLL_TIMEOUT_MS)
    pollDeadlines.current.set(refId, deadline)

    const timer = setInterval(async () => {
      try {
        const { modelRefs: freshRefs } = await precheckApi.listProjectModelRefs(projectId)
        const freshRef = freshRefs.find((r) => r.id === refId)
        if (!freshRef) {
          // Ref was deleted; stop polling
          stopPoller(refId)
          setSyncingIds((prev) => { const n = new Set(prev); n.delete(refId); return n })
          return
        }
        // Update the ref in state regardless so timestamp and name stay fresh
        setModelRefs((prev) => prev.map((r) => r.id === refId ? freshRef : r))

        if (freshRef.syncedAt) {
          // Sync complete — remove from syncing set and stop polling
          stopPoller(refId)
          setSyncingIds((prev) => { const n = new Set(prev); n.delete(refId); return n })
        }
      } catch {
        // Network error — keep polling until deadline
      }
    }, SYNC_POLL_INTERVAL_MS)

    pollTimers.current.set(refId, timer)
  }

  function stopPoller(refId: string) {
    clearInterval(pollTimers.current.get(refId))
    clearTimeout(pollDeadlines.current.get(refId))
    pollTimers.current.delete(refId)
    pollDeadlines.current.delete(refId)
  }

  async function handleSetActive(refId: string) {
    if (settingActive) return
    setSettingActive(refId)
    setActiveError(null)
    try {
      await precheckApi.setActiveProjectModel({ projectId, modelRefId: refId })
      setActiveRefId(refId)
    } catch {
      setActiveError('Failed to set active model.')
    } finally {
      setSettingActive(null)
    }
  }

  async function handleDelete(refId: string) {
    if (deletingId) return
    setDeletingId(refId)
    setDeleteError(null)
    try {
      await precheckApi.deleteProjectModel({ projectId, modelRefId: refId })
      setModelRefs((prev) => prev.filter((r) => r.id !== refId))
      stopPoller(refId)
      setSyncingIds((prev) => { const n = new Set(prev); n.delete(refId); return n })
      // Re-fetch active model: backend may have promoted a fallback
      const activeRef = await precheckApi.getProjectActiveModelRef(projectId)
      setActiveRefId(activeRef?.id ?? null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete model.'
      try {
        const parsed = JSON.parse(msg) as { detail?: string }
        setDeleteError(parsed.detail ?? msg)
      } catch {
        setDeleteError(msg)
      }
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  function handleSynced(ref: SpeckleModelRef) {
    // If ref already exists (dedup), update it in place; otherwise prepend.
    setModelRefs((prev) => {
      const idx = prev.findIndex((r) => r.id === ref.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = ref
        return next
      }
      return [ref, ...prev]
    })
    // If syncedAt is still null (background task not done), start polling
    if (!ref.syncedAt) {
      setSyncingIds((prev) => new Set([...prev, ref.id]))
      startSyncPoller(ref.id)
    }
  }

  async function handleResync(ref: SpeckleModelRef) {
    if (syncingIds.has(ref.id)) return
    setResyncError(null)
    // Optimistically mark as syncing
    setSyncingIds((prev) => new Set([...prev, ref.id]))
    // Clear any previous syncedAt locally so the status shows syncing
    setModelRefs((prev) => prev.map((r) =>
      r.id === ref.id ? { ...r, syncedAt: null } : r
    ))
    try {
      await precheckApi.syncProjectModel({
        projectId,
        streamId:  ref.streamId,
        versionId: ref.versionId,
        branchName: ref.branchName ?? undefined,
        modelName:  ref.modelName  ?? undefined,
      })
      // API returned — sync started in background. Poll until syncedAt appears.
      startSyncPoller(ref.id)
    } catch {
      setResyncError('Sync failed — please try again.')
      setSyncingIds((prev) => { const n = new Set(prev); n.delete(ref.id); return n })
      stopPoller(ref.id)
      // Restore original syncedAt
      setModelRefs((prev) => prev.map((r) =>
        r.id === ref.id ? { ...r, syncedAt: ref.syncedAt } : r
      ))
    }
  }

  // Sorted: active first, then by selectedAt DESC
  const sortedRefs = [...modelRefs].sort((a, b) => {
    if (a.id === activeRefId) return -1
    if (b.id === activeRefId) return  1
    return new Date(b.selectedAt).getTime() - new Date(a.selectedAt).getTime()
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-archai-graphite px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Models</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Speckle models linked to this project
          </p>
        </div>
        <Button
          variant="archai"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setSyncDialogOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Model
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {(activeError ?? deleteError ?? resyncError) && (
          <p className="mb-3 text-xs text-red-400">{activeError ?? deleteError ?? resyncError}</p>
        )}

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-lg border border-archai-graphite bg-archai-black/40 animate-pulse" />
            ))}
          </div>
        ) : modelRefs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-xl border border-archai-graphite flex items-center justify-center mb-4">
              <Box className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground mb-1">No models added yet</p>
            <p className="text-xs text-muted-foreground/60 mb-4">
              Add a Speckle model to link it to this project.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setSyncDialogOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add First Model
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {activeRefId && (
              <div className="rounded-lg border border-archai-orange/20 bg-archai-orange/5 px-4 py-3 flex items-center gap-2 mb-4">
                <Star className="h-3.5 w-3.5 text-archai-orange shrink-0" />
                <p className="text-xs text-archai-orange font-medium">
                  Active model is used as the default for all new tool runs.
                </p>
              </div>
            )}

            {sortedRefs.map((ref) => {
              const isActive      = ref.id === activeRefId
              const isSetting     = settingActive === ref.id
              const isDeleting    = deletingId === ref.id
              const isConfirming  = confirmDeleteId === ref.id
              const syncState     = getSyncState(ref, syncingIds)
              const isSyncing     = syncState === 'syncing'
              const hasSynced     = syncState === 'synced'
              const busyAny       = Boolean(settingActive) || Boolean(deletingId) || syncingIds.size > 0

              return (
                <div
                  key={ref.id}
                  className={cn(
                    'rounded-lg border p-4 transition-colors group',
                    isActive
                      ? 'border-archai-orange/30 bg-archai-orange/5'
                      : 'border-archai-graphite bg-archai-black/40',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      hasSynced ? 'text-emerald-400' : 'text-muted-foreground/30',
                    )} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">
                          {ref.modelName ?? 'Speckle Model'}
                        </p>
                        {isActive && (
                          <span className="text-[10px] font-medium text-archai-orange border border-archai-orange/30 rounded-full px-2 py-0.5 shrink-0">
                            active
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate">
                        {ref.streamId} / {ref.versionId}
                      </p>
                      {ref.branchName && (
                        <p className="text-[10px] text-muted-foreground/60">branch: {ref.branchName}</p>
                      )}

                      {/* Sync status line — driven by real syncedAt */}
                      {isSyncing ? (
                        <p className="text-[10px] text-archai-amber/70 mt-0.5 flex items-center gap-1">
                          <Loader2 className="h-2.5 w-2.5 animate-spin inline-block" />
                          Syncing…
                        </p>
                      ) : hasSynced ? (
                        <p className="text-[10px] text-emerald-400/70 mt-0.5">
                          Synced {formatDateTime(ref.syncedAt!)}
                        </p>
                      ) : (
                        <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                          Not yet synced
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isConfirming ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleDelete(ref.id)}
                            disabled={Boolean(isDeleting)}
                            className="text-[10px] font-medium text-red-400 hover:text-red-300 transition-colors"
                          >
                            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[10px] text-muted-foreground hover:text-white transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] gap-1"
                            aria-label={`View ${ref.modelName ?? 'model'} in viewer`}
                            onClick={() =>
                              isActive
                                // Active model: plain viewer — no previewModelId needed, viewer shows it by default.
                                ? router.push(`/dashboard/projects/${projectId}/viewer`)
                                // Non-active model: preview URL so the viewer knows to show the yellow banner.
                                : router.push(`/dashboard/projects/${projectId}/viewer?previewModelId=${ref.id}`)
                            }
                            disabled={busyAny}
                          >
                            <Eye className="h-2.5 w-2.5" />
                            View
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] gap-1"
                            aria-label={`View metrics for ${ref.modelName ?? 'model'}`}
                            onClick={() => setMetricsRef(ref)}
                            disabled={busyAny || !hasSynced}
                          >
                            <BarChart2 className="h-2.5 w-2.5" />
                            Metrics
                          </Button>
                          {/* Sync / Resync — label depends on whether model has ever been synced */}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] gap-1"
                            aria-label={hasSynced ? `Resync ${ref.modelName ?? 'model'}` : `Sync ${ref.modelName ?? 'model'}`}
                            onClick={() => void handleResync(ref)}
                            disabled={busyAny}
                          >
                            {isSyncing
                              ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              : <RotateCw className="h-2.5 w-2.5" />}
                            {hasSynced ? 'Resync' : 'Sync'}
                          </Button>
                          {!isActive && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[10px] gap-1"
                              onClick={() => void handleSetActive(ref.id)}
                              disabled={busyAny}
                            >
                              {isSetting
                                ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                : <Star className="h-2.5 w-2.5" />}
                              Set Active
                            </Button>
                          )}
                          <button
                            type="button"
                            aria-label={`Delete ${ref.modelName ?? 'model'}`}
                            onClick={() => setConfirmDeleteId(ref.id)}
                            disabled={busyAny}
                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-900/20 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            {/* SPECKLE EXPORT PLACEHOLDER */}
            {/* Future: direct IFC/Revit/Rhino upload will appear here */}
          </div>
        )}
      </div>

      <ProjectModelSyncDialog
        projectId={projectId}
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        onSynced={handleSynced}
      />

      <MetricsDialog
        open={metricsRef !== null}
        onOpenChange={(v) => { if (!v) setMetricsRef(null) }}
        modelRef={metricsRef}
        projectId={projectId}
      />
    </div>
  )
}
