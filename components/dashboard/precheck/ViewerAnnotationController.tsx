'use client'

import { useEffect } from 'react'
import type { ComplianceIssue } from '@/lib/precheck/types'

interface ViewerAnnotationControllerProps {
  selectedIssue: ComplianceIssue | null
}

/**
 * ViewerAnnotationController
 *
 * Watches the active compliance issue and signals the Speckle viewer
 * to highlight affected geometry objects.
 *
 * The viewer instance (LegacyViewer) is exposed by PrecheckViewerPanel
 * via window.__speckleViewer after initialisation and cleared on dispose.
 */
export function ViewerAnnotationController({ selectedIssue }: ViewerAnnotationControllerProps) {
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewer = (window as any).__speckleViewer

    if (!selectedIssue) {
      // resetHighlight() is the LegacyViewer API (singular — see LegacyViewer.d.ts:38)
      void viewer?.resetHighlight?.()
      return
    }

    const objectIds = selectedIssue.affectedObjectIds ?? []

    if (objectIds.length === 0) {
      void viewer?.resetHighlight?.()
      return
    }

    // highlightObjects() is defined on LegacyViewer (LegacyViewer.d.ts:37).
    // Optional chaining guards the case where the viewer is not yet initialised,
    // is loading a model, or has been disposed.
    void viewer?.highlightObjects?.(objectIds)
  }, [selectedIssue])

  // Pure side-effect component — renders nothing
  return null
}
