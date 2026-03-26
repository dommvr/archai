'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ExtractedRule } from '@/lib/precheck/types'
import type { RuleStatus } from '@/lib/precheck/constants'
import { AUTHORITATIVE_RULE_STATUSES } from '@/lib/precheck/constants'

// ── Style maps ───────────────────────────────────────────────

const STATUS_BADGE: Record<RuleStatus, string> = {
  draft:        'text-archai-amber  border-archai-amber/30  bg-archai-amber/10',
  reviewed:     'text-emerald-400   border-emerald-400/30   bg-emerald-400/10',
  approved:     'text-emerald-400   border-emerald-400/30   bg-emerald-400/10',
  auto_approved:'text-sky-400       border-sky-400/30       bg-sky-400/10',
  superseded:   'text-muted-foreground border-muted-foreground/20 bg-muted-foreground/5',
  rejected:     'text-red-400       border-red-400/30       bg-red-400/10',
}

const STATUS_LABEL: Record<RuleStatus, string> = {
  draft:        'Draft',
  reviewed:     'Reviewed',
  approved:     'Approved',
  auto_approved:'Auto-approved',
  superseded:   'Superseded',
  rejected:     'Rejected',
}

// ── Types ────────────────────────────────────────────────────

interface RuleExtractionStatusCardProps {
  runId:           string
  rules:           ExtractedRule[]
  canExtract:      boolean
  onExtract:       () => Promise<void>
  onApprove?:      (ruleId: string) => Promise<void>
  onReject?:       (ruleId: string) => Promise<void>
  onAddManual?:    () => void
  isLoading?:      boolean
  isExtracting?:   boolean
}

// ── Component ────────────────────────────────────────────────

export function RuleExtractionStatusCard({
  runId: _runId,
  rules,
  canExtract,
  onExtract,
  onApprove,
  onReject,
  onAddManual,
  isLoading,
  isExtracting,
}: RuleExtractionStatusCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)

  // Group by conflict
  const conflictGroups = new Map<string, ExtractedRule[]>()
  for (const rule of rules) {
    if (rule.conflictGroupId) {
      const group = conflictGroups.get(rule.conflictGroupId) ?? []
      group.push(rule)
      conflictGroups.set(rule.conflictGroupId, group)
    }
  }
  const conflictCount = conflictGroups.size

  const byStatus = rules.reduce<Partial<Record<RuleStatus, number>>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  const authoritative = rules.filter((r) => AUTHORITATIVE_RULE_STATUSES.has(r.status))
  const pending = rules.filter((r) => r.status === 'draft' && !r.isAuthoritative)
  const visibleRules = expanded ? rules : rules.slice(0, 5)

  async function handleApprove(ruleId: string) {
    if (!onApprove || pendingId) return
    setPendingId(ruleId)
    try {
      await onApprove(ruleId)
    } finally {
      setPendingId(null)
    }
  }

  async function handleReject(ruleId: string) {
    if (!onReject || pendingId) return
    setPendingId(ruleId)
    try {
      await onReject(ruleId)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-archai-orange" />
          <p className="text-sm font-medium text-white">Code Rules</p>
        </div>
        <div className="flex items-center gap-2">
          {rules.length > 0 && (
            <span className="text-xs text-muted-foreground">{rules.length} total</span>
          )}
          {onAddManual && (
            <button
              onClick={onAddManual}
              className="flex items-center gap-1 text-[11px] text-archai-orange hover:text-archai-amber transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          )}
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-[10px] text-muted-foreground leading-snug border-l-2 border-archai-amber/40 pl-2">
        AI-extracted rules are advisory until approved. Only approved and manual rules drive compliance results.
      </p>

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
        <div className="space-y-3">
          {/* Status summary */}
          <div className="flex gap-1.5 flex-wrap">
            {(Object.entries(byStatus) as [RuleStatus, number][]).map(([status, count]) => (
              <span key={status} className={cn('text-[10px] font-medium rounded-full px-2 py-0.5 border', STATUS_BADGE[status])}>
                {count} {STATUS_LABEL[status]}
              </span>
            ))}
          </div>

          {/* Conflict banner */}
          {conflictCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-archai-amber/40 bg-archai-amber/5 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-archai-amber mt-0.5 shrink-0" />
              <p className="text-[11px] text-archai-amber leading-snug">
                {conflictCount} conflict group{conflictCount > 1 ? 's' : ''} detected.{' '}
                Recommended rules are marked — approve one per group.
              </p>
            </div>
          )}

          {/* Authoritative count */}
          {authoritative.length > 0 && (
            <p className="text-[10px] text-emerald-400">
              {authoritative.length} rule{authoritative.length > 1 ? 's' : ''} authoritative ·{' '}
              {pending.length} pending review
            </p>
          )}

          {/* Rule rows */}
          <div className="space-y-1.5">
            {visibleRules
              .filter((r) => r.status !== 'superseded')
              .map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  isPending={pendingId === rule.id}
                  onApprove={onApprove ? handleApprove : undefined}
                  onReject={onReject ? handleReject : undefined}
                />
              ))}
          </div>

          {rules.length > 5 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-white transition-colors w-full justify-center pt-1"
            >
              {expanded ? (
                <><ChevronUp className="h-3 w-3" /> Show less</>
              ) : (
                <><ChevronDown className="h-3 w-3" /> Show {rules.length - 5} more</>
              )}
            </button>
          )}
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

