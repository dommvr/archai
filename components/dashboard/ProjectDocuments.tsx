'use client'

/**
 * ProjectDocuments — project-level document library.
 *
 * Shows all documents uploaded to this project (across all runs + project-level).
 * Upload happens inline via ProjectDocumentUploader — no redirect to Tool 1.
 * Preview: PDFs and images open via Supabase Storage signed URL.
 */

import { useState, useEffect, useCallback } from 'react'
import { FileText, Trash2, Loader2, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import * as precheckApi from '@/lib/precheck/api'
import type { UploadedDocument } from '@/lib/precheck/types'
import { ProjectDocumentUploader } from './ProjectDocumentUploader'

// Supabase Storage bucket — must match STORAGE_BUCKET in DocumentUploadPanel
const STORAGE_BUCKET = 'precheck-documents'

interface ProjectDocumentsProps {
  projectId: string
}

const DOC_TYPE_LABELS: Record<string, string> = {
  zoning_code:   'Zoning Code',
  building_code: 'Building Code',
  project_doc:   'Project Doc',
  other:         'Other',
}

export function ProjectDocuments({ projectId }: ProjectDocumentsProps) {
  const [documents,    setDocuments]    = useState<UploadedDocument[]>([])
  const [loading,      setLoading]      = useState(true)
  const [deletingId,   setDeletingId]   = useState<string | null>(null)
  const [deleteError,  setDeleteError]  = useState<string | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    precheckApi.listProjectDocuments(projectId)
      .then(({ documents: docs }) => { if (!cancelled) { setDocuments(docs); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(load, [load])

  const handleDocumentUploaded = (doc: UploadedDocument) => {
    setDocuments((prev) => [doc, ...prev])
  }

  const handleDelete = async (doc: UploadedDocument) => {
    if (deletingId) return
    setDeletingId(doc.id)
    setDeleteError(null)
    try {
      await precheckApi.deleteDocument(doc.id)
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
    } catch {
      setDeleteError('Failed to delete document.')
    } finally {
      setDeletingId(null)
    }
  }

  /**
   * Generate a short-lived signed URL for the document's storage path
   * and open it in a new tab. Works for PDFs, images, and any file the
   * browser can render natively. Expires in 60 seconds.
   */
  const handlePreview = async (doc: UploadedDocument) => {
    if (previewingId) return
    setPreviewingId(doc.id)
    try {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(doc.storagePath, 60)
      if (error || !data?.signedUrl) {
        throw new Error(error?.message ?? 'Could not generate preview URL')
      }
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch {
      // Silent fail — browser will have shown nothing; a console log is enough
      console.error('[ProjectDocuments] Preview failed for', doc.storagePath)
    } finally {
      setPreviewingId(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-archai-graphite px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-white">Documents</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              All documents uploaded to this project
            </p>
          </div>
          <ProjectDocumentUploader
            projectId={projectId}
            onDocumentUploaded={handleDocumentUploaded}
            buttonLabel="Upload Documents"
            compact
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {deleteError && (
          <p className="mb-3 text-xs text-red-400">{deleteError}</p>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-lg border border-archai-graphite bg-archai-black/40 animate-pulse" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-xl border border-archai-graphite flex items-center justify-center mb-4">
              <FileText className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground mb-1">No documents yet</p>
            <p className="text-xs text-muted-foreground/60 mb-6">
              Upload zoning codes, briefs, and project documents to the project library.
            </p>
            <ProjectDocumentUploader
              projectId={projectId}
              onDocumentUploaded={handleDocumentUploaded}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="group flex items-center gap-3 rounded-lg border border-archai-graphite bg-archai-black/40 px-3 py-2.5 hover:bg-archai-charcoal transition-colors"
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{doc.fileName}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}
                    {' · '}
                    {new Date(doc.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={cn(
                  'text-[10px] border rounded-full px-2 py-0.5 shrink-0',
                  doc.documentType === 'zoning_code'
                    ? 'border-archai-amber/30 text-archai-amber'
                    : 'border-archai-graphite text-muted-foreground',
                )}>
                  {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}
                </span>
                {/* Preview — opens signed URL in new tab */}
                <button
                  type="button"
                  aria-label={`Preview ${doc.fileName}`}
                  disabled={previewingId === doc.id || Boolean(deletingId)}
                  onClick={() => void handlePreview(doc)}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-sky-400 hover:bg-sky-900/20 transition-colors"
                >
                  {previewingId === doc.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ExternalLink className="h-3.5 w-3.5" />}
                </button>
                {/* Delete */}
                <button
                  type="button"
                  aria-label={`Delete ${doc.fileName}`}
                  disabled={Boolean(deletingId) || Boolean(previewingId)}
                  onClick={() => void handleDelete(doc)}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-900/20 transition-colors"
                >
                  {deletingId === doc.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}

            <div className="pt-3">
              <ProjectDocumentUploader
                projectId={projectId}
                onDocumentUploaded={handleDocumentUploaded}
                buttonLabel="Upload More Documents"
                compact
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
