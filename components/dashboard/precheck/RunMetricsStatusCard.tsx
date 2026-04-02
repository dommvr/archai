'use client'

import { AlertTriangle, Calculator, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface RunMetricsStatusCardProps {
  /** True once a geometry snapshot exists with at least one metric. */
  hasModelMetrics: boolean
  /** True if run.runMetrics has been computed (non-null). */
  hasRunMetrics: boolean
  /** True when the site context has a parcel_area_m2 value. */
  hasSiteContextParcel: boolean
  /** True when the model is being synced right now. */
  isSyncing?: boolean
  /** True when compute-run-metrics is in flight. */
  isComputing: boolean
  onCompute: () => void
}

/**
 * Inline status card shown below SpeckleModelPicker on the Setup tab.
 *
 * Explains the model-metrics → run-metrics dependency and provides a
 * first-class CTA so users never need to drill into "Review metrics" to
 * discover that FAR still needs computing.
 */
export function RunMetricsStatusCard({
  hasModelMetrics,
  hasRunMetrics,
  hasSiteContextParcel,
  isSyncing = false,
  isComputing,
  onCompute,
}: RunMetricsStatusCardProps) {
  // Determine the overall state for styling
  const isDisabled = !hasModelMetrics || isSyncing
  const isPartial  = hasModelMetrics && !hasRunMetrics
  const isComplete = hasModelMetrics && hasRunMetrics

  const borderClass = isComplete
    ? 'border-emerald-400/20 bg-emerald-400/5'
    : isPartial
      ? 'border-archai-amber/30 bg-archai-amber/5'
      : 'border-archai-graphite bg-archai-charcoal'

  return (
    <div className={cn('rounded-lg border px-3 py-2.5 space-y-2', borderClass)}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {isComputing ? (
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-archai-amber" />
          ) : isComplete ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
          ) : isPartial ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-archai-amber" />
          ) : (
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
          )}

          <div className="min-w-0 space-y-0.5">
            <p className={cn(
              'text-xs font-medium',
              isComplete ? 'text-emerald-400'
              : isPartial ? 'text-archai-amber'
              : 'text-muted-foreground',
            )}>
              Run metrics
              {isComplete && ' · computed'}
              {isPartial && ' · not yet computed'}
              {!hasModelMetrics && ' · model required'}
            </p>

            {/* Dependency explanation — always visible */}
            <p className="text-[10px] text-muted-foreground/70 leading-snug">
              Needed for FAR, lot coverage, setbacks, and other site-context checks.
            </p>

            {/* Contextual hint for the partial state */}
            {isPartial && !isComputing && (
              <p className={cn(
                'text-[10px] leading-snug mt-0.5',
                hasSiteContextParcel ? 'text-archai-amber/80' : 'text-muted-foreground/50',
              )}>
                {hasSiteContextParcel
                  ? 'Next step: compute run metrics to enable FAR and site-context checks.'
                  : 'Add a site context with parcel area to enable FAR computation.'}
              </p>
            )}

            {/* Show computed values summary when done */}
            {isComplete && !isComputing && (
              <p className="text-[10px] text-muted-foreground/60 leading-snug">
                FAR and parcel-area metrics are available. Use &quot;Review metrics&quot; to inspect values.
              </p>
            )}
          </div>
        </div>

        {/* CTA button */}
        <Button
          type="button"
          variant={isPartial ? 'archai' : 'outline'}
          size="sm"
          className={cn(
            'h-6 shrink-0 text-[10px] px-2',
            !isPartial && 'border-archai-graphite bg-transparent text-muted-foreground hover:text-white',
          )}
          disabled={isDisabled || isComputing}
          onClick={onCompute}
          title={
            isSyncing      ? 'Waiting for model sync to complete'
            : !hasModelMetrics ? 'Sync a model first to enable run metric computation'
            : undefined
          }
        >
          {isComputing ? (
            <><Loader2 className="h-3 w-3 animate-spin mr-1" />Computing…</>
          ) : isComplete ? (
            <><Calculator className="h-3 w-3 mr-1" />Recompute</>
          ) : (
            <><Calculator className="h-3 w-3 mr-1" />Compute run metrics</>
          )}
        </Button>
      </div>

      {/* Status row: model metrics + run metrics chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatusChip
          label="Model metrics"
          done={hasModelMetrics}
          active={isSyncing}
        />
        <StatusChip
          label="Run metrics"
          done={isComplete}
          active={isComputing}
          partial={isPartial}
        />
      </div>
    </div>
  )
}

function StatusChip({
  label,
  done,
  active,
  partial = false,
}: {
  label: string
  done: boolean
  active?: boolean
  partial?: boolean
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium',
      done    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
      : active  ? 'border-archai-amber/30 bg-archai-amber/10 text-archai-amber'
      : partial ? 'border-archai-amber/20 bg-archai-amber/5 text-archai-amber/70'
      :           'border-archai-graphite text-muted-foreground/40',
    )}>
      {done   && <CheckCircle2 className="h-2 w-2" />}
      {active && <Loader2 className="h-2 w-2 animate-spin" />}
      {!done && !active && partial && <AlertTriangle className="h-2 w-2" />}
      {!done && !active && !partial && <div className="h-1.5 w-1.5 rounded-full border border-current" />}
      {label}
      <span className="text-[8px] opacity-70">
        {done ? '✓' : active ? '…' : partial ? '!' : '–'}
      </span>
    </span>
  )
}
