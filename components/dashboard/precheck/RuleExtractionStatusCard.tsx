'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  GitMerge,
  Loader2,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ExtractedRule } from '@/lib/precheck/types'
import type { MetricKey, RuleStatus } from '@/lib/precheck/constants'
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

// Friendly display labels for metric keys
const METRIC_LABEL: Record<MetricKey, string> = {
  building_height_m:        'Height',
  front_setback_m:          'Front Setback',
  side_setback_left_m:      'Side Setback (L)',
  side_setback_right_m:     'Side Setback (R)',
  rear_setback_m:           'Rear Setback',
  gross_floor_area_m2:      'Gross Floor Area',
  far:                      'FAR',
  lot_coverage_pct:         'Lot Coverage',
  parking_spaces_required:  'Parking',
  parking_spaces_provided:  'Parking (Provided)',
}

// Short metric labels for filter pills
const METRIC_SHORT: Record<MetricKey, string> = {
  building_height_m:        'Height',
  front_setback_m:          'Front',
  side_setback_left_m:      'Side (L)',
  side_setback_right_m:     'Side (R)',
  rear_setback_m:           'Rear',
  gross_floor_area_m2:      'GFA',
  far:                      'FAR',
  lot_coverage_pct:         'Coverage',
  parking_spaces_required:  'Parking',
  parking_spaces_provided:  'Parking+',
}

const OPERATOR_LABEL: Record<string, string> = {
  '<=': 'max',
  '>=': 'min',
  '<':  '<',
  '>':  '>',
  '=':  '=',
  'between': 'between',
}

// Leading phrases that introduce the actual subject; strip these to get a clean label
const _CONDITION_STRIP_PREFIXES = [
  'applies to ', 'applicable to ', 'for ',
  'in the case of ', 'where ', 'when ',
  'subject to ', 'permitted only if ',
  'in any ', 'in a ', 'in an ',
]

// Words that indicate the remainder is a procedural phrase, not a subject noun
const _PROCEDURAL_FIRST_WORDS = new Set([
  'calculation', 'establishment', 'use', 'building', 'structure', 'area',
  'no', 'all', 'any', 'such', 'each', 'this', 'that', 'the',
])

/**
 * Derives a short, readable scope label from a raw conditionText string.
 * Strips legal preamble and title-cases the remaining noun phrase.
 * Falls back to null when the condition is blank or purely procedural.
 */
