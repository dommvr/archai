'use client'

import { useState, useCallback } from 'react'
import { ResizableHorizontalSplit } from '@/components/ui/resizable-horizontal-split'
import { ProjectViewerClient } from './ProjectViewerClient'
import { RightPanel } from './RightPanel'
import type { CopilotUiContext, ViewerSelectedObject } from '@/types'

interface ProjectViewerLayoutProps {
  projectId: string
  previewModelId: string | null
}

/**
 * ProjectViewerLayout — client wrapper that composes ProjectViewerClient with
 * a resizable right panel. Extracted as a client component so the Server
 * Component viewer page can remain a Server Component while still using the
 * ResizableHorizontalSplit (which requires useRef/state).
 *
 * Viewer state bridge:
 *   SpeckleViewer fires onObjectClick → we collect selectedObjectIds here
 *   and forward them to RightPanel as copilotUiContext so Copilot's
 *   get_viewer_selection tool can read the live selection.
 *
 *   Similarly, onModelRefResolved captures the active model ref id so
 *   get_metrics can query geometry snapshots for the displayed model.
 */
export function ProjectViewerLayout({ projectId, previewModelId }: ProjectViewerLayoutProps) {
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([])
  const [activeModelRefId, setActiveModelRefId] = useState<string | null>(null)

  const handleObjectClick = useCallback(
    (obj: ViewerSelectedObject | null) => {
      setSelectedObjectIds(obj ? [obj.id] : [])
    },
    []
  )

  const handleModelRefResolved = useCallback((refId: string | null) => {
    setActiveModelRefId(refId)
  }, [])

  const copilotUiContext: CopilotUiContext = {
    currentPage: 'viewer',
    selectedObjectIds,
    activeModelRefId,
  }

  return (
    <ResizableHorizontalSplit
      storageKey="project-viewer-right-panel"
      defaultLeftPercent={72}
      minLeftPercent={50}
      maxLeftPercent={85}
      leftPanel={
        /* SPECKLE VIEWER WILL BE MOUNTED HERE */
        <ProjectViewerClient
          projectId={projectId}
          previewModelId={previewModelId}
          onObjectClick={handleObjectClick}
          onModelRefResolved={handleModelRefResolved}
        />
      }
      rightPanel={
        <aside className="h-full">
          <RightPanel
            projectId={projectId}
            copilotUiContext={copilotUiContext}
          />
        </aside>
      }
    />
  )
}
