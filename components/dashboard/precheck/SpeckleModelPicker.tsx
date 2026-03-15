'use client'

import { useState, useEffect } from 'react'
import { Box, CheckCircle2, Loader2, AlertTriangle, XCircle } from 'lucide-react'
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
  const [streamId,   setStreamId]   = useState(modelRef?.streamId  ?? '')
  const [versionId,  setVersionId]  = useState(modelRef?.versionId ?? '')
  const [branchName, setBranchName] = useState(modelRef?.branchName ?? '')
  const [modelName,  setModelName]  = useState(modelRef?.modelName  ?? '')
  const [submitting, setSubmitting] = useState(false)

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

        // Unit normalization note — present when the backend converted units
        // (declared or heuristic). Stored in rawMetrics by the Python pipeline.
        const unitNorm = geometrySnapshot?.rawMetrics?.unit_normalization as
          | { length_conversion_applied?: boolean; heuristic_applied?: boolean;
              resolved_length_units?: string; plausibility_warnings?: string[] }
          | null | undefined
        const unitConverted   = Boolean(unitNorm?.length_conversion_applied)
        const unitHeuristic   = Boolean(unitNorm?.heuristic_applied)
        const resolvedUnit    = unitNorm?.resolved_length_units ?? null
        const unitWarnings    = unitNorm?.plausibility_warnings ?? []

        const statusLabel =
          isSyncing   ? 'syncing…' :
          syncFailed  ? 'sync failed' :
          hasMetrics  ? `synced · ${metricCount} metric${metricCount === 1 ? '' : 's'}` :
          noMetrics   ? 'synced, no geometry metrics' :
          hasSnapshot ? 'synced' :
          'model linked'

        return (
          <div className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2',
            syncFailed
              ? 'border-red-400/20 bg-red-400/5'
              : hasMetrics
                ? 'border-emerald-400/20 bg-emerald-400/5'
                : 'border-archai-amber/20 bg-archai-amber/5',
          )}>
            {isSyncing ? (
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-archai-amber" />
            ) : syncFailed ? (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
            ) : hasMetrics ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-archai-amber" />
            )}
            <div className="min-w-0 space-y-0.5">
              <p className={cn(
                'text-xs font-medium truncate',
                syncFailed  ? 'text-red-400'      :
                hasMetrics  ? 'text-emerald-400'  :
                              'text-archai-amber',
              )}>
                {modelRef.modelName ?? 'Model'} · {statusLabel}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground truncate">
                {modelRef.streamId} / {modelRef.versionId}
              </p>
              {modelRef.branchName && (
                <p className="text-[10px] text-muted-foreground truncate">
                  branch: {modelRef.branchName}
                </p>
              )}
              {/* Sync failure — show the backend error message */}
              {syncFailed && run?.errorMessage && (
                <p className="text-[10px] text-red-400/80 mt-0.5 break-words">
                  {run.errorMessage}
                </p>
              )}
              {syncFailed && !run?.errorMessage && (
                <p className="text-[10px] text-red-400/70 mt-0.5">
                  Geometry extraction failed. Re-sync or check backend logs.
                </p>
              )}
              {/* No metrics but fetch succeeded — token or geometry issue */}
              {noMetrics && !syncFailed && (
                <p className="text-[10px] text-archai-amber/70 mt-0.5">
                  No geometry metrics extracted. Check SPECKLE_TOKEN is set and
                  the model contains typed floor/wall elements.
                </p>
              )}
              {/* Unit conversion note — shown when the pipeline normalised units */}
              {hasMetrics && unitConverted && !unitWarnings.length && (
                <p className="text-[10px] text-sky-400/70 mt-0.5">
                  Units normalised: {resolvedUnit} → m
                  {unitHeuristic ? ' (heuristic — verify source model units)' : ''}
                </p>
              )}
              {hasMetrics && unitWarnings.length > 0 && (
                <p className="text-[10px] text-archai-amber/80 mt-0.5">
                  Unit note: {unitWarnings[0]}
                </p>
              )}
            </div>
          </div>
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
