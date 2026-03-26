'use client'

import { cn } from '@/lib/utils'
import { useHorizontalSplit } from '@/hooks/useHorizontalSplit'

interface ResizableHorizontalSplitProps {
  /** Content rendered in the left panel. */
  leftPanel: React.ReactNode
  /** Content rendered in the right panel. */
  rightPanel: React.ReactNode
  /**
   * localStorage key used to persist the split ratio between page loads.
   * Use a stable, unique key per layout context.
   */
  storageKey: string
  /** Initial left-panel width as a percentage of the container (0–100). */
  defaultLeftPercent?: number
  /** Minimum left-panel percentage (clamp floor). */
  minLeftPercent?: number
  /** Maximum left-panel percentage (clamp ceiling). */
  maxLeftPercent?: number
  className?: string
}

/**
 * ResizableHorizontalSplit — a two-panel horizontal layout with a draggable
 * divider between the panels. Mirrors ResizableVerticalSplit but splits
 * left/right instead of top/bottom.
 *
 * - Hover → subtle orange divider + col-resize cursor
 * - Drag → live width adjustment, text-selection suppressed
 * - Release → saves ratio to localStorage under `storageKey`
 * - Narrow viewports (< 640 px) → drag disabled
 */
export function ResizableHorizontalSplit({
  leftPanel,
  rightPanel,
  storageKey,
  defaultLeftPercent = 75,
  minLeftPercent = 30,
  maxLeftPercent = 85,
  className,
}: ResizableHorizontalSplitProps) {
  const { containerRef, leftPercent, handleMouseDown } = useHorizontalSplit({
    storageKey,
    defaultPercent: defaultLeftPercent,
    min: minLeftPercent,
    max: maxLeftPercent,
  })

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full w-full overflow-hidden', className)}
    >
      {/* ── Left panel ─────────────────────────────────────────────────── */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ width: `${leftPercent}%` }}
      >
        {leftPanel}
      </div>

      {/* ── Drag handle ───────────────────────────────────────────────── */}
      <div
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize panels"
        className={cn(
          'group relative flex w-2 shrink-0 cursor-col-resize items-center justify-center',
          'select-none transition-colors duration-150',
          'hover:bg-archai-orange/5',
        )}
      >
        {/* Hairline divider — always visible at 1 px, brightens on hover */}
        <div
          className={cn(
            'absolute inset-y-0 left-1/2 w-px -translate-x-1/2',
            'bg-archai-graphite transition-colors duration-150',
            'group-hover:bg-archai-orange/50',
          )}
        />

        {/* Three-dot grip indicator — fades in on hover */}
        <div className="relative flex flex-col gap-[3px] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[3px] w-[3px] rounded-full bg-archai-orange/70"
            />
          ))}
        </div>
      </div>

      {/* ── Right panel ───────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {rightPanel}
      </div>
    </div>
  )
}
