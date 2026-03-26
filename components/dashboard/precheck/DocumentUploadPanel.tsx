'use client'

import { useRef, useState, useEffect } from 'react'
import { FileText, Loader2, Trash2, UploadCloud, X, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { registerProjectDocument } from '@/lib/precheck/api'
import * as precheckApi from '@/lib/precheck/api'
import type { UploadedDocument } from '@/lib/precheck/types'

type DocType = 'zoning_code' | 'building_code' | 'project_doc' | 'other'

/** A file the user has selected but not yet uploaded. */
interface PendingEntry {
  localId: string
  file: File
  name: string
  type: DocType
}

const DOC_TYPE_LABELS: Record<DocType, string> = {
  zoning_code:   'Zoning Code',
  building_code: 'Building Code',
  project_doc:   'Project Doc',
  other:         'Other',
}

// Matches DOCUMENTS_STORAGE_BUCKET in backend/app/core/config.py
const STORAGE_BUCKET = 'precheck-documents'

interface DocumentUploadPanelProps {
  /** projectId is required — documents are now stored project-scoped, not run-scoped. */
  projectId: string
  onDocumentsReady: (documentIds: string[]) => Promise<void>
  /** Already-persisted documents selected for this run — shown on reload. */
  existingDocuments?: UploadedDocument[]
  isLoading?: boolean
  onDeleteDocument?: (documentId: string) => Promise<void>
  /** Called whenever the number of selected project-library docs changes. */
  onSelectionChange?: (count: number) => void
}

export function DocumentUploadPanel({
  projectId,
  onDocumentsReady,
  existingDocuments = [],
  isLoading,
  onDeleteDocument,
  onSelectionChange,
}: DocumentUploadPanelProps) {
  const [pending,            setPending]            = useState<PendingEntry[]>([])
  const [dragging,           setDragging]           = useState(false)
  const [submitting,         setSubmitting]         = useState(false)
  const [uploadError,        setUploadError]        = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [deletingId,         setDeletingId]         = useState<string | null>(null)

  // Project library — all docs uploaded to this project
  const [projectDocs,    setProjectDocs]    = useState<UploadedDocument[]>([])
  const [loadingLib,     setLoadingLib]     = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set())

  // Pre-select any already-registered run docs
  useEffect(() => {
    setSelectedDocIds(new Set(existingDocuments.map((d) => d.id)))
  }, [existingDocuments])

  // Notify parent of selection count changes so PrecheckProgressCard can reflect
  // docs selected-but-not-yet-ingested in the hasDocuments readiness signal.
  useEffect(() => {
    onSelectionChange?.(selectedDocIds.size)
  }, [selectedDocIds, onSelectionChange])

  // Load project-level document library (excluding already-selected docs)
  useEffect(() => {
    let cancelled = false
    setLoadingLib(true)
    precheckApi.listProjectDocuments(projectId)
      .then(({ documents }) => {
        if (cancelled) return
        setProjectDocs(documents)
        setLoadingLib(false)
      })
      .catch(() => { if (!cancelled) setLoadingLib(false) })
    return () => { cancelled = true }
  }, [projectId])

  // Ref used to programmatically open the OS file picker.
  const fileInputRef = useRef<HTMLInputElement>(null)

  function addFiles(files: FileList | null) {
    if (!files) return
    const entries: PendingEntry[] = Array.from(files).map((f) => ({
      localId: crypto.randomUUID(),
      file: f,
      name: f.name,
      type: 'zoning_code',
    }))
    setPending((prev) => [...prev, ...entries])
    setUploadError(null)
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files)
    e.target.value = ''
  }

  function updateDocType(localId: string, type: DocType) {
    setPending((prev) => prev.map((d) => d.localId === localId ? { ...d, type } : d))
  }

  function toggleProjectDoc(docId: string) {
    setSelectedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  async function handleDeleteDoc(docId: string) {
    if (!onDeleteDocument) return
    setDeletingId(docId)
    try {
      await onDeleteDocument(docId)
    } finally {
      setDeletingId(null)
      setConfirmingDeleteId(null)
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    setUploadError(null)

    try {
      const supabase = getSupabaseBrowserClient()
      const newlyRegisteredIds: string[] = []

      // 1. Upload and register any newly-staged local files
      for (const doc of pending) {
        const storagePath = `projects/${projectId}/${crypto.randomUUID()}-${doc.name}`
        const { error: storageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, doc.file, {
            contentType: doc.file.type || 'application/octet-stream',
            upsert: false,
          })

        if (storageError) {
          throw new Error(`Upload failed for "${doc.name}": ${storageError.message}`)
        }

        const registered = await registerProjectDocument({
          projectId,
          storagePath,
          fileName: doc.name,
          mimeType: doc.file.type || 'application/octet-stream',
          documentType: doc.type,
        })

        newlyRegisteredIds.push(registered.id)
        setProjectDocs((prev) => [registered, ...prev])
        setSelectedDocIds((prev) => new Set([...prev, registered.id]))
      }

      // 2. Collect all IDs to associate with the run:
      //    - newly uploaded files (need full ingest: chunk + associate)
      //    - existing project-library docs toggled by the user (need only run association;
      //      the backend skips re-chunking if chunks already exist)
      // Use pendingLibraryIds (already filtered to exclude existing run docs) so we never
      // accidentally re-submit docs that are already registered for this run.
      const existingSelectedIds = pendingLibraryIds.filter(
        (id) => !newlyRegisteredIds.includes(id)
      )
      const allIds = [...newlyRegisteredIds, ...existingSelectedIds]

      if (allIds.length === 0) return

      // 3. Trigger ingest (backend stamps run_id + chunks new docs, reuses chunks for existing)
      await onDocumentsReady(allIds)
      setPending([])
      // Clear the library selection — these docs are now registered to the run
      // and will appear in existingDocuments on next details reload.
      setSelectedDocIds(new Set())
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = isLoading || submitting

  // IDs that are selected in the library but NOT yet registered to the run.
  // existingDocuments holds the already-ingested docs, so we subtract them.
  // This prevents "Add 1 Doc to Run" appearing when the only selected IDs
  // are docs that are already part of the run.
  const existingDocIdSet = new Set(existingDocuments.map((d) => d.id))
  const pendingLibraryIds = Array.from(selectedDocIds).filter((id) => !existingDocIdSet.has(id))
  const pendingLibraryCount = pendingLibraryIds.length

  const canSubmit = pending.length > 0 || pendingLibraryCount > 0

  // Determine button label based on what action is actually happening:
  //   - new local files → "Upload & Ingest" (full pipeline)
  //   - only existing project-library docs selected → "Add to Run" (associate + reuse chunks)
  const totalCount = pending.length + pendingLibraryCount
  const submitLabel = submitting
    ? (pending.length > 0 ? 'Uploading…' : 'Adding to run…')
    : pending.length > 0
      ? `Upload & Ingest ${totalCount} Doc${totalCount !== 1 ? 's' : ''}`
      : `Add ${pendingLibraryCount} Doc${pendingLibraryCount !== 1 ? 's' : ''} to Run`

  // Project docs not yet registered for the current run
  const unselectedProjectDocs = projectDocs.filter((d) => !existingDocuments.some((e) => e.id === d.id))

  return (
    <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-archai-orange" />
          <p className="text-sm font-medium text-white">Zoning Documents</p>
        </div>
        {existingDocuments.length > 0 && (
          <span className="text-[10px] text-emerald-400 font-medium">
            {existingDocuments.length} registered
          </span>
        )}
      </div>

      {/* Persisted run documents — shown after reload, with optional delete */}
      {existingDocuments.length > 0 && (
        <div className="space-y-1">
          {existingDocuments.map((doc) => {
            const docId = doc.id
            const isConfirming = confirmingDeleteId === docId
            const isDeleting   = deletingId === docId
            return (
              <div
                key={docId}
                className="flex items-center gap-2 rounded-lg bg-archai-black/60 border border-archai-graphite/30 px-3 py-1.5"
              >
                <FileText className="h-3 w-3 text-emerald-400/60 shrink-0" />
                <span className="flex-1 text-xs text-white/70 truncate">{doc.fileName}</span>
                {isConfirming ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleDeleteDoc(docId)}
                      disabled={isDeleting}
                      className="text-[10px] font-medium text-red-400 hover:text-red-300 transition-colors"
                      aria-label={`Confirm delete ${doc.fileName}`}
                    >
                      {isDeleting ? '…' : 'Delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      disabled={isDeleting}
                      className="text-[10px] text-muted-foreground hover:text-white transition-colors"
                      aria-label="Cancel delete"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="text-[10px] text-muted-foreground/50 shrink-0">
                      {DOC_TYPE_LABELS[doc.documentType as DocType] ?? doc.documentType}
                    </span>
                    {onDeleteDocument && (
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(docId)}
                        disabled={disabled}
                        className="text-muted-foreground/30 hover:text-red-400 transition-colors shrink-0"
                        aria-label={`Delete ${doc.fileName}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Project library — select existing project docs for this run */}
      {!loadingLib && unselectedProjectDocs.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Project Library
          </p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {unselectedProjectDocs.map((doc) => {
              const isSelected = selectedDocIds.has(doc.id)
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => toggleProjectDoc(doc.id)}
                  disabled={disabled}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors border',
                    isSelected
                      ? 'border-archai-orange/30 bg-archai-orange/5'
                      : 'border-archai-graphite/30 bg-archai-black/40 hover:bg-archai-graphite/20',
                  )}
                >
                  {isSelected
                    ? <CheckCircle2 className="h-3 w-3 text-archai-orange shrink-0" />
                    : <FileText className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  }
                  <span className="flex-1 text-xs text-white/70 truncate">{doc.fileName}</span>
                  <span className="text-[10px] text-muted-foreground/50 shrink-0">
                    {DOC_TYPE_LABELS[doc.documentType as DocType] ?? doc.documentType}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload documents"
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-6 cursor-pointer transition-colors',
          dragging
            ? 'border-archai-orange bg-archai-orange/5'
            : 'border-archai-graphite hover:border-archai-orange/40 hover:bg-archai-graphite/10',
          disabled && 'pointer-events-none opacity-50',
        )}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
        onDragOver={(e)  => { e.preventDefault(); setDragging(true)  }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e)      => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.docx"
          className="hidden"
          onChange={handleFileInputChange}
          disabled={disabled}
          aria-hidden="true"
          tabIndex={-1}
        />
        <UploadCloud className="h-6 w-6 text-muted-foreground" />
        <p className="text-xs text-muted-foreground text-center">
          {existingDocuments.length > 0 ? 'Add more documents' : 'Drop zoning codes, building codes, or project docs'}
          <br />
          <span className="text-[10px] opacity-60">PDF, TXT, DOCX</span>
        </p>
      </div>

      {/* Pending files with type selector */}
      {pending.length > 0 && (
        <div className="space-y-1.5">
          {pending.map((doc) => (
            <div key={doc.localId} className="flex items-center gap-2 rounded-lg bg-archai-black border border-archai-graphite/50 px-3 py-2">
              <FileText className="h-3.5 w-3.5 text-archai-orange/60 shrink-0" />
              <span className="flex-1 text-xs text-white truncate">{doc.name}</span>
              <select
                value={doc.type}
                onChange={(e) => updateDocType(doc.localId, e.target.value as DocType)}
                className="shrink-0 bg-archai-graphite border border-archai-graphite/80 text-[10px] text-muted-foreground rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-archai-orange/50"
                disabled={disabled}
                aria-label={`Document type for ${doc.name}`}
              >
                {(Object.entries(DOC_TYPE_LABELS) as [DocType, string][]).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setPending((prev) => prev.filter((d) => d.localId !== doc.localId))}
                className="text-muted-foreground hover:text-white transition-colors shrink-0"
                aria-label={`Remove ${doc.name}`}
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {uploadError && (
        <p className="text-[11px] text-red-400 leading-snug">{uploadError}</p>
      )}

      {canSubmit && (
        <Button variant="archai" size="sm" className="w-full" onClick={handleSubmit} disabled={disabled}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
          {submitLabel}
        </Button>
      )}
    </div>
  )
}
