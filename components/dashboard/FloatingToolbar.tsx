'use client'

import { useState } from 'react'
import { Undo2, Redo2, Ruler, MessageSquare, Maximize2, type LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface ToolbarAction {
  icon: LucideIcon
  label: string
  shortcut?: string
  onClick: () => void
  active?: boolean
}

export function FloatingToolbar() {
  const [measureActive, setMeasureActive] = useState(false)
  const [commentActive, setCommentActive] = useState(false)

  const actions: ToolbarAction[] = [
    {
      icon: Undo2,
      label: 'Undo',
      shortcut: '⌘Z',
      onClick: () => {
        // READY FOR VIEWER UNDO INTEGRATION HERE
        console.log('Undo action triggered')
      },
    },
    {
      icon: Redo2,
      label: 'Redo',
      shortcut: '⌘⇧Z',
      onClick: () => {
        // READY FOR VIEWER REDO INTEGRATION HERE
        console.log('Redo action triggered')
      },
    },
    {
      icon: Ruler,
      label: 'Measure',
      shortcut: 'M',
      onClick: () => {
        setMeasureActive((v) => !v)
        // READY FOR SPECKLE VIEWER MEASURE TOOL INTEGRATION HERE
        console.log('Measure tool toggled')
      },
      active: measureActive,
    },
    {
      icon: MessageSquare,
      label: 'Comment',
      shortcut: 'C',
      onClick: () => {
        setCommentActive((v) => !v)
        // READY FOR COMMENT / ANNOTATION INTEGRATION HERE
        console.log('Comment mode toggled')
      },
      active: commentActive,
    },
    {
      icon: Maximize2,
      label: 'Reset View',
      shortcut: 'F',
      onClick: () => {
        // READY FOR SPECKLE VIEWER CAMERA RESET INTEGRATION HERE
        console.log('Reset view')
      },
    },
  ]

  return (
    <TooltipProvider delayDuration={400}>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
        <div className="flex items-center gap-1 glass-panel rounded-lg px-2 py-1.5 shadow-xl">
          {actions.map((action, index) => {
            const Icon = action.icon
            return (
              <Tooltip key={action.label}>
                <TooltipTrigger asChild>
                  <button
                    onClick={action.onClick}
                    className={cn(
                      'w-8 h-8 rounded-md flex items-center justify-center transition-all',
                      'text-muted-foreground hover:text-white hover:bg-archai-graphite',
                      action.active && 'bg-archai-orange/20 text-archai-orange hover:bg-archai-orange/30 hover:text-archai-orange'
                    )}
                    aria-label={action.label}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <div className="flex items-center gap-2">
                    <span>{action.label}</span>
                    {action.shortcut && (
                      <span className="text-muted-foreground text-[10px]">{action.shortcut}</span>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </TooltipProvider>
  )
}
