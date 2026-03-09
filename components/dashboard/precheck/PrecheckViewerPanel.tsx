'use client'

import { FloatingToolbar } from '@/components/dashboard/FloatingToolbar'
import { ViewerAnnotationController } from './ViewerAnnotationController'
import type { ComplianceIssue } from '@/lib/precheck/types'

interface PrecheckViewerPanelProps {
  selectedIssue: ComplianceIssue | null
}

export function PrecheckViewerPanel({ selectedIssue }: PrecheckViewerPanelProps) {
  return (
    <div className="relative h-full w-full bg-archai-black overflow-hidden">
      {/* Blueprint grid while viewer is not yet mounted */}
      <div className="absolute inset-0 bg-blueprint-grid opacity-30 pointer-events-none" />

      {/* Speckle viewer mount point */}
      {/* SPECKLE VIEWER WILL BE MOUNTED HERE */}
      <div id="speckle-viewer" className="absolute inset-0 z-0" />

      {/* Empty state — hidden once viewer mounts */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-muted-foreground/40 pointer-events-none select-none">
        <div className="w-16 h-16 rounded-2xl border border-archai-graphite/40 flex items-center justify-center">
          <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
        <p className="text-sm">Sync a Speckle model to see 3D view</p>
      </div>

      {/* Issue-to-object highlight bridge */}
      <ViewerAnnotationController selectedIssue={selectedIssue} />

      {/* Measure / comment / undo toolbar */}
      <FloatingToolbar />
    </div>
  )
}
