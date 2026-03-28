'use client'

import { FileText, Layers, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CopilotUiContext } from '@/types'

interface CopilotContextBadgeProps {
  uiContext: CopilotUiContext | undefined
  className?: string
}

/**
 * Small indicator showing what context the Copilot has access to.
 * Displayed in the thread header so the user understands what the
 * AI can see without reading the system prompt.
 */
export function CopilotContextBadge({ uiContext, className }: CopilotContextBadgeProps) {
  if (!uiContext) return null

  const badges: { icon: React.FC<{ className?: string }>; label: string }[] = []

  if (uiContext.currentPage) {
    badges.push({ icon: Layers, label: uiContext.currentPage })
  }
  if (uiContext.activeRunId) {
    badges.push({ icon: FileText, label: 'run context' })
  }
  if (uiContext.selectedObjectIds && uiContext.selectedObjectIds.length > 0) {
    badges.push({ icon: MapPin, label: `${uiContext.selectedObjectIds.length} object(s)` })
  }

  if (badges.length === 0) return null

  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
      {badges.map(({ icon: Icon, label }) => (
        <span
          key={label}
          className="flex items-center gap-1 text-[9px] text-archai-orange/60 border border-archai-orange/20 rounded px-1.5 py-0.5"
        >
          <Icon className="h-2 w-2" />
          {label}
        </span>
      ))}
    </div>
  )
}
