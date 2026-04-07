'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight, Download, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import * as precheckApi from '@/lib/precheck/api'
import type { RunReportData, ComplianceResultRow } from '@/lib/precheck/types'

// ── Status filter types ───────────────────────────────────────────────────────

type StatusFilter = 'all' | 'pass' | 'fail' | 'warning' | 'not_evaluable'

const FILTER_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'all',           label: 'All' },
  { id: 'fail',          label: 'Failed' },
  { id: 'warning',       label: 'Warning' },
  { id: 'not_evaluable', label: 'Not evaluable' },
  { id: 'pass',          label: 'Passed' },
]

// ── Status display config ─────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pass:          { label: 'Pass',          color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  fail:          { label: 'Fail',          color: 'text-red-400',     bg: 'bg-red-400/10'     },
  ambiguous:     { label: 'Warning',       color: 'text-archai-amber', bg: 'bg-archai-amber/10'},
  missing_input: { label: 'Not evaluable', color: 'text-muted-foreground', bg: 'bg-archai-graphite/60' },
  not_applicable:{ label: 'N/A',           color: 'text-muted-foreground', bg: 'bg-archai-graphite/40' },
}

function statusFilter(row: ComplianceResultRow, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'pass') return row.status === 'pass'
  if (filter === 'fail') return row.status === 'fail'
  if (filter === 'warning') return row.status === 'ambiguous'
  if (filter === 'not_evaluable') return row.status === 'missing_input'
  return true
}

function fmtValue(value: number | null | undefined, units: string | null | undefined): string {
  if (value == null) return '—'
  const s = String(Number.isInteger(value) ? value : value.toFixed(2)).replace(/\.?0+$/, '')
  return units ? `${s} ${units}` : s
}

function fmtRequired(row: ComplianceResultRow): string {
  if (row.expectedMin != null && row.expectedMax != null) {
    const range = `${row.expectedMin}–${row.expectedMax}`
    return row.units ? `${range} ${row.units}` : range
  }
  if (row.expectedValue != null) {
    const v = String(row.expectedValue)
    return row.units ? `${v} ${row.units}` : v
  }
  return '—'
}

// ── Summary count pills ───────────────────────────────────────────────────────

interface CountPillProps {
  label: string
  count: number
  color: string
  bg: string
  active?: boolean
  onClick?: () => void
}

function CountPill({ label, count, color, bg, active, onClick }: CountPillProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-0.5 rounded-lg border px-3 py-2 transition-colors',
        active
          ? 'border-archai-orange/40 bg-archai-orange/5'
          : 'border-archai-graphite hover:border-archai-smoke',
        bg,
      )}
    >
      <span className={cn('text-xl font-bold tabular-nums leading-none', color)}>{count}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </button>
  )
}

// ── Result row ────────────────────────────────────────────────────────────────

