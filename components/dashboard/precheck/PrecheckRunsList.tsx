'use client'

import { cn } from '@/lib/utils'
import type { PrecheckRun } from '@/lib/precheck/types'
import type { PrecheckRunStatus } from '@/lib/precheck/constants'

const STATUS_COLORS: Partial<Record<PrecheckRunStatus, string>> = {
  completed: 'text-emerald-400 bg-emerald-400/10',
  failed:    'text-red-400 bg-red-400/10',
  created:   'text-muted-foreground bg-archai-graphite/30',
}

function statusColor(status: PrecheckRunStatus): string {
  return STATUS_COLORS[status] ?? 'text-archai-amber bg-archai-amber/10'
}

interface PrecheckRunsListProps {
  runs:          PrecheckRun[]
  selectedRunId: string | null
  onSelect:      (runId: string) => void
  isLoading?:    boolean
}

export function PrecheckRunsList({ runs, selectedRunId, onSelect, isLoading }: PrecheckRunsListProps) {
  if (isLoading) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-archai-graphite animate-pulse opacity-60" />
        ))}
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-archai-graphite bg-archai-charcoal/50 p-5 text-center">
        <p className="text-xs text-muted-foreground">No runs yet. Start a new check above.</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {runs.map((run) => {
        const selected = run.id === selectedRunId
        return (
          <button
            key={run.id}
            onClick={() => onSelect(run.id)}
            className={cn(
              'w-full text-left rounded-lg border px-3 py-2.5 transition-colors',
              selected
                ? 'border-archai-orange/40 bg-archai-orange/5'
                : 'border-archai-graphite hover:border-archai-graphite hover:bg-archai-graphite/20',
            )}
          >
            <div className="flex items-center gap-2">
              <span className="flex-1 text-xs text-white font-mono truncate">
                {run.id.slice(0, 8)}…
              </span>
              <span className={cn('text-[10px] font-medium rounded-full px-1.5 py-0.5', statusColor(run.status))}>
                {run.status.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[10px] text-muted-foreground">
                {new Date(run.createdAt).toLocaleDateString(undefined, {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
              {run.readinessScore != null && (
                <span className={cn(
                  'text-[10px] font-bold',
                  run.readinessScore >= 80 ? 'text-emerald-400' :
                  run.readinessScore >= 60 ? 'text-archai-amber'  :
                                             'text-red-400',
                )}>
                  {run.readinessScore}/100
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
