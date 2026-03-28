'use client'

/**
 * ProjectViewerClient — self-loading project viewer.
 *
 * Fetches the model ref to display via the FastAPI route handler
 * (precheckApi.getProjectActiveModelRef / listProjectModelRefs) rather than
 * querying Supabase directly from the server page.
 *
 * Why not query Supabase directly from the server component?
 * RLS is enabled on speckle_model_refs with no SELECT policy for the anon
 * key — direct queries from the server component return no rows, so modelRef
 * is always null. The FastAPI backend uses the service-role key which bypasses
 * RLS, and is already the canonical path for all other model-ref reads.
 *
 * Model resolution:
 *   previewModelId present → load that specific model (non-active preview)
 *   previewModelId absent  → load the project active model
 *
 * Banner logic (set by the caller via ProjectModels → View routing):
 *   Active model (no previewModelId) → green  "active model" banner
 *   Non-active preview               → yellow "not the active model" banner
 *   No model at all                  → no banner (SpeckleViewer shows empty state)
 *
 * SPECKLE VIEWER WILL BE MOUNTED HERE
 */

import { useState, useEffect } from 'react'
import { Eye, CheckCircle2, Loader2 } from 'lucide-react'
import { SpeckleViewer } from '@/components/dashboard/SpeckleViewer'
import * as precheckApi from '@/lib/precheck/api'
import type { SpeckleModelRef } from '@/lib/precheck/types'

interface ProjectViewerClientProps {
  projectId: string
  /**
   * When set, preview this specific (non-active) model.
   * Absent → load the project active model and show the green active banner.
   * The routing in ProjectModels ensures the active model never gets a
   * previewModelId — it routes to the plain viewer URL instead.
   */
  previewModelId?: string | null
  /**
   * Called whenever the user clicks an object in the viewer.
   * Receives null when clicking empty space (deselect).
   * Used by the parent layout to forward selection into the Copilot UI context.
   */
  onObjectClick?: (obj: import('@/types').ViewerSelectedObject | null) => void
  /**
   * Called once the model ref is resolved so the parent can forward the
   * active model ref id into the Copilot UI context.
   */
  onModelRefResolved?: (modelRefId: string | null) => void
}

export function ProjectViewerClient({
  projectId,
  previewModelId,
  onObjectClick,
  onModelRefResolved,
}: ProjectViewerClientProps) {
  const [modelRef, setModelRef] = useState<SpeckleModelRef | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function resolve() {
      try {
        let ref: SpeckleModelRef | null = null
        if (previewModelId) {
          // Preview mode: find the specific model ref from the project list.
          // There is no single-ref-by-id endpoint; list all and find by ID.
          // The list is typically small (project model library).
          const { modelRefs } = await precheckApi.listProjectModelRefs(projectId)
          ref = modelRefs.find((r) => r.id === previewModelId) ?? null
        } else {
          // Default: load the project's active model
          ref = await precheckApi.getProjectActiveModelRef(projectId) ?? null
        }
        if (!cancelled) {
          setModelRef(ref)
          onModelRefResolved?.(ref?.id ?? null)
        }
      } catch {
        if (!cancelled) {
          setModelRef(null)
          onModelRefResolved?.(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void resolve()
    return () => { cancelled = true }
  }, [projectId, previewModelId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="relative h-full w-full bg-archai-black overflow-hidden flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground/60">
          <Loader2 className="h-6 w-6 animate-spin text-archai-orange/60" />
          <p className="text-xs">Loading viewer…</p>
        </div>
      </div>
    )
  }

  // isPreview is true when a specific non-active model was requested via
  // ?previewModelId=. The routing in ProjectModels guarantees that the active
  // model is never given a previewModelId — it always uses the plain viewer URL.
  const isPreview = Boolean(previewModelId)

  return (
    <div className="relative h-full w-full">
      {modelRef && (
        isPreview ? (
          /* Non-active preview → yellow banner */
          <div className="absolute top-0 inset-x-0 z-20 flex items-center gap-2 bg-archai-amber/10 border-b border-archai-amber/20 px-4 py-1.5 pointer-events-none">
            <Eye className="h-3 w-3 text-archai-amber shrink-0" />
            <p className="text-[11px] text-archai-amber">
              Preview — <span className="font-medium">{modelRef.modelName ?? 'Speckle Model'}</span> (not the active model)
            </p>
          </div>
        ) : (
          /* Active model → green banner */
          <div className="absolute top-0 inset-x-0 z-20 flex items-center gap-2 bg-emerald-400/10 border-b border-emerald-400/20 px-4 py-1.5 pointer-events-none">
            <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
            <p className="text-[11px] text-emerald-400">
              <span className="font-medium">{modelRef.modelName ?? 'Speckle Model'}</span> — active model
            </p>
          </div>
        )
      )}

      {/*
        SpeckleViewer is the shared real viewer: mounts @speckle/viewer,
        resolves versionId→objectId via Speckle GraphQL, loads model.
        selectedIssue is null here — no compliance run context in the dashboard viewer.
      */}
      <SpeckleViewer
        selectedIssue={null}
        modelRef={modelRef}
        onObjectClick={onObjectClick}
      />
    </div>
  )
}
