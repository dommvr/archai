'use client'

import { ResizableHorizontalSplit } from '@/components/ui/resizable-horizontal-split'
import { ProjectViewerClient } from './ProjectViewerClient'
import { RightPanel } from './RightPanel'

interface ProjectViewerLayoutProps {
  projectId: string
  previewModelId: string | null
}

/**
 * ProjectViewerLayout — client wrapper that composes ProjectViewerClient with
 * a resizable right panel. Extracted as a client component so the Server
 * Component viewer page can remain a Server Component while still using the
 * ResizableHorizontalSplit (which requires useRef/state).
 */
export function ProjectViewerLayout({ projectId, previewModelId }: ProjectViewerLayoutProps) {
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
        />
      }
      rightPanel={
        <aside className="h-full">
          <RightPanel projectId={projectId} />
        </aside>
      }
    />
  )
}