// ── Rule row ─────────────────────────────────────────────────

interface RuleRowProps {
  rule:       ExtractedRule
  isPending:  boolean
  onApprove?: (id: string) => void
  onReject?:  (id: string) => void
}

function RuleRow({ rule, isPending, onApprove, onReject }: RuleRowProps) {
  const [showSource, setShowSource] = useState(false)
  const isAuthoritative = AUTHORITATIVE_RULE_STATUSES.has(rule.status)
  const isRejected = rule.status === 'rejected'
  const isDraft = rule.status === 'draft'

  return (
    <div className={cn(
      'rounded-lg border px-2.5 py-2 space-y-1.5 transition-colors',
      isAuthoritative ? 'border-emerald-400/20 bg-emerald-400/5' :
      isRejected       ? 'border-red-400/15 bg-red-400/5 opacity-60' :
      rule.conflictGroupId ? 'border-archai-amber/25 bg-archai-amber/5' :
                         'border-archai-graphite/60 bg-archai-black',
    )}>
      {/* Top row: title + confidence + status */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn('text-xs font-medium truncate', isRejected ? 'text-muted-foreground' : 'text-white')}>
              {rule.title}
            </span>
            {rule.isRecommended && rule.conflictGroupId && (
              <span className="text-[9px] bg-archai-amber/20 text-archai-amber border border-archai-amber/30 rounded px-1 py-0.5 shrink-0">
                recommended
              </span>
            )}
            {rule.sourceKind === 'manual' && (
              <span className="text-[9px] bg-archai-graphite text-muted-foreground border border-archai-graphite/60 rounded px-1 py-0.5 shrink-0">
                manual
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={cn('text-[10px] font-medium rounded-full px-1.5 py-0.5 border', STATUS_BADGE[rule.status])}>
              {STATUS_LABEL[rule.status]}
            </span>
            {rule.sourceKind !== 'manual' && (
              <span className="text-[10px] text-muted-foreground/60">
                {Math.round(rule.confidence * 100)}% confidence
              </span>
            )}
            {rule.normalizationNote && (
              <span className="text-[10px] text-sky-400/70 truncate max-w-[140px]" title={rule.normalizationNote}>
                {rule.normalizationNote}
              </span>
            )}
          </div>
        </div>

        {/* Approve / reject — only for draft extracted rules */}
        {isDraft && rule.sourceKind === 'extracted' && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => onApprove?.(rule.id)}
              disabled={isPending}
              title="Approve rule"
              className="flex h-6 w-6 items-center justify-center rounded border border-emerald-400/30 bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20 disabled:opacity-40 transition-colors"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            </button>
            <button
              onClick={() => onReject?.(rule.id)}
              disabled={isPending}
              title="Reject rule"
              className="flex h-6 w-6 items-center justify-center rounded border border-red-400/30 bg-red-400/10 text-red-400 hover:bg-red-400/20 disabled:opacity-40 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Source preview toggle */}
      {rule.citation?.snippet && (
        <div>
          <button
            onClick={() => setShowSource((v) => !v)}
            className="text-[10px] text-muted-foreground hover:text-white transition-colors"
          >
            {showSource ? 'Hide source ▲' : 'View source ▼'}
          </button>
          {showSource && (
            <blockquote className="mt-1 text-[10px] text-muted-foreground/80 border-l-2 border-archai-graphite pl-2 leading-snug italic line-clamp-4">
              {rule.citation.section && (
                <span className="not-italic text-muted-foreground font-medium mr-1">
                  §{rule.citation.section}
                </span>
              )}
              {rule.citation.snippet}
            </blockquote>
          )}
        </div>
      )}

      {/* Condition / exception text */}
      {rule.conditionText && (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          <span className="text-muted-foreground font-medium">Condition: </span>
          {rule.conditionText}
        </p>
      )}
      {rule.exceptionText && (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          <span className="text-muted-foreground font-medium">Exception: </span>
          {rule.exceptionText}
        </p>
      )}
    </div>
  )
}
