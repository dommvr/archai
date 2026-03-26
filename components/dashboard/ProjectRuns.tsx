'use client'

/**
 * ProjectRuns — project-level run history.
 *
 * Shows all tool runs for this project. V1 only has precheck runs;
 * future tool runs (feasibility, sustainability, etc.) will appear here too.
 * Clicking a run navigates to the relevant tool workspace with that run selected.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  PlaySquare,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Map,
  Trash2,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import * as precheckApi from '@/lib/precheck/api'
import type { PrecheckRun } from '@/lib/precheck/types'

interface ProjectRunsProps {
  projectId: string
}

const STATUS_CONFIG: Record<PrecheckRun['status'], { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }> = {
  completed:         { label: 'Completed',        color: 'text-emerald-400', Icon: CheckCircle2  },
  failed:            { label: 'Failed',            color: 'text-red-400',    Icon: XCircle       },
  created:           { label: 'Created',           color: 'text-muted-foreground', Icon: Clock   },
  ingesting_site:    { label: 'Ingesting site',    color: 'text-archai-amber', Icon: AlertTriangle },
  ingesting_docs:    { label: 'Ingesting docs',    color: 'text-archai-amber', Icon: AlertTriangle },
  extracting_rules:  { label: 'Extracting rules',  color: 'text-archai-amber', Icon: AlertTriangle },
  syncing_model:     { label: 'Syncing model',     color: 'text-archai-amber', Icon: AlertTriangle },
  computing_metrics: { label: 'Computing metrics', color: 'text-archai-amber', Icon: AlertTriangle },
  evaluating:        { label: 'Evaluating',        color: 'text-archai-amber', Icon: AlertTriangle },
  generating_report: { label: 'Generating report', color: 'text-archai-amber', Icon: AlertTriangle },
  synced:            { label: 'Synced',            color: 'text-sky-400',    Icon: CheckCircle2  },
}

export function ProjectRuns({ projectId }: ProjectRunsProps) {
  const router = useRouter()
  const [runs,          setRuns]          = useState<PrecheckRun[]>([])
  const [loading,       setLoading]       = useState(true)
  const [deletingId,    setDeletingId]    = useState<string | null>(null)
  const [confirmId,     setConfirmId]     = useState<string | null>(null)
  const [deleteError,   setDeleteError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    precheckApi.listProjectRuns(projectId)
      .then(({ runs: r }) => { if (!cancelled) { setRuns(r); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  async function handleDelete(runId: string) {
    if (deletingId) return
    setDeletingId(runId)
    setDeleteError(null)
    try {
      await precheckApi.deleteRun(runId)
      setRuns((prev) => prev.filter((r) => r.id !== runId))
    } catch {
      setDeleteError('Failed to delete run.')
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-archai-graphite px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Runs</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            All tool runs for this project
          </p>
        </div>
        <Button
          variant="archai"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => router.push(`/dashboard/projects/${projectId}/precheck`)}
        >
          <Map className="h-3.5 w-3.5" />
          New Precheck Run
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {deleteError && (
          <p className="mb-3 text-xs text-red-400">{deleteError}</p>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-lg border border-archai-graphite bg-archai-black/40 animate-pulse" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-xl border border-archai-graphite flex items-center justify-center mb-4">
              <PlaySquare className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground mb-1">No runs yet</p>
            <p className="text-xs text-muted-foreground/60 mb-4">
              Start a precheck run to begin analysing this project.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => router.push(`/dashboard/projects/${projectId}/precheck`)}
            >
              <Map className="h-3.5 w-3.5" />
              Start Precheck
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* Tool type grouping label — V1 only has precheck */}
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Zoning &amp; Code Check
            </p>

            {runs.map((run) => {
              const cfg = STATUS_CONFIG[run.status] ?? STATUS_CONFIG['created']
              const { label, color, Icon } = cfg
              const isDeleting   = deletingId === run.id
              const isConfirming = confirmId === run.id
              return (
                <div
                  key={run.id}
                  className="group flex items-center gap-3 rounded-lg border border-archai-graphite bg-archai-black/40 px-3 py-3 hover:bg-archai-charcoal transition-colors"
                >
                  <button
                    className="flex flex-1 items-center gap-3 min-w-0 text-left"
                    onClick={() => router.push(`/dashboard/projects/${projectId}/precheck`)}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', color)} />

                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">
                        {run.name ?? 'Precheck Run'}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        <span className={color}>{label}</span>
                        {' · '}
                        {new Date(run.updatedAt).toLocaleDateString()}
                      </p>
                    </div>

                    {run.readinessScore != null && (
                      <div className="flex flex-col items-end shrink-0">
                        <span className={cn(
                          'text-sm font-semibold tabular-nums',
                          run.readinessScore >= 75 ? 'text-emerald-400' :
                          run.readinessScore >= 50 ? 'text-archai-amber' : 'text-red-400',
                        )}>
                          {run.readinessScore}
                        </span>
                        <span className="text-[10px] text-muted-foreground">readiness</span>
                      </div>
                    )}
                  </button>

                  {/* Delete controls */}
                  {isConfirming ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleDelete(run.id)}
                        disabled={Boolean(isDeleting)}
                        className="text-[10px] font-medium text-red-400 hover:text-red-300 transition-colors"
                      >
                        {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Delete'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="text-[10px] text-muted-foreground hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Delete ${run.name ?? 'run'}`}
                      onClick={() => setConfirmId(run.id)}
                      disabled={Boolean(deletingId)}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-900/20 transition-colors shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}

            {/* Placeholder for future tool run types */}
            {/* READY FOR TOOL 2 INTEGRATION HERE */}
            {/* READY FOR TOOL 6 INTEGRATION HERE */}
          </div>
        )}
      </div>
    </div>
  )
}
