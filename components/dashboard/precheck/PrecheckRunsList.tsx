'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
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
  onDeleteRun?:  (runId: string) => Promise<void>
}

export function PrecheckRunsList({ runs, selectedRunId, onSelect, isLoading, onDeleteRun }: PrecheckRunsListProps) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [deletingId,         setDeletingId]         = useState<string | null>(null)

  async function handleDeleteRun(runId: string) {
    if (!onDeleteRun) return
    setDeletingId(runId)
    try {
      await onDeleteRun(runId)
    } finally {
      setDeletingId(null)
      setConfirmingDeleteId(null)
    }
  }

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
        const selected     = run.id === selectedRunId
        const isConfirming = confirmingDeleteId === run.id
        const isDeleting   = deletingId === run.id
        return (
          <div
            key={run.id}
            className={cn(
              'group flex items-stretch rounded-lg border transition-colors',
              selected
                ? 'border-archai-orange/40 bg-archai-orange/5'
                : 'border-archai-graphite hover:border-archai-graphite hover:bg-archai-graphite/20',
            )}
          >
            {/* Select area */}
            <button
              onClick={() => onSelect(run.id)}
              className="flex-1 min-w-0 text-left px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-white truncate">
                  {run.name ?? (
                    <span className="font-mono text-muted-foreground">{run.id.slice(0, 8)}…</span>
                  )}
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

            {/* Delete area */}
            {onDeleteRun && (
              <div className="flex items-center pr-2 pl-1 shrink-0">
                {isConfirming ? (
                  <div className="flex flex-col items-end gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleDeleteRun(run.id)}
                      disabled={isDeleting}
                      className="text-[10px] font-medium text-red-400 hover:text-red-300 transition-colors leading-none"
                      aria-label={`Confirm delete run ${run.id.slice(0, 8)}`}
                    >
                      {isDeleting ? '…' : 'Del?'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      disabled={isDeleting}
                      className="text-[10px] text-muted-foreground hover:text-white transition-colors leading-none"
                      aria-label="Cancel delete"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(run.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-red-400"
                    aria-label={`Delete run ${run.id.slice(0, 8)}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
