'use client'

/**
 * ProjectOverview — project home workspace.
 *
 * Shows a concise summary of the project state: active model, latest runs,
 * readiness score from the most recent precheck, key metrics, and quick actions.
 *
 * Reuses precheck API (listProjectRuns) to surface latest run data
 * without duplicating any data-fetching logic.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Eye,
  Box,
  FileText,
  PlaySquare,
  Map,
  Upload,
  RefreshCw,
  Bot,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import * as precheckApi from '@/lib/precheck/api'
import type { PrecheckRun, SpeckleModelRef } from '@/lib/precheck/types'
import { RightPanel } from './RightPanel'
import { ProjectDefaultSiteContextPanel } from './precheck/SiteContextPicker'
import { ResizableHorizontalSplit } from '@/components/ui/resizable-horizontal-split'

interface ProjectOverviewProps {
  projectId: string
  projectName: string
}

function RunStatusIcon({ status }: { status: PrecheckRun['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-400" />
  if (status === 'created') return <Clock className="h-3.5 w-3.5 text-muted-foreground" />
  return <AlertTriangle className="h-3.5 w-3.5 text-archai-amber" />
}

function statusLabel(status: PrecheckRun['status']): string {
  const map: Record<PrecheckRun['status'], string> = {
    created: 'Created',
    ingesting_site: 'Ingesting site',
    ingesting_docs: 'Ingesting docs',
    extracting_rules: 'Extracting rules',
    syncing_model: 'Syncing model',
    computing_metrics: 'Computing metrics',
    evaluating: 'Evaluating',
    generating_report: 'Generating report',
    completed: 'Completed',
    failed: 'Failed',
    synced: 'Synced',
  }
  return map[status] ?? status
}

export function ProjectOverview({ projectId, projectName }: ProjectOverviewProps) {
  const router = useRouter()
  const [runs, setRuns] = useState<PrecheckRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [activeModelRef, setActiveModelRef] = useState<SpeckleModelRef | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadingRuns(true)
    Promise.all([
      precheckApi.listProjectRuns(projectId),
      precheckApi.getProjectActiveModelRef(projectId),
    ])
      .then(([{ runs: r }, activeRef]) => {
        if (!cancelled) {
          setRuns(r)
          setActiveModelRef(activeRef ?? null)
          setLoadingRuns(false)
        }
      })
      .catch(() => { if (!cancelled) setLoadingRuns(false) })
    return () => { cancelled = true }
  }, [projectId])

  const quickActions = [
    {
      label: 'Open Viewer',
      Icon: Eye,
      action: () => router.push(`/dashboard/projects/${projectId}/viewer`),
    },
    {
      label: 'Run Precheck',
      Icon: Map,
      action: () => router.push(`/dashboard/projects/${projectId}/precheck`),
      primary: true,
    },
    {
      label: 'Sync Model',
      Icon: RefreshCw,
      action: () => router.push(`/dashboard/projects/${projectId}/models`),
    },
    {
      label: 'Upload Docs',
      Icon: Upload,
      action: () => router.push(`/dashboard/projects/${projectId}/documents`),
    },
    {
      label: 'Open Copilot',
      Icon: Bot,
      action: () => router.push(`/dashboard/projects/${projectId}/viewer`),
    },
  ]

  return (
    <ResizableHorizontalSplit
      storageKey="project-overview-right-panel"
      defaultLeftPercent={72}
      minLeftPercent={50}
      maxLeftPercent={85}
      leftPanel={
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header bar */}
        <div className="shrink-0 border-b border-archai-graphite px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-white">{projectName}</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">Project Overview</p>
          </div>
          <Button
            variant="archai"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => router.push(`/dashboard/projects/${projectId}/precheck`)}
          >
            <Map className="h-3.5 w-3.5" />
            Run Precheck
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-6 space-y-6">

            {/* Quick actions */}
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Quick Actions
              </p>
              <div className="flex flex-wrap gap-2">
                {quickActions.map(({ label, Icon, action, primary }) => (
                  <Button
                    key={label}
                    variant={primary ? 'archai' : 'outline'}
                    size="sm"
                    className="h-8 text-xs gap-2"
                    onClick={action}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Button>
                ))}
              </div>
            </section>

            {/* Active model */}
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Active Model
              </p>
              <div
                className={cn(
                  'rounded-lg border p-4 flex items-center gap-3 cursor-pointer transition-colors',
                  activeModelRef
                    ? 'border-emerald-400/20 bg-emerald-400/5 hover:bg-emerald-400/10'
                    : 'border-archai-graphite bg-archai-black/40 hover:bg-archai-charcoal',
                )}
                onClick={() => router.push(`/dashboard/projects/${projectId}/models`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && router.push(`/dashboard/projects/${projectId}/models`)}
              >
                <Box className={cn('h-5 w-5 shrink-0', activeModelRef ? 'text-emerald-400' : 'text-muted-foreground')} />
                <div className="flex-1 min-w-0">
                  {activeModelRef ? (
                    <>
                      <p className="text-sm font-medium text-white truncate">
                        {activeModelRef.modelName ?? 'Speckle Model'}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate">
                        {activeModelRef.streamId} / {activeModelRef.versionId}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-muted-foreground">No active model</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        Click to sync a Speckle model and set it as active
                      </p>
                    </>
                  )}
                </div>
              </div>
            </section>

            {/* Default site context */}
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Default Site Context
              </p>
              <ProjectDefaultSiteContextPanel projectId={projectId} />
            </section>

            {/* Latest runs */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent Runs
                </p>
                <button
                  className="text-[10px] text-muted-foreground hover:text-white transition-colors"
                  onClick={() => router.push(`/dashboard/projects/${projectId}/runs`)}
                >
                  See all
                </button>
              </div>

              {loadingRuns ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-11 rounded-lg border border-archai-graphite bg-archai-black/40 animate-pulse" />
                  ))}
                </div>
              ) : runs.length === 0 ? (
                <div
                  className="rounded-lg border border-dashed border-archai-graphite p-6 text-center cursor-pointer hover:border-archai-graphite/70 transition-colors"
                  onClick={() => router.push(`/dashboard/projects/${projectId}/precheck`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && router.push(`/dashboard/projects/${projectId}/precheck`)}
                >
                  <PlaySquare className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No runs yet</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    Start a precheck run to analyse this project
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {runs.slice(0, 5).map((run) => (
                    <button
                      key={run.id}
                      onClick={() => router.push(`/dashboard/projects/${projectId}/precheck`)}
                      className="w-full flex items-center gap-3 rounded-lg border border-archai-graphite bg-archai-black/40 px-3 py-2.5 hover:bg-archai-charcoal transition-colors text-left"
                    >
                      <RunStatusIcon status={run.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white truncate">
                          {run.name ?? 'Precheck Run'}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {statusLabel(run.status)} · {new Date(run.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      {run.readinessScore != null && (
                        <div className={cn(
                          'text-xs font-semibold tabular-nums shrink-0',
                          run.readinessScore >= 75 ? 'text-emerald-400' :
                          run.readinessScore >= 50 ? 'text-archai-amber' : 'text-red-400',
                        )}>
                          {run.readinessScore}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Documents shortcut */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Documents
                </p>
                <button
                  className="text-[10px] text-muted-foreground hover:text-white transition-colors"
                  onClick={() => router.push(`/dashboard/projects/${projectId}/documents`)}
                >
                  See all
                </button>
              </div>
              <div
                className="rounded-lg border border-dashed border-archai-graphite p-4 flex items-center gap-3 cursor-pointer hover:border-archai-graphite/70 transition-colors"
                onClick={() => router.push(`/dashboard/projects/${projectId}/documents`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && router.push(`/dashboard/projects/${projectId}/documents`)}
              >
                <FileText className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Manage project documents</p>
                  <p className="text-[10px] text-muted-foreground/60">Zoning codes, briefs, specs, and notes</p>
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>
      }
      rightPanel={
        <aside className="h-full">
          <RightPanel projectId={projectId} />
        </aside>
      }
    />
  )
}
