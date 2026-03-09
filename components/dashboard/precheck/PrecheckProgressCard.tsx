'use client'

import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PrecheckRunStatus } from '@/lib/precheck/constants'
import type { PrecheckRun } from '@/lib/precheck/types'

interface Step {
  status: PrecheckRunStatus
  label: string
}

const STEPS: Step[] = [
  { status: 'ingesting_site',      label: 'Site Data'        },
  { status: 'ingesting_docs',      label: 'Documents'        },
  { status: 'extracting_rules',    label: 'Rule Extraction'  },
  { status: 'syncing_model',       label: 'Speckle Model'    },
  { status: 'computing_metrics',   label: 'Metrics'          },
  { status: 'evaluating',          label: 'Compliance'       },
  { status: 'generating_report',   label: 'Report'           },
]

const STATUS_ORDER: PrecheckRunStatus[] = [
  'created', 'ingesting_site', 'ingesting_docs', 'extracting_rules',
  'syncing_model', 'computing_metrics', 'evaluating', 'generating_report',
  'completed', 'failed',
]

type StepState = 'done' | 'active' | 'idle' | 'error'

function resolveStepState(step: PrecheckRunStatus, runStatus: PrecheckRunStatus): StepState {
  if (runStatus === 'failed') {
    const runIdx = STATUS_ORDER.indexOf('evaluating') // freeze at last active step
    const stepIdx = STATUS_ORDER.indexOf(step)
    return stepIdx < runIdx ? 'done' : 'error'
  }
  const runIdx = STATUS_ORDER.indexOf(runStatus)
  const stepIdx = STATUS_ORDER.indexOf(step)
  if (stepIdx < runIdx) return 'done'
  if (stepIdx === runIdx) return 'active'
  return 'idle'
}

interface PrecheckProgressCardProps {
  run: PrecheckRun | null | undefined
  isLoading?: boolean
}

export function PrecheckProgressCard({ run, isLoading }: PrecheckProgressCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-3">
        <div className="h-4 w-28 rounded bg-archai-graphite animate-pulse" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-3 w-full rounded bg-archai-graphite animate-pulse opacity-60" />
        ))}
      </div>
    )
  }

  if (!run) {
    return (
      <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 text-center">
        <p className="text-xs text-muted-foreground">No run selected</p>
      </div>
    )
  }

  const isCompleted = run.status === 'completed'
  const isFailed    = run.status === 'failed'

  return (
    <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Progress</p>
        <span className={cn(
          'text-[10px] font-medium rounded-full px-2 py-0.5 border',
          isCompleted ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' :
          isFailed    ? 'text-red-400 border-red-400/30 bg-red-400/10' :
                        'text-archai-amber border-archai-amber/30 bg-archai-amber/10',
        )}>
          {run.status.replace(/_/g, ' ')}
        </span>
      </div>

      {isFailed && run.errorMessage && (
        <div className="flex items-start gap-2 rounded-lg bg-red-400/10 border border-red-400/20 p-2">
          <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-400">{run.errorMessage}</p>
        </div>
      )}

      <div className="space-y-1.5">
        {STEPS.map(({ status, label }) => {
          const state = resolveStepState(status, run.status)
          return (
            <div key={status} className="flex items-center gap-2">
              <div className={cn(
                'w-4 h-4 flex items-center justify-center shrink-0',
                state === 'done'   && 'text-emerald-400',
                state === 'active' && 'text-archai-amber',
                state === 'error'  && 'text-red-400',
                state === 'idle'   && 'text-muted-foreground/25',
              )}>
                {state === 'done'   && <CheckCircle2 className="h-3.5 w-3.5" />}
                {state === 'active' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {state === 'error'  && <AlertCircle className="h-3.5 w-3.5" />}
                {state === 'idle'   && <div className="h-2 w-2 rounded-full border border-current" />}
              </div>
              <span className={cn(
                'text-xs',
                state === 'done'   && 'text-white/70',
                state === 'active' && 'text-archai-amber font-medium',
                state === 'error'  && 'text-red-400',
                state === 'idle'   && 'text-muted-foreground/40',
              )}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