function labelFromCondition(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = raw.trim()
  if (!s) return null

  // Strip known leading preamble (case-insensitive)
  const lower = s.toLowerCase()
  for (const prefix of _CONDITION_STRIP_PREFIXES) {
    if (lower.startsWith(prefix)) {
      s = s.slice(prefix.length).trim()
      break
    }
  }

  // If the remainder starts with a procedural/article word, the label would be
  // meaningless — skip scope and show just the metric
  const firstWord = s.split(/\s+/)[0]?.toLowerCase() ?? ''
  if (_PROCEDURAL_FIRST_WORDS.has(firstWord)) return null

  // Truncate at word boundary to 32 chars
  if (s.length > 32) {
    const cut = s.slice(0, 32).replace(/\s+\S*$/, '')
    s = cut + '…'
  }

  // Title-case the result
  return s.replace(/\b\w/g, c => c.toUpperCase())
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

// ── Derived rule grouping ────────────────────────────────────

/** A genuine conflict group: same metric + same condition + different values. */
interface ConflictGroup {
  groupId: string
  rules:   ExtractedRule[]  // sorted: recommended first, then confidence DESC
}

function buildGrouping(rules: ExtractedRule[]): {
  groups: ConflictGroup[]
  standaloneRules: ExtractedRule[]
  supersededRules: ExtractedRule[]
} {
  // Collect rules that belong to conflict groups (exclude superseded/rejected)
  const inGroup = new Map<string, ExtractedRule[]>()
  for (const rule of rules) {
    if (rule.status === 'superseded' || rule.status === 'rejected') continue
    if (rule.conflictGroupId) {
      const arr = inGroup.get(rule.conflictGroupId) ?? []
      arr.push(rule)
      inGroup.set(rule.conflictGroupId, arr)
    }
  }

  // Sort group members: recommended first, then confidence DESC
  const groups: ConflictGroup[] = []
  const groupedRuleIds = new Set<string>()

  for (const [groupId, members] of inGroup.entries()) {
    if (members.length < 2) continue
    const sorted = [...members].sort((a, b) => {
      if (a.isRecommended !== b.isRecommended) return a.isRecommended ? -1 : 1
      return b.confidence - a.confidence
    })
    groups.push({ groupId, rules: sorted })
    for (const r of sorted) groupedRuleIds.add(r.id)
  }

  // Sort groups by highest-confidence rule in the group (DESC)
  groups.sort((a, b) => {
    const maxA = Math.max(...a.rules.map(r => r.confidence))
    const maxB = Math.max(...b.rules.map(r => r.confidence))
    return maxB - maxA
  })

  // Standalone rules = active (not superseded/rejected), not in any conflict group
  const standaloneRules = rules
    .filter(r => !groupedRuleIds.has(r.id) && r.status !== 'superseded' && r.status !== 'rejected')
    .sort((a, b) => b.confidence - a.confidence)

  // Superseded rules — collected for the secondary section
  const supersededRules = rules
    .filter(r => r.status === 'superseded')
    .sort((a, b) => {
      // Sort by metric then confidence DESC so related rules are grouped visually
      if (a.metricKey < b.metricKey) return -1
      if (a.metricKey > b.metricKey) return 1
      return b.confidence - a.confidence
    })

  return { groups, standaloneRules, supersededRules }
}

// ── Rule search helper ───────────────────────────────────────

function ruleMatchesSearch(rule: ExtractedRule, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    rule.title.toLowerCase().includes(needle) ||
    (rule.conditionText ?? '').toLowerCase().includes(needle) ||
    (rule.units ?? '').toLowerCase().includes(needle) ||
    (METRIC_LABEL[rule.metricKey as MetricKey] ?? '').toLowerCase().includes(needle)
  )
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
  const [pendingId, setPendingId]     = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [metricFilter, setMetricFilter] = useState<MetricKey | 'all'>('all')
  const [showSuperseded, setShowSuperseded] = useState(false)
  const [showLowConf, setShowLowConf]       = useState(false)

  const { groups, standaloneRules, supersededRules } = useMemo(
    () => buildGrouping(rules),
    [rules],
  )

  const conflictCount = groups.length

  const byStatus = rules.reduce<Partial<Record<RuleStatus, number>>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  const authoritative = rules.filter((r) => AUTHORITATIVE_RULE_STATUSES.has(r.status))
  const pending = rules.filter((r) => r.status === 'draft' && !r.isAuthoritative)

  // Metric pills — only show metrics that actually have active (non-superseded) rules
  const activeRulesForPills = [...groups.flatMap(g => g.rules), ...standaloneRules]
  const metricsWithRules = useMemo(() => {
    const counts = new Map<MetricKey, number>()
    for (const r of activeRulesForPills) {
      counts.set(r.metricKey as MetricKey, (counts.get(r.metricKey as MetricKey) ?? 0) + 1)
    }
    return counts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules])

  // Apply search + metric filter to standalone rules
  const filteredStandalone = standaloneRules.filter(r => {
    if (metricFilter !== 'all' && r.metricKey !== metricFilter) return false
    return ruleMatchesSearch(r, searchQuery)
  })

  // Apply search + metric filter to conflict groups
  const filteredGroups = groups.filter(g => {
    if (metricFilter !== 'all' && g.rules[0]?.metricKey !== metricFilter) return false
    if (searchQuery) {
      return g.rules.some(r => ruleMatchesSearch(r, searchQuery))
    }
    return true
  })

  // Low-confidence rules (< 25%) in filtered standalone
  const LOW_CONF = 0.25
  const activeStandalone  = filteredStandalone.filter(r => r.confidence >= LOW_CONF)
  const lowConfStandalone = filteredStandalone.filter(r => r.confidence <  LOW_CONF)

  // Group active standalone rules by metric for section headers
  const standaloneByMetric = useMemo(() => {
    const map = new Map<MetricKey, ExtractedRule[]>()
    for (const r of activeStandalone) {
      const mk = r.metricKey as MetricKey
      const arr = map.get(mk) ?? []
      arr.push(r)
      map.set(mk, arr)
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStandalone])

  async function handleApprove(ruleId: string) {
    if (!onApprove || pendingId) return
    setPendingId(ruleId)
    try { await onApprove(ruleId) } finally { setPendingId(null) }
  }

  async function handleReject(ruleId: string) {
    if (!onReject || pendingId) return
    setPendingId(ruleId)
    try { await onReject(ruleId) } finally { setPendingId(null) }
  }

  const hasActiveContent = filteredGroups.length > 0 || activeStandalone.length > 0

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

          {/* ── Search + metric filter ── */}
          <div className="space-y-2">
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search rules…"
                className="w-full pl-6 pr-2 py-1 text-[11px] bg-archai-black border border-archai-graphite/60 rounded text-white placeholder:text-muted-foreground/40 focus:outline-none focus:border-archai-amber/40 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-white transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Metric filter pills — only shown when there are multiple metrics */}
            {metricsWithRules.size > 1 && (
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setMetricFilter('all')}
                  className={cn(
                    'text-[9px] rounded px-1.5 py-0.5 border transition-colors',
                    metricFilter === 'all'
                      ? 'border-archai-orange/60 bg-archai-orange/10 text-archai-orange'
                      : 'border-archai-graphite/50 text-muted-foreground hover:text-white hover:border-archai-graphite',
                  )}
                >
                  All ({activeRulesForPills.length})
                </button>
                {Array.from(metricsWithRules.entries()).map(([mk, count]) => (
                  <button
                    key={mk}
                    onClick={() => setMetricFilter(metricFilter === mk ? 'all' : mk)}
                    className={cn(
                      'text-[9px] rounded px-1.5 py-0.5 border transition-colors',
                      metricFilter === mk
                        ? 'border-archai-orange/60 bg-archai-orange/10 text-archai-orange'
                        : 'border-archai-graphite/50 text-muted-foreground hover:text-white hover:border-archai-graphite',
                    )}
                  >
                    {METRIC_SHORT[mk] ?? mk} ({count})
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Main content ── */}
          {!hasActiveContent && (searchQuery || metricFilter !== 'all') ? (
            <p className="text-[11px] text-muted-foreground text-center py-3">
              No rules match your search.
            </p>
          ) : (
            <div className="space-y-3">
              {/* Conflict groups first */}
              {filteredGroups.length > 0 && (
                <div className="space-y-2">
                  {filteredGroups.map(group => (
                    <ConflictGroupBlock
                      key={group.groupId}
                      group={group}
                      pendingId={pendingId}
                      onApprove={onApprove ? handleApprove : undefined}
                      onReject={onReject ? handleReject : undefined}
                    />
                  ))}
                </div>
              )}

              {/* Standalone draft rules — metric sections when "All" selected */}
              {activeStandalone.length > 0 && (
                <div className="space-y-3">
                  {metricFilter === 'all' && standaloneByMetric.size > 1 ? (
                    // Show with metric section headers
                    Array.from(standaloneByMetric.entries()).map(([mk, sRules]) => (
                      <MetricSection
                        key={mk}
                        metricKey={mk}
                        rules={sRules}
                        pendingId={pendingId}
                        onApprove={onApprove ? handleApprove : undefined}
                        onReject={onReject ? handleReject : undefined}
                      />
                    ))
                  ) : (
                    // Single metric filtered — flat list, no section header needed
                    <div className="space-y-1.5">
                      {activeStandalone.map(rule => (
                        <RuleRow
                          key={rule.id}
                          rule={rule}
                          isPending={pendingId === rule.id}
                          onApprove={onApprove ? handleApprove : undefined}
                          onReject={onReject ? handleReject : undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Low-confidence rules (collapsed by default) */}
              {lowConfStandalone.length > 0 && (
                <div className="border-t border-archai-graphite/40 pt-2 space-y-1.5">
                  <button
                    onClick={() => setShowLowConf(v => !v)}
                    className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors w-full"
                  >
                    {showLowConf ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {lowConfStandalone.length} low-confidence rule{lowConfStandalone.length > 1 ? 's' : ''} (under 25%)
                  </button>
                  {showLowConf && (
                    <div className="space-y-1.5 opacity-60">
                      {lowConfStandalone.map(rule => (
                        <RuleRow
                          key={rule.id}
                          rule={rule}
                          isPending={pendingId === rule.id}
                          onApprove={onApprove ? handleApprove : undefined}
                          onReject={onReject ? handleReject : undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Superseded rules — bottom section, collapsed by default */}
              {supersededRules.length > 0 && (
                <div className="border-t border-archai-graphite/40 pt-2 space-y-1.5">
                  <button
                    onClick={() => setShowSuperseded(v => !v)}
                    className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors w-full"
                  >
                    {showSuperseded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {supersededRules.length} superseded rule{supersededRules.length > 1 ? 's' : ''} (deduplicated)
                  </button>
                  {showSuperseded && (
                    <div className="space-y-1.5 opacity-40">
                      {supersededRules.map(rule => (
                        <RuleRow
                          key={rule.id}
                          rule={rule}
                          isPending={false}
                          // No approve/reject on superseded rules
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
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

// ── Metric section (standalone rules under a metric header) ──

interface MetricSectionProps {
  metricKey: MetricKey
  rules:     ExtractedRule[]
  pendingId: string | null
  onApprove?: (id: string) => void
  onReject?:  (id: string) => void
}

const SECTION_PAGE_SIZE = 5

function MetricSection({ metricKey, rules, pendingId, onApprove, onReject }: MetricSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const label   = METRIC_LABEL[metricKey] ?? metricKey
  const visible = expanded ? rules : rules.slice(0, SECTION_PAGE_SIZE)

  return (
    <div className="space-y-1.5">
      {/* Metric section label */}
      <p className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider px-0.5">
        {label} · {rules.length}
      </p>
      <div className="space-y-1.5">
        {visible.map(rule => (
          <RuleRow
            key={rule.id}
            rule={rule}
            isPending={pendingId === rule.id}
            onApprove={onApprove}
            onReject={onReject}
          />
        ))}
      </div>
      {rules.length > SECTION_PAGE_SIZE && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors pl-0.5"
        >
          {expanded
            ? <><ChevronUp className="h-3 w-3" /> Show less</>
            : <><ChevronDown className="h-3 w-3" /> {rules.length - SECTION_PAGE_SIZE} more {label.toLowerCase()} rules</>
          }
        </button>
      )}
    </div>
  )
}

// ── Conflict group block ──────────────────────────────────────

interface ConflictGroupBlockProps {
  group:     ConflictGroup
  pendingId: string | null
  onApprove?: (id: string) => void
  onReject?:  (id: string) => void
}

function ConflictGroupBlock({ group, pendingId, onApprove, onReject }: ConflictGroupBlockProps) {
  const [collapsed, setCollapsed] = useState(false)
  const representative = group.rules.find(r => r.isRecommended) ?? group.rules[0]
  const metric = METRIC_LABEL[representative.metricKey as MetricKey] ?? representative.metricKey

  // Use the clean label helper — falls back to null for procedural conditions
  const scope = labelFromCondition(representative.conditionText)

  return (
    <div className="rounded-lg border border-archai-amber/30 bg-archai-amber/5 overflow-hidden">
      {/* Group header */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-archai-amber/10 transition-colors"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <GitMerge className="h-3 w-3 text-archai-amber shrink-0" />
          <span className="text-[10px] font-medium text-archai-amber truncate">
            {metric}{scope ? ` / ${scope}` : ''} · {group.rules.length} alternatives
          </span>
        </div>
        {collapsed
          ? <ChevronDown className="h-3 w-3 text-archai-amber shrink-0" />
          : <ChevronUp className="h-3 w-3 text-archai-amber shrink-0" />
        }
      </button>

      {/* Group members */}
      {!collapsed && (
        <div className="px-2 pb-2 space-y-1.5 pt-0.5">
          {group.rules.map(rule => (
            <RuleRow
              key={rule.id}
              rule={rule}
              isPending={pendingId === rule.id}
              onApprove={onApprove}
              onReject={onReject}
              inConflictGroup
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Rule row ─────────────────────────────────────────────────

interface RuleRowProps {
  rule:            ExtractedRule
  isPending:       boolean
  onApprove?:      (id: string) => void
  onReject?:       (id: string) => void
  inConflictGroup?: boolean
}

function formatValue(rule: ExtractedRule): string {
  const op   = OPERATOR_LABEL[rule.operator] ?? rule.operator
  const unit = rule.units ? ` ${rule.units}` : ''
  if (rule.operator === 'between' && rule.valueMin != null && rule.valueMax != null) {
    return `${op} ${rule.valueMin}–${rule.valueMax}${unit}`
  }
  if (rule.valueNumber != null) {
    return `${op} ${rule.valueNumber}${unit}`
  }
  return ''
}

function RuleRow({ rule, isPending, onApprove, onReject, inConflictGroup }: RuleRowProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const isAuthoritative = AUTHORITATIVE_RULE_STATUSES.has(rule.status)
  const isRejected   = rule.status === 'rejected'
  const isSuperseded = rule.status === 'superseded'
  const isDraft      = rule.status === 'draft'
  const metricLabel  = METRIC_LABEL[rule.metricKey as MetricKey] ?? rule.metricKey
  const valueStr     = formatValue(rule)

  return (
    <div className={cn(
      'rounded-lg border overflow-hidden transition-colors',
      isAuthoritative  ? 'border-emerald-400/20 bg-emerald-400/5' :
      isRejected       ? 'border-red-400/15 bg-red-400/5 opacity-60' :
      isSuperseded     ? 'border-archai-graphite/30 bg-archai-black/50' :
      inConflictGroup  ? 'border-archai-graphite/50 bg-archai-black' :
      rule.conflictGroupId ? 'border-archai-amber/25 bg-archai-amber/5' :
                         'border-archai-graphite/60 bg-archai-black',
    )}>
      {/* Clickable card header */}
      <button
        className="w-full text-left px-2.5 py-2 space-y-1 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={() => setDetailOpen(v => !v)}
      >
        {/* Row 1: title + recommended badge */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={cn('text-xs font-medium', isRejected || isSuperseded ? 'text-muted-foreground' : 'text-white')}>
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

            {/* Row 2: metric · value · confidence · status */}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {metricLabel && (
                <span className="text-[10px] text-sky-400/80 font-medium">
                  {metricLabel}
                </span>
              )}
              {valueStr && (
                <span className="text-[10px] text-white/70 font-mono">
                  {valueStr}
                </span>
              )}
              <span className={cn('text-[10px] font-medium rounded-full px-1.5 py-0.5 border', STATUS_BADGE[rule.status])}>
                {STATUS_LABEL[rule.status]}
              </span>
              {rule.sourceKind !== 'manual' && (
                <span className="text-[10px] text-muted-foreground/60">
                  {Math.round(rule.confidence * 100)}%
                </span>
              )}
            </div>
          </div>

          {/* Approve / reject — only for active draft extracted rules */}
          {isDraft && rule.sourceKind === 'extracted' && (
            <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
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
      </button>

      {/* Expanded detail panel */}
      {detailOpen && (
        <div className="px-2.5 pb-2.5 pt-0 border-t border-archai-graphite/30 space-y-2 mt-0">
          {/* Full metric + value */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2">
            <DetailRow label="Metric" value={metricLabel} />
            <DetailRow label="Value"  value={valueStr || '—'} mono />
            {rule.units && <DetailRow label="Unit" value={rule.units} />}
            <DetailRow label="Confidence" value={`${Math.round(rule.confidence * 100)}%`} />
            {rule.normalizationNote && <DetailRow label="Normalised" value={rule.normalizationNote} full />}
          </div>

          {/* Description */}
          {rule.description && (
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Description</p>
              <p className="text-[10px] text-muted-foreground/80 leading-snug">{rule.description}</p>
            </div>
          )}

          {/* Condition / exception */}
          {rule.conditionText && (
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Condition</p>
              <p className="text-[10px] text-muted-foreground/80 leading-snug">{rule.conditionText}</p>
            </div>
          )}
          {rule.exceptionText && (
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Exception</p>
              <p className="text-[10px] text-muted-foreground/80 leading-snug">{rule.exceptionText}</p>
            </div>
          )}

          {/* Citation */}
          {rule.citation?.snippet && (
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">
                Source{rule.citation.section ? ` — §${rule.citation.section}` : ''}
                {rule.citation.page ? ` · p.${rule.citation.page}` : ''}
              </p>
              <blockquote className="text-[10px] text-muted-foreground/70 border-l-2 border-archai-graphite pl-2 leading-snug italic line-clamp-4">
                {rule.citation.snippet}
              </blockquote>
            </div>
          )}

          {/* Conflict / recommendation info */}
          {rule.conflictGroupId && (
            <p className="text-[9px] text-archai-amber/70">
              {rule.isRecommended ? 'Recommended choice in conflict group.' : 'Part of a conflict group — see alternatives above.'}
            </p>
          )}

          {/* Superseded note */}
          {isSuperseded && (
            <p className="text-[9px] text-muted-foreground/50">
              Deduplicated — a higher-confidence copy of this rule is active.
            </p>
          )}

          {/* Rule code */}
          {rule.ruleCode && (
            <p className="text-[9px] text-muted-foreground/40 font-mono">{rule.ruleCode}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Detail row helper ─────────────────────────────────────────

function DetailRow({ label, value, mono, full }: { label: string; value: string; mono?: boolean; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={cn('text-[10px] text-white/80 leading-snug', mono && 'font-mono')}>{value}</p>
    </div>
  )
}
