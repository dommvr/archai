'use client'

import { cn } from '@/lib/utils'
import type { ReadinessBreakdown } from '@/lib/precheck/types'

interface ReadinessScoreCardProps {
  score: number | null | undefined
  readinessBreakdown?: ReadinessBreakdown | null
  isLoading?: boolean
}

// Visual config keyed by the authoritative backend label.
// The label must come from readinessBreakdown.label when available —
// never derived solely from the numeric score, because a score ≥80 can
// still be ISSUES_TO_RESOLVE when blocking issues exist.
const LABEL_CONFIG: Record<string, { label: string; color: string; border: string; bg: string }> = {
  permit_ready:      { label: 'Permit Ready',      color: 'text-emerald-400',       border: 'border-emerald-400/20',  bg: 'bg-emerald-400/5'  },
  issues_to_resolve: { label: 'Issues to Resolve', color: 'text-archai-amber',       border: 'border-archai-amber/20', bg: 'bg-archai-amber/5' },
  incomplete_input:  { label: 'Incomplete Input',  color: 'text-red-400',            border: 'border-red-400/20',      bg: 'bg-red-400/5'      },
  not_yet_evaluated: { label: 'Not Yet Evaluated', color: 'text-muted-foreground',   border: 'border-archai-graphite', bg: 'bg-transparent'    },
}

// Fallback when no breakdown is available — derive from score only.
function fallbackLabelKey(score: number | null | undefined): string {
  if (score == null) return 'not_yet_evaluated'
  if (score >= 80)   return 'permit_ready'
  if (score >= 60)   return 'issues_to_resolve'
  return 'incomplete_input'
}

export function ReadinessScoreCard({ score, readinessBreakdown, isLoading }: ReadinessScoreCardProps) {
  const labelKey = readinessBreakdown?.label ?? fallbackLabelKey(score)
  const cfg = LABEL_CONFIG[labelKey] ?? LABEL_CONFIG.not_yet_evaluated
  const displayScore = readinessBreakdown?.score ?? score

  // Show reasons from breakdown when available — blocking items first
  const reasons = readinessBreakdown?.reasons ?? []
  const blockingReasons = reasons.filter(r => r.isBlocking)
  const otherReasons = reasons.filter(r => !r.isBlocking && r.delta < 0)

  return (
    <div className={cn('rounded-xl border p-4 flex flex-col gap-2', cfg.border, cfg.bg)}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider text-center">Permit Readiness</p>

      {isLoading ? (
        <div className="h-12 w-16 rounded bg-archai-graphite animate-pulse mx-auto" />
      ) : (
        <div className="flex flex-col items-center gap-1">
          <span className={cn('text-5xl font-bold tabular-nums leading-none', cfg.color)}>
            {displayScore != null ? displayScore : '—'}
          </span>
          <p className={cn('text-[11px] font-medium', cfg.color)}>{cfg.label}</p>
        </div>
      )}

      {/* Score reasons — only shown when breakdown is available and evaluation has run */}
      {!isLoading && reasons.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5 border-t border-archai-graphite pt-2">
          {blockingReasons.map(r => (
            <div key={r.key} className="flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0 text-red-400 text-[10px]">●</span>
              <span className="text-[11px] text-red-300 leading-tight">{r.label}</span>
            </div>
          ))}
          {otherReasons.map(r => (
            <div key={r.key} className="flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0 text-muted-foreground text-[10px]">·</span>
              <span className="text-[11px] text-muted-foreground leading-tight">
                {r.label}
                {r.delta !== 0 && (
                  <span className="ml-1 text-red-400/70">{r.delta}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
