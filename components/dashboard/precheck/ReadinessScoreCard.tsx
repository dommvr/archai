'use client'

import { cn } from '@/lib/utils'

interface ReadinessScoreCardProps {
  score: number | null | undefined
  isLoading?: boolean
}

const SCORE_CONFIG = {
  high:   { label: 'Permit Ready',       color: 'text-emerald-400', border: 'border-emerald-400/20',  bg: 'bg-emerald-400/5'  },
  medium: { label: 'Issues to Resolve',  color: 'text-archai-amber', border: 'border-archai-amber/20', bg: 'bg-archai-amber/5' },
  low:    { label: 'Incomplete Input',   color: 'text-red-400',      border: 'border-red-400/20',      bg: 'bg-red-400/5'      },
  none:   { label: 'Not Yet Evaluated',  color: 'text-muted-foreground', border: 'border-archai-graphite', bg: 'bg-transparent' },
} as const

function getConfig(score: number | null | undefined) {
  if (score == null) return SCORE_CONFIG.none
  if (score >= 80)   return SCORE_CONFIG.high
  if (score >= 60)   return SCORE_CONFIG.medium
  return SCORE_CONFIG.low
}

export function ReadinessScoreCard({ score, isLoading }: ReadinessScoreCardProps) {
  const cfg = getConfig(score)

  return (
    <div className={cn('rounded-xl border p-4 flex flex-col items-center gap-1.5', cfg.border, cfg.bg)}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Permit Readiness</p>

      {isLoading ? (
        <div className="h-12 w-16 rounded bg-archai-graphite animate-pulse" />
      ) : (
        <span className={cn('text-5xl font-bold tabular-nums leading-none', cfg.color)}>
          {score != null ? score : '—'}
        </span>
      )}

      <p className={cn('text-[11px] font-medium', cfg.color)}>{cfg.label}</p>
    </div>
  )
}
