'use client'

import { CheckSquare, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PermitChecklistItem } from '@/lib/precheck/types'
import type { ChecklistCategory } from '@/lib/precheck/constants'

const CATEGORY_LABELS: Record<ChecklistCategory, string> = {
  site_data:        'Site Data',
  zoning_data:      'Zoning Data',
  model_data:       'Model Data',
  rules_data:       'Rules Data',
  submission_data:  'Submission Data',
}

interface PermitChecklistCardProps {
  items: PermitChecklistItem[]
  isLoading?: boolean
}

export function PermitChecklistCard({ items, isLoading }: PermitChecklistCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-3">
        <div className="h-4 w-28 rounded bg-archai-graphite animate-pulse" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-3 w-full rounded bg-archai-graphite animate-pulse opacity-60" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 text-center">
        <p className="text-xs text-muted-foreground">No checklist items yet</p>
      </div>
    )
  }

  // Group by category
  const grouped = items.reduce<Partial<Record<ChecklistCategory, PermitChecklistItem[]>>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category]!.push(item)
    return acc
  }, {})

  const resolved = items.filter((i) => i.resolved).length

  return (
    <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Permit Checklist</p>
        <span className="text-[10px] text-muted-foreground">{resolved}/{items.length} resolved</span>
      </div>

      {(Object.keys(grouped) as ChecklistCategory[]).map((category) => {
        const catItems = grouped[category] ?? []
        return (
          <div key={category} className="space-y-1.5">
            <p className="text-[10px] font-semibold text-archai-orange/70 uppercase tracking-wider">
              {CATEGORY_LABELS[category]}
            </p>
            {catItems.map((item) => (
              <div key={item.id} className="flex items-start gap-2">
                {item.resolved
                  ? <CheckSquare className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                  : <Square      className="h-3.5 w-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-xs leading-tight',
                    item.resolved ? 'text-muted-foreground line-through' : 'text-white',
                  )}>
                    {item.title}
                    {item.required && !item.resolved && (
                      <span className="ml-1 text-archai-orange text-[9px]">*</span>
                    )}
                  </p>
                  {item.description && (
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">{item.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
