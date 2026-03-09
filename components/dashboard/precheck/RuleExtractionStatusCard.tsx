'use client'

import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ExtractedRule } from '@/lib/precheck/types'
import type { RuleStatus } from '@/lib/precheck/constants'

const STATUS_COLORS: Record<RuleStatus, string> = {
  draft:    'text-archai-amber border-archai-amber/30 bg-archai-amber/10',
  reviewed: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  rejected: 'text-red-400 border-red-400/30 bg-red-400/10',
}

interface RuleExtractionStatusCardProps {
  runId:       string
  rules:       ExtractedRule[]
  canExtract:  boolean
  onExtract:   () => Promise<void>
  isLoading?:  boolean
  isExtracting?: boolean
}

export function RuleExtractionStatusCard({
  runId:       _runId,
  rules,
  canExtract,
  onExtract,
  isLoading,
  isExtracting,
}: RuleExtractionStatusCardProps) {
  const byStatus = rules.reduce<Partial<Record<RuleStatus, number>>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-archai-orange" />
          <p className="text-sm font-medium text-white">Extracted Rules</p>
        </div>
        {rules.length > 0 && (
          <span className="text-xs text-muted-foreground">{rules.length} total</span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-3 w-full rounded bg-archai-graphite animate-pulse opacity-60" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">
          No rules extracted yet. Ingest documents first.
        </p>
      ) : (
        <div className="space-y-2">
          {/* Status breakdown */}
          <div className="flex gap-1.5 flex-wrap">
            {(Object.entries(byStatus) as [RuleStatus, number][]).map(([status, count]) => (
              <span key={status} className={cn('text-[10px] font-medium rounded-full px-2 py-0.5 border', STATUS_COLORS[status])}>
                {count} {status}
              </span>
            ))}
          </div>

          {/* Rule preview list */}
          <div className="space-y-1">
            {rules.slice(0, 4).map((rule) => (
              <div key={rule.id} className="flex items-center gap-2 rounded bg-archai-black border border-archai-graphite/40 px-2 py-1.5">
                <span className="text-xs text-white truncate flex-1">{rule.title}</span>
                <span className="text-[10px] text-muted-foreground/60 shrink-0">
                  {Math.round(rule.confidence * 100)}%
                </span>
              </div>
            ))}
            {rules.length > 4 && (
              <p className="text-[10px] text-muted-foreground text-center">+{rules.length - 4} more rules</p>
            )}
          </div>
        </div>
      )}

      {canExtract && (
        <Button variant="archai" size="sm" className="w-full" onClick={onExtract} disabled={isLoading || isExtracting}>
          {isExtracting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
          {isExtracting ? 'Extracting Rules…' : 'Extract Rules via AI'}
        </Button>
      )}

      {/* LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER */}
    </div>
  )
}
