'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Info, XCircle, ZapOff } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ComplianceIssue } from '@/lib/precheck/types'
import type { IssueSeverity } from '@/lib/precheck/constants'

const SEVERITY_ORDER: IssueSeverity[] = ['critical', 'error', 'warning', 'info']

interface SevConfig {
  label: string
  color: string
  Icon:  LucideIcon
}

const SEVERITY_CONFIG: Record<IssueSeverity, SevConfig> = {
  info:     { label: 'Info',     color: 'text-blue-400 border-blue-400/30 bg-blue-400/10',         Icon: Info          },
  warning:  { label: 'Warning',  color: 'text-archai-amber border-archai-amber/30 bg-archai-amber/10', Icon: AlertTriangle  },
  error:    { label: 'Error',    color: 'text-red-400 border-red-400/30 bg-red-400/10',             Icon: XCircle       },
  critical: { label: 'Critical', color: 'text-red-500 border-red-500/30 bg-red-500/10',             Icon: ZapOff        },
}

interface ComplianceIssuesTableProps {
  issues:        ComplianceIssue[]
  onSelectIssue: (issue: ComplianceIssue) => void
  isLoading?:    boolean
}

export function ComplianceIssuesTable({ issues, onSelectIssue, isLoading }: ComplianceIssuesTableProps) {
  const [filter,  setFilter]  = useState<IssueSeverity | 'all'>('all')
  const [sortAsc, setSortAsc] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-archai-graphite animate-pulse opacity-60" />
        ))}
      </div>
    )
  }

  const counts = issues.reduce<Partial<Record<IssueSeverity, number>>>((acc, i) => {
    acc[i.severity] = (acc[i.severity] ?? 0) + 1
    return acc
  }, {})

  const filtered = issues
    .filter((i) => filter === 'all' || i.severity === filter)
    .sort((a, b) => {
      const diff = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
      return sortAsc ? -diff : diff
    })

  return (
    <div className="space-y-3">
      {/* Filter + sort bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={cn(
            'text-[10px] rounded-full px-2 py-0.5 border transition-colors',
            filter === 'all'
              ? 'border-white/30 bg-white/10 text-white'
              : 'border-archai-graphite text-muted-foreground hover:text-white',
          )}
        >
          All ({issues.length})
        </button>

        {SEVERITY_ORDER.map((sev) => {
          const count = counts[sev]
          if (!count) return null
          const cfg = SEVERITY_CONFIG[sev]
          return (
            <button
              key={sev}
              onClick={() => setFilter(sev)}
              className={cn(
                'text-[10px] rounded-full px-2 py-0.5 border transition-colors',
                filter === sev ? cfg.color : 'border-archai-graphite text-muted-foreground hover:text-white',
              )}
            >
              {cfg.label} ({count})
            </button>
          )
        })}

        <button
          onClick={() => setSortAsc((v) => !v)}
          className="ml-auto text-muted-foreground hover:text-white transition-colors"
          aria-label="Toggle sort direction"
        >
          {sortAsc ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Issue rows */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-archai-graphite py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {issues.length === 0
              ? 'No issues found — run compliance evaluation first'
              : 'No issues match the current filter'}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((issue) => {
            const cfg  = SEVERITY_CONFIG[issue.severity]
            const Icon = cfg.Icon
            return (
              <button
                key={issue.id}
                onClick={() => onSelectIssue(issue)}
                className={cn(
                  'w-full text-left rounded-lg border border-archai-graphite px-3 py-2.5',
                  'hover:border-archai-orange/30 hover:bg-archai-orange/5 transition-colors group',
                )}
              >
                <div className="flex items-start gap-2">
                  <Icon className={cn('h-3.5 w-3.5 shrink-0 mt-0.5', cfg.color.split(' ')[0])} />
                  <span className="flex-1 min-w-0 text-xs text-white font-medium leading-snug break-words group-hover:text-archai-amber transition-colors">
                    {issue.title}
                  </span>
                  <span className={cn('text-[10px] font-medium rounded-full px-1.5 py-0.5 border shrink-0 whitespace-nowrap', cfg.color)}>
                    {cfg.label}
                  </span>
                </div>
                {issue.summary && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 pl-5 leading-snug break-words line-clamp-3">{issue.summary}</p>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
