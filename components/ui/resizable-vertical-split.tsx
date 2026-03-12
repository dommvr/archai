'use client'

import { cn } from '@/lib/utils'
import { useVerticalSplit } from '@/hooks/useVerticalSplit'

interface ResizableVerticalSplitProps {
  /** Content rendered in the upper panel. */
  topPanel: React.ReactNode
  /** Content rendered in the lower panel. */
  bottomPanel: React.ReactNode
  /**
   * localStorage key used to persist the split ratio between page loads.
   * Use a stable, unique key per layout context, e.g. "dashboard-right-split".
   */
  storageKey: string
  /** Initial top-panel height as a percentage of the container (0–100). */
  defaultTopPercent?: number
  /** Minimum top-panel percentage (clamp floor). */
  minTopPercent?: number
  /** Maximum top-panel percentage (clamp ceiling). */
  maxTopPercent?: number
  className?: string
}

/**
 * ResizableVerticalSplit — a two-panel vertical layout with a draggable
 * divider between the panels. Behaves like VS Code's panel resizing:
 *
 * - Hover → subtle orange divider line + row-resize cursor
 * - Drag → live height adjustment, text-selection suppressed
 * - Release → saves ratio to localStorage under `storageKey`
 * - Narrow viewports (< 640 px) → drag disabled, layout stays fixed
 *
 * The component fills 100 % of its parent height. Both panels receive
 * `overflow-hidden` containers; scroll behaviour inside each panel is the
 * responsibility of the content passed in.
 */
export function ResizableVerticalSplit({
  topPanel,
  bottomPanel,
  storageKey,
  defaultTopPercent = 40,
  minTopPercent = 15,
  maxTopPercent = 85,
  className,
}: ResizableVerticalSplitProps) {
  const { containerRef, topPercent, handleMouseDown } = useVerticalSplit({
    storageKey,
    defaultPercent: defaultTopPercent,
    min: minTopPercent,
    max: maxTopPercent,
  })

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full flex-col overflow-hidden', className)}
    >
      {/* ── Top panel ─────────────────────────────────────────────────── */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ height: `${topPercent}%` }}
      >
        {topPanel}
      </div>

      {/* ── Drag handle ───────────────────────────────────────────────── */}
      <div
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize panels"
        className={cn(
          'group relative flex h-2 shrink-0 cursor-row-resize items-center justify-center',
          'select-none transition-colors duration-150',
          // Subtle background tint on hover so the user knows the area is interactive.
          'hover:bg-archai-orange/5',
        )}
      >
        {/* Hairline divider — always visible at 1 px, brightens on hover */}
        <div
          className={cn(
            'absolute inset-x-0 top-1/2 h-px -translate-y-1/2',
            'bg-archai-graphite transition-colors duration-150',
            'group-hover:bg-archai-orange/50',
          )}
        />

        {/* Three-dot grip indicator — fades in on hover */}
        <div className="relative flex gap-[3px] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[3px] w-[3px] rounded-full bg-archai-orange/70"
            />
          ))}
        </div>
      </div>

      {/* ── Bottom panel ──────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {bottomPanel}
      </div>
    </div>
  )
}
