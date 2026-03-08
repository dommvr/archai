'use client'

import { useRef, useEffect } from 'react'
import { FloatingToolbar } from './FloatingToolbar'
import { Box } from 'lucide-react'

interface ViewerPanelProps {
  projectId?: string
}

/**
 * ViewerPanel — Central 3D model viewer area.
 *
 * The div#speckle-viewer is the mount point for @speckle/viewer.
 * It is kept as a stable ref target — do NOT change the id.
 *
 * To integrate Speckle viewer:
 * 1. npm install @speckle/viewer
 * 2. import { Viewer, DefaultViewerParams } from '@speckle/viewer'
 * 3. In the useEffect below, mount the viewer:
 *    const viewer = new Viewer(viewerRef.current!, DefaultViewerParams)
 *    await viewer.init()
 * 4. Load a stream: viewer.loadObject(streamUrl, token)
 * 5. See CLAUDE.md → Playbooks → Integrating Speckle viewer logic
 *
 * SPECKLE VIEWER WILL BE MOUNTED HERE
 */
export function ViewerPanel({ projectId }: ViewerPanelProps) {
  const viewerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // SPECKLE VIEWER WILL BE MOUNTED HERE
    // Future mounting code:
    // import('@speckle/viewer').then(({ Viewer, DefaultViewerParams }) => {
    //   if (!viewerRef.current) return
    //   const viewer = new Viewer(viewerRef.current, DefaultViewerParams)
    //   viewer.init().then(() => {
    //     console.log('Speckle viewer initialized for project:', projectId)
    //   })
    // })

    console.log('ViewerPanel mounted — Speckle viewer placeholder active for project:', projectId)
  }, [projectId])

  return (
    <div className="relative w-full h-full bg-archai-black bg-blueprint-grid overflow-hidden">
      {/* Speckle Viewer Mount Point */}
      {/* SPECKLE VIEWER WILL BE MOUNTED HERE */}
      <div
        ref={viewerRef}
        id="speckle-viewer"
        className="absolute inset-0"
        aria-label="3D model viewer"
      />

      {/* Placeholder UI — shown until Speckle viewer is mounted */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
        <div className="flex flex-col items-center gap-4 opacity-30">
          <div className="w-16 h-16 rounded-xl border border-archai-graphite flex items-center justify-center">
            <Box className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-xs font-medium text-muted-foreground mb-1">3D Viewer</p>
            <p className="text-[10px] text-muted-foreground/60">
              Connect a Speckle stream or upload a model to begin
            </p>
          </div>
        </div>

        {/* Blueprint grid corner indicators */}
        <div className="absolute top-4 left-4 w-6 h-6 border-t border-l border-archai-orange/20" />
        <div className="absolute top-4 right-4 w-6 h-6 border-t border-r border-archai-orange/20" />
        <div className="absolute bottom-14 left-4 w-6 h-6 border-b border-l border-archai-orange/20" />
        <div className="absolute bottom-14 right-4 w-6 h-6 border-b border-r border-archai-orange/20" />
      </div>

      {/* Coordinate overlay — architectural drafting reference */}
      <div className="absolute top-4 left-4 text-[10px] text-muted-foreground/30 font-mono select-none">
        X: 0.00 Y: 0.00 Z: 0.00
      </div>

      {/* Scale reference */}
      <div className="absolute top-4 right-4 text-[10px] text-muted-foreground/30 font-mono select-none">
        1:200
      </div>

      {/* Floating toolbar — overlaid at bottom center */}
      <FloatingToolbar />
    </div>
  )
}
