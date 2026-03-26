'use client'

import { useRef, useEffect } from 'react'
import { FloatingToolbar } from './FloatingToolbar'
import { Box, Eye } from 'lucide-react'

interface ViewerActiveModelRef {
  streamId: string
  versionId: string
  modelName?: string | null
  branchName?: string | null
}

interface ViewerPanelProps {
  projectId?: string
  /**
   * The active project model ref — used to show model identity in the
   * placeholder and will seed viewer.loadObject() once @speckle/viewer is mounted.
   * SPECKLE VIEWER WILL BE MOUNTED HERE
   */
  activeModelRef?: ViewerActiveModelRef | null
  /** When true, this is a temporary preview (not the project active model) */
  isPreview?: boolean
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
 * 4. Load stream: viewer.loadObject(`https://speckle.xyz/streams/${activeModelRef.streamId}/objects/${activeModelRef.versionId}`, token)
 * 5. See CLAUDE.md → Playbooks → Integrating Speckle viewer logic
 *
 * SPECKLE VIEWER WILL BE MOUNTED HERE
 */
export function ViewerPanel({ projectId, activeModelRef, isPreview }: ViewerPanelProps) {
  const viewerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // SPECKLE VIEWER WILL BE MOUNTED HERE
    // When @speckle/viewer is installed, replace this block with:
    // import('@speckle/viewer').then(({ Viewer, DefaultViewerParams }) => {
    //   if (!viewerRef.current) return
    //   const viewer = new Viewer(viewerRef.current, DefaultViewerParams)
    //   viewer.init().then(() => {
    //     if (activeModelRef) {
    //       const url = `https://speckle.xyz/streams/${activeModelRef.streamId}/objects/${activeModelRef.versionId}`
    //       viewer.loadObject(url, /* token */)
    //     }
    //   })
    // })

    console.log(
      'ViewerPanel mounted — Speckle viewer placeholder active',
      { projectId, activeModelRef: activeModelRef?.streamId ?? 'none' },
    )
  }, [projectId, activeModelRef])

  return (
    <div className="relative w-full h-full bg-archai-black bg-blueprint-grid overflow-hidden">
      {/* Preview mode banner — shown when viewing a non-active model */}
      {isPreview && activeModelRef && (
        <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-2 bg-archai-amber/10 border-b border-archai-amber/20 px-4 py-1.5 pointer-events-none">
          <Eye className="h-3 w-3 text-archai-amber shrink-0" />
          <p className="text-[11px] text-archai-amber">
            Preview — <span className="font-medium">{activeModelRef.modelName ?? 'Speckle Model'}</span> (not the active model)
          </p>
        </div>
      )}
      {/* Speckle Viewer Mount Point */}
      {/* SPECKLE VIEWER WILL BE MOUNTED HERE */}
      <div
        ref={viewerRef}
        id="speckle-viewer"
        className="absolute inset-0"
        aria-label="3D model viewer"
      />

      {/* Placeholder UI — replaced by the mounted Speckle viewer */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
        <div className="flex flex-col items-center gap-4">
          <div className={`w-16 h-16 rounded-xl border flex items-center justify-center ${activeModelRef ? 'border-emerald-400/20 bg-emerald-400/5' : 'border-archai-graphite opacity-30'}`}>
            <Box className={`h-7 w-7 ${activeModelRef ? 'text-emerald-400/60' : 'text-muted-foreground'}`} />
          </div>
          <div className="text-center">
            {activeModelRef ? (
              <>
                <p className="text-xs font-medium text-white/80 mb-0.5">
                  {activeModelRef.modelName ?? 'Speckle Model'}
                </p>
                <p className="font-mono text-[10px] text-muted-foreground/60 mb-0.5">
                  {activeModelRef.streamId} / {activeModelRef.versionId}
                </p>
                <p className="text-[10px] text-muted-foreground/40">
                  Speckle viewer integration pending — model identified
                </p>
              </>
            ) : (
              <div className="opacity-30">
                <p className="text-xs font-medium text-muted-foreground mb-1">3D Viewer</p>
                <p className="text-[10px] text-muted-foreground/60">
                  Sync a Speckle model and set it as active to load it here
                </p>
              </div>
            )}
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
