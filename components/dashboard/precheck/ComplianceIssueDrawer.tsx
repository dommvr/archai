'use client'

import { AlertTriangle, BookOpen, Info, XCircle, ZapOff } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { ComplianceIssue } from '@/lib/precheck/types'
import type { IssueSeverity } from '@/lib/precheck/constants'

interface SevConfig {
  label: string
  color: string
  Icon:  LucideIcon
}

const SEVERITY_CONFIG: Record<IssueSeverity, SevConfig> = {
  info:     { label: 'Info',     color: 'text-blue-400',    Icon: Info          },
  warning:  { label: 'Warning',  color: 'text-archai-amber', Icon: AlertTriangle  },
  error:    { label: 'Error',    color: 'text-red-400',     Icon: XCircle       },
  critical: { label: 'Critical', color: 'text-red-500',     Icon: ZapOff        },
}

interface ComplianceIssueDrawerProps {
  issue:        ComplianceIssue | null
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export function ComplianceIssueDrawer({ issue, open, onOpenChange }: ComplianceIssueDrawerProps) {
  if (!issue) return null

  const cfg  = SEVERITY_CONFIG[issue.severity]
  const Icon = cfg.Icon

  const hasValues = issue.actualValue != null || issue.expectedValue != null
    || issue.expectedMin != null || issue.expectedMax != null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Icon className={cn('h-4 w-4 shrink-0', cfg.color)} />
            <DialogTitle className={cn('text-base leading-tight', cfg.color)}>
              {issue.title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {issue.summary}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {/* Severity + status chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-xs font-medium rounded-full px-2 py-0.5 border border-current/20 bg-current/10', cfg.color)}>
              {cfg.label}
            </span>
            <span className="text-xs text-muted-foreground border border-archai-graphite rounded-full px-2 py-0.5">
              {issue.status.replace(/_/g, ' ')}
            </span>
            {issue.metricKey && (
              <span className="text-xs text-muted-foreground border border-archai-graphite rounded-full px-2 py-0.5 font-mono">
                {issue.metricKey.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {/* Explanation */}
          {issue.explanation && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Explanation</p>
              <p className="text-sm text-white/80 leading-relaxed">{issue.explanation}</p>
            </div>
          )}

          {/* Values */}
          {hasValues && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Values</p>
                <div className="grid grid-cols-3 gap-2">
                  {issue.actualValue != null && (
                    <div className="rounded-lg bg-archai-black border border-archai-graphite p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">Actual</p>
                      <p className="text-sm font-bold text-white">
                        {issue.actualValue}{issue.units ? ` ${issue.units}` : ''}
                      </p>
                    </div>
                  )}
                  {issue.expectedValue != null && (
                    <div className="rounded-lg bg-archai-black border border-archai-graphite p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">Required</p>
                      <p className="text-sm font-bold text-emerald-400">
                        {issue.expectedValue}{issue.units ? ` ${issue.units}` : ''}
                      </p>
                    </div>
                  )}
                  {issue.expectedMin != null && issue.expectedMax != null && (
                    <div className="rounded-lg bg-archai-black border border-archai-graphite p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">Range</p>
                      <p className="text-sm font-bold text-emerald-400">
                        {issue.expectedMin}–{issue.expectedMax}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Citation */}
          {issue.citation && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-archai-orange" />
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Citation</p>
                </div>
                <div className="rounded-lg bg-archai-black border border-archai-graphite p-3 space-y-1.5">
                  {issue.citation.section && (
                    <p className="text-xs font-semibold text-white">{issue.citation.section}</p>
                  )}
                  <p className="text-xs text-muted-foreground italic leading-relaxed">
                    &ldquo;{issue.citation.snippet}&rdquo;
                  </p>
                  {issue.citation.page != null && (
                    <p className="text-[10px] text-muted-foreground/50">Page {issue.citation.page}</p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Affected objects */}
          {issue.affectedObjectIds.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Affected Model Objects ({issue.affectedObjectIds.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {issue.affectedObjectIds.slice(0, 8).map((id) => (
                    <span key={id} className="text-[10px] font-mono bg-archai-graphite rounded px-1.5 py-0.5 text-muted-foreground">
                      {id.length > 12 ? `${id.slice(0, 12)}…` : id}
                    </span>
                  ))}
                  {issue.affectedObjectIds.length > 8 && (
                    <span className="text-[10px] text-muted-foreground self-center">
                      +{issue.affectedObjectIds.length - 8} more
                    </span>
                  )}
                </div>
                {/* SPECKLE VIEWER WILL BE MOUNTED HERE — viewer.highlightObjects(affectedObjectIds) */}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