function ResultRow({ row }: { row: ComplianceResultRow }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.not_applicable
  const title = row.ruleTitle || row.metricLabel || row.metricKey || '—'

  return (
    <div className="border-b border-archai-graphite last:border-b-0">
      {/* Collapsed header row — click to expand */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-3 py-2.5 hover:bg-archai-graphite/20 transition-colors"
      >
        {/* Top line: chevron + title + badges */}
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0 text-muted-foreground/50">
            {expanded
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />}
          </span>
          <div className="flex-1 min-w-0 space-y-1">
            {/* Title + status on same row, badges wrap below if needed */}
            <div className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-medium text-white leading-snug break-words min-w-0">
                {title}
              </span>
              <span className={cn('text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 whitespace-nowrap', cfg.color, cfg.bg)}>
                {cfg.label}
              </span>
            </div>
            {/* Measured / Required inline — wraps gracefully on small widths */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="text-[10px] text-muted-foreground">
                Measured: <span className="font-mono text-white">{fmtValue(row.actualValue, row.units)}</span>
              </span>
              <span className="text-[10px] text-muted-foreground">
                Required: <span className="font-mono text-white">{fmtRequired(row)}</span>
              </span>
              {row.sourceKind === 'manual' && (
                <span className="text-[9px] rounded bg-archai-graphite px-1 py-0.5 text-muted-foreground">manual</span>
              )}
              {row.citationSection && (
                <span className="text-[9px] text-muted-foreground/60">§{row.citationSection}</span>
              )}
            </div>
            {/* Explanation always visible (2 lines collapsed) */}
            {row.explanation && !expanded && (
              <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2 break-words">
                {row.explanation}
              </p>
            )}
          </div>
        </div>
      </button>

      {/* Expanded detail panel — mirrors the detail view in RuleExtractionStatusCard */}
      {expanded && (
        <div className="pl-7 pr-3 pb-3 space-y-2 border-t border-archai-graphite/40 bg-archai-black/40">
          {/* Explanation — full */}
          {row.explanation && (
            <div className="pt-2">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Explanation</p>
              <p className="text-[10px] text-muted-foreground/80 leading-snug break-words">{row.explanation}</p>
            </div>
          )}

          {/* Description */}
          {row.description && (
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Description</p>
              <p className="text-[10px] text-muted-foreground/80 leading-snug break-words">{row.description}</p>
            </div>
          )}

          {/* Metric / value grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {row.metricLabel && (
              <ResultDetailCell label="Metric" value={row.metricLabel} />
            )}
            <ResultDetailCell label="Status" value={cfg.label} />
            <ResultDetailCell label="Measured" value={fmtValue(row.actualValue, row.units)} mono />
            <ResultDetailCell label="Required" value={fmtRequired(row)} mono />
            {row.units && <ResultDetailCell label="Unit" value={row.units} />}
            {row.sourceKind && (
              <ResultDetailCell label="Source" value={row.sourceKind === 'manual' ? 'Manual entry' : 'Extracted'} />
            )}
            {row.ruleCode && (
              <ResultDetailCell label="Rule code" value={row.ruleCode} mono />
            )}
          </div>

          {/* Condition / Exception */}
          {row.conditionText && (
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Condition</p>
              <p className="text-[10px] text-muted-foreground/80 leading-snug break-words">{row.conditionText}</p>
            </div>
          )}
          {row.exceptionText && (
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Exception</p>
              <p className="text-[10px] text-muted-foreground/80 leading-snug break-words">{row.exceptionText}</p>
            </div>
          )}

          {/* Normalization note */}
          {row.normalizationNote && (
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Normalisation</p>
              <p className="text-[10px] text-muted-foreground/80 leading-snug break-words">{row.normalizationNote}</p>
            </div>
          )}

          {/* Citation */}
          {(row.citationSection || row.citationPage != null || row.citationSnippet) && (
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">
                Source
                {row.citationSection && <span> — §{row.citationSection}</span>}
                {row.citationPage != null && <span> · p.{row.citationPage}</span>}
              </p>
              {row.citationSnippet && (
                <blockquote className="text-[10px] text-muted-foreground/70 border-l-2 border-archai-graphite pl-2 leading-snug italic line-clamp-4 break-words">
                  {row.citationSnippet}
                </blockquote>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultDetailCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={cn('text-[10px] text-white/80 leading-snug break-words', mono && 'font-mono')}>{value}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface ComplianceSummaryTabProps {
  runId: string | null
  runName?: string | null
  isStale?: boolean
  /** Whether a completed compliance run exists (controls download button state). */
  hasCompletedRun: boolean
}

export function ComplianceSummaryTab({
  runId,
  runName,
  isStale,
  hasCompletedRun,
}: ComplianceSummaryTabProps) {
  const [reportData, setReportData] = useState<RunReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('all')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const fetchReportData = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await precheckApi.getRunReportData(id)
      setReportData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load compliance summary')
      setReportData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!runId) {
      setReportData(null)
      return
    }
    void fetchReportData(runId)
  }, [runId, fetchReportData])

  async function handleDownload() {
    if (!runId) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const filename = reportData?.runName || runName || `run-${runId.slice(0, 8)}`
      await precheckApi.downloadRunReportPdf(runId, filename)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  // ── Empty / no run ────────────────────────────────────────────────────────
  if (!runId) {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="text-[11px] text-muted-foreground">No run selected.</p>
      </div>
    )
  }

  if (!hasCompletedRun && !loading && !reportData) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <p className="text-[11px] text-muted-foreground leading-snug">
          Run compliance check first to see the summary.
        </p>
      </div>
    )
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-3 px-4 py-4" aria-busy="true">
        <div className="grid grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 rounded-lg border border-archai-graphite bg-archai-graphite/40 animate-pulse" />
          ))}
        </div>
        <div className="h-3 w-24 rounded bg-archai-graphite animate-pulse" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded bg-archai-graphite/40 animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-4">
        <p className="text-[11px] text-red-400">{error}</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 text-xs"
          onClick={() => runId && void fetchReportData(runId)}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (!reportData) return null

  const cs = reportData.complianceSummary
  const filteredRows = reportData.complianceResults.filter((r) => statusFilter(r, activeFilter))

  return (
    <div className="flex flex-col gap-3">
      {/* Stale warning */}
      {(isStale || reportData.isStale) && (
        <div className="flex items-start gap-2 rounded-lg border border-archai-amber/40 bg-archai-amber/5 px-3 py-2 mx-4 mt-4">
          <AlertTriangle className="h-3.5 w-3.5 text-archai-amber mt-0.5 shrink-0" />
          <p className="text-[10px] text-archai-amber leading-snug">
            Rules have changed since this run. Summary and report reflect the previous evaluation.
          </p>
        </div>
      )}

      {/* Summary count pills */}
      <div className="grid grid-cols-5 gap-1.5 px-4 pt-4">
        <CountPill
          label="Total"
          count={cs.total}
          color="text-white"
          bg=""
          active={activeFilter === 'all'}
          onClick={() => setActiveFilter('all')}
        />
        <CountPill
          label="Passed"
          count={cs.passed}
          color="text-emerald-400"
          bg="bg-emerald-400/5"
          active={activeFilter === 'pass'}
          onClick={() => setActiveFilter('pass')}
        />
        <CountPill
          label="Failed"
          count={cs.failed}
          color="text-red-400"
          bg="bg-red-400/5"
          active={activeFilter === 'fail'}
          onClick={() => setActiveFilter('fail')}
        />
        <CountPill
          label="Warning"
          count={cs.warning}
          color="text-archai-amber"
          bg="bg-archai-amber/5"
          active={activeFilter === 'warning'}
          onClick={() => setActiveFilter('warning')}
        />
        <CountPill
          label="N/A"
          count={cs.notEvaluable}
          color="text-muted-foreground"
          bg=""
          active={activeFilter === 'not_evaluable'}
          onClick={() => setActiveFilter('not_evaluable')}
        />
      </div>

      {/* Filter tabs */}
      <div className="flex shrink-0 border-b border-archai-graphite px-4 overflow-x-auto">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveFilter(tab.id)}
            className={cn(
              'relative whitespace-nowrap py-1.5 px-2 text-[11px] font-medium transition-colors shrink-0',
              activeFilter === tab.id
                ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-archai-orange'
                : 'text-muted-foreground hover:text-white',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Result rows */}
      <div className="rounded-lg border border-archai-graphite mx-4 overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="flex h-16 items-center justify-center">
            <p className="text-[11px] text-muted-foreground">
              No {activeFilter === 'all' ? '' : activeFilter} results.
            </p>
          </div>
        ) : (
          filteredRows.map((row) => <ResultRow key={row.checkId} row={row} />)
        )}
      </div>

      {/* Download button */}
      <div className="px-4 pb-4">
        {downloadError && (
          <p className="mb-2 text-[10px] text-red-400">{downloadError}</p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs gap-1.5"
          onClick={() => void handleDownload()}
          disabled={downloading || !hasCompletedRun}
          title={
            !hasCompletedRun
              ? 'Run compliance check first'
              : reportData.isStale
              ? 'Download outdated report (rules have changed since this run)'
              : 'Download PDF report'
          }
        >
          {downloading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          {downloading
            ? 'Generating…'
            : reportData.isStale
            ? 'Download outdated report'
            : 'Download report'}
        </Button>
      </div>
    </div>
  )
}
