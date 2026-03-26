/**
 * PrecheckViewerPanel — re-exports SpeckleViewer under the legacy name.
 *
 * SpeckleViewer is the canonical shared 3D viewer component. This file exists
 * so that Tool 1 components (PrecheckWorkspace, etc.) that import
 * PrecheckViewerPanel continue to work without changes. Any new code should
 * import SpeckleViewer directly from '@/components/dashboard/SpeckleViewer'.
 */
export { SpeckleViewer as PrecheckViewerPanel } from '@/components/dashboard/SpeckleViewer'
