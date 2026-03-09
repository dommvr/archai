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
 * READY FOR TOOL 1 INTEGRATION HERE
 * SPECKLE VIEWER WILL BE MOUNTED HERE — replace console.log stubs with:
 *   viewer.highlightObjects(issue.affectedObjectIds)
 *   viewer.resetHighlights()
 *
 * The viewer instance should be held in a module-level singleton or
 * React ref created inside ViewerPanel's useEffect, then exposed via
 * a module export or window.__speckleViewer for cross-component access.
 */
export function ViewerAnnotationController({ selectedIssue }: ViewerAnnotationControllerProps) {
  useEffect(() => {
    if (!selectedIssue) {
      // SPECKLE VIEWER WILL BE MOUNTED HERE — viewer.resetHighlights()
      console.log('[ViewerAnnotationController] No issue selected — clearing highlights')
      return
    }

    const objectIds = selectedIssue.affectedObjectIds ?? []

    if (objectIds.length === 0) {
      console.log('[ViewerAnnotationController] Issue has no affected object IDs — skipping highlight')
      return
    }

    // SPECKLE VIEWER WILL BE MOUNTED HERE
    // if (window.__speckleViewer) {
    //   window.__speckleViewer.highlightObjects(objectIds)
    // }
    console.log('[ViewerAnnotationController] Highlighting objects:', objectIds)
  }, [selectedIssue])

  // Pure side-effect component — renders nothing
  return null
}
