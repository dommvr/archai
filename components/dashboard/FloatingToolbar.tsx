'use client'

import { useState } from 'react'
import {
  Maximize2,
  Camera,
  ChevronDown,
  Scissors,
  Ruler,
  Eye,
  SlidersHorizontal,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Minimal shape of the LegacyViewer surface used by this toolbar. */
interface LegacyViewerSurface {
  zoom: (ids?: string[], fit?: number, transition?: boolean) => void
  setView: (view: string, transition?: boolean) => void
  toggleSectionBox: () => void
  sectionBoxOff: () => void
  enableMeasurements: (value: boolean) => void
  setMeasurementOptions: (options: { visible: boolean; type?: number }) => void
  removeMeasurement: () => void
  hideObjects: (ids: string[], stateKey?: string, includeDescendants?: boolean, ghost?: boolean) => Promise<unknown>
  showObjects: (ids: string[], stateKey?: string, includeDescendants?: boolean) => Promise<unknown>
  isolateObjects: (ids: string[], stateKey?: string, includeDescendants?: boolean, ghost?: boolean) => Promise<unknown>
  resetFilters: () => Promise<unknown>
  resetHighlight: () => Promise<unknown>
  resetSelection: () => Promise<unknown>
}

/** Read the live LegacyViewer instance exposed by SpeckleViewer. Returns null if not ready. */
function getViewer(): LegacyViewerSurface | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).__speckleViewer as LegacyViewerSurface | null ?? null
}

type CanonicalView = 'top' | 'front' | 'back' | 'right' | 'left' | '3d'

interface FloatingToolbarProps {
  /** Called when user toggles the properties panel via the toolbar. */
  onToggleProperties?: () => void
  /** Whether the properties panel is currently open — controls active state of the button. */
  propertiesOpen?: boolean
  /**
   * Called when measure mode is toggled.
   * SpeckleViewer uses this to suppress normal object-click handling while measuring,
   * so that measurement point-picking does not accidentally open the inspector.
   */
  onMeasureChange?: (active: boolean) => void
}

/**
 * FloatingToolbar — real viewer control toolbar.
 *
 * Actions:
 * - Fit to model      → viewer.zoom()
 * - Views dropdown    → viewer.setView(canonical)
 * - Section box       → viewer.toggleSectionBox()
 * - Measure           → viewer.enableMeasurements() + setMeasurementOptions
 * - Show all          → viewer.resetFilters()
 * - Properties        → toggles the ViewerInspectorPanel via onToggleProperties callback
 *
 * Removed: Undo, Redo, Comment (had no real implementation).
 *
 * TODO READY FOR COMMENT / ANNOTATION INTEGRATION HERE
 * When annotation/comment flow is implemented, add a Comment button here
 * that opens a comment overlay panel (separate from this toolbar).
 *
 * All viewer API calls read window.__speckleViewer at call time (same pattern as
 * ViewerAnnotationController). Guards silently when viewer is not yet ready.
 */
export function FloatingToolbar({ onToggleProperties, propertiesOpen = false, onMeasureChange }: FloatingToolbarProps) {
  const [measureActive, setMeasureActive] = useState(false)
  const [sectionActive, setSectionActive] = useState(false)

  function handleFitToModel() {
    const v = getViewer()
    if (!v) return
    // No args → zoom to fit all loaded geometry
    v.zoom()
  }

  function handleSetView(view: CanonicalView) {
    const v = getViewer()
    if (!v) return
    v.setView(view, /* transition */ true)
  }

  function handleToggleSection() {
    const v = getViewer()
    if (!v) return
    v.toggleSectionBox()
    setSectionActive((prev) => !prev)
  }

  function handleToggleMeasure() {
    const v = getViewer()
    if (!v) return
    const next = !measureActive
    setMeasureActive(next)
    v.enableMeasurements(next)
    if (next) {
      // MeasurementType.POINTTOPOINT = 1 (from @speckle/shared/viewer/state enum).
      // Using numeric literal to avoid a module-level import from @speckle/shared
      // which would pull ESM internals into the static bundle — @speckle/viewer is
      // already kept out of SSR via dynamic import inside SpeckleViewer.
      v.setMeasurementOptions({ visible: true, type: 1 })
    } else {
      v.removeMeasurement()
    }
    // Notify SpeckleViewer so the ObjectClicked handler knows to skip
    // normal selection while measurements are being picked.
    onMeasureChange?.(next)
  }

  function handleShowAll() {
    const v = getViewer()
    if (!v) return
    void v.resetFilters()
    void v.resetHighlight()
    void v.resetSelection()
  }

  const btnBase = cn(
    'w-8 h-8 rounded-md flex items-center justify-center transition-all',
    'text-muted-foreground hover:text-white hover:bg-archai-graphite',
  )
  const btnActive = 'bg-archai-orange/20 text-archai-orange hover:bg-archai-orange/30 hover:text-archai-orange'
  const divider = <div className="w-px h-4 bg-archai-graphite mx-0.5 shrink-0" />

  return (
    <TooltipProvider delayDuration={400}>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
        <div className="flex items-center gap-1 glass-panel rounded-lg px-2 py-1.5 shadow-xl">

          {/* Fit to model */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleFitToModel}
                className={btnBase}
                aria-label="Fit to model"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>Fit to model</span>
            </TooltipContent>
          </Tooltip>

          {divider}

          {/* Views dropdown */}
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(btnBase, 'w-auto gap-0.5 px-1.5')}
                    aria-label="Camera views"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <ChevronDown className="h-2.5 w-2.5 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <DropdownMenuContent side="top" align="center" className="min-w-[100px]">
                {(
                  [
                    { label: 'Perspective', view: '3d' },
                    { label: 'Top',         view: 'top' },
                    { label: 'Front',       view: 'front' },
                    { label: 'Right',       view: 'right' },
                    { label: 'Left',        view: 'left' },
                    { label: 'Back',        view: 'back' },
                  ] as { label: string; view: CanonicalView }[]
                ).map(({ label, view }) => (
                  <DropdownMenuItem key={view} onClick={() => handleSetView(view)}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipContent side="top">
              <span>Camera views</span>
            </TooltipContent>
          </Tooltip>

          {divider}

          {/* Section box */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleToggleSection}
                className={cn(btnBase, sectionActive && btnActive)}
                aria-label="Toggle section box"
                aria-pressed={sectionActive}
              >
                <Scissors className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="flex items-center gap-2">
                <span>Section box</span>
                <span className="text-muted-foreground text-[10px]">{sectionActive ? 'On' : 'Off'}</span>
              </div>
            </TooltipContent>
          </Tooltip>

          {/* Measure */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleToggleMeasure}
                className={cn(btnBase, measureActive && btnActive)}
                aria-label="Measure point-to-point"
                aria-pressed={measureActive}
              >
                <Ruler className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="flex items-center gap-2">
                <span>Measure</span>
                <span className="text-muted-foreground text-[10px]">M</span>
              </div>
            </TooltipContent>
          </Tooltip>

          {divider}

          {/* Show all */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleShowAll}
                className={btnBase}
                aria-label="Show all objects"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>Show all</span>
            </TooltipContent>
          </Tooltip>

          {/* Properties */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggleProperties}
                className={cn(btnBase, propertiesOpen && btnActive)}
                aria-label="Toggle properties"
                aria-pressed={propertiesOpen}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>Properties</span>
            </TooltipContent>
          </Tooltip>

        </div>
      </div>
    </TooltipProvider>
  )
}
