'use client'

import { cn } from '@/lib/utils'

export type ViewerHighlightMode = 'none' | 'issue' | 'metric' | 'selection'

interface LegendEntry {
  color: string
  label: string
}

const LEGEND_ENTRIES: Record<Exclude<ViewerHighlightMode, 'none'>, LegendEntry[]> = {
  issue: [
    { color: 'bg-red-500',      label: 'Critical' },
    { color: 'bg-red-400',      label: 'Error' },
    { color: 'bg-yellow-400',   label: 'Warning' },
    { color: 'bg-blue-400',     label: 'Info' },
  ],
  metric: [
    { color: 'bg-green-400',    label: 'Pass' },
    { color: 'bg-yellow-400',   label: 'Marginal' },
    { color: 'bg-red-400',      label: 'Fail' },
  ],
  selection: [
    { color: 'bg-archai-orange', label: 'Selected' },
  ],
}

const LEGEND_TITLES: Record<Exclude<ViewerHighlightMode, 'none'>, string> = {
  issue:     'Issue Severity',
  metric:    'Metric Status',
  selection: 'Selection',
}

interface ViewerLegendProps {
  highlightMode: ViewerHighlightMode
}

/**
 * ViewerLegend — compact color legend explaining the current viewer highlight state.
 *
 * Renders nothing when highlightMode is 'none'.
 * Positioned at bottom-right of the viewer, above the toolbar area.
 */
export function ViewerLegend({ highlightMode }: ViewerLegendProps) {
  if (highlightMode === 'none') return null

  const entries = LEGEND_ENTRIES[highlightMode]
  const title   = LEGEND_TITLES[highlightMode]

  return (
    <div className="absolute bottom-20 right-4 z-20 glass-panel rounded-lg px-3 py-2 shadow-xl pointer-events-none select-none">
      <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
        {title}
      </p>
      <div className="space-y-1">
        {entries.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={cn('w-2 h-2 rounded-full shrink-0', color)} />
            <span className="text-[9px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
