'use client'

import { useRef, useState } from 'react'
import { FileText, Loader2, Trash2, UploadCloud, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { registerDocument } from '@/lib/precheck/api'
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
  runId: string
  onDocumentsReady: (documentIds: string[]) => Promise<void>
  /** Already-persisted documents for this run — shown on reload. */
  existingDocuments?: UploadedDocument[]
  isLoading?: boolean
  onDeleteDocument?: (documentId: string) => Promise<void>
}

export function DocumentUploadPanel({
  runId,
  onDocumentsReady,
  existingDocuments = [],
  isLoading,
  onDeleteDocument,
}: DocumentUploadPanelProps) {
  const [pending,            setPending]            = useState<PendingEntry[]>([])
  const [dragging,           setDragging]           = useState(false)
  const [submitting,         setSubmitting]         = useState(false)
  const [uploadError,        setUploadError]        = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [deletingId,         setDeletingId]         = useState<string | null>(null)

  // Ref used to programmatically open the OS file picker.
  // Using a hidden input (not sr-only) prevents the browser from scrolling the
  // ScrollArea viewport to the 1px absolutely-positioned sr-only element on focus,
  // which was causing the entire Setup section to appear to disappear.
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
    // Reset value so the same file can be re-selected in a subsequent pick
    e.target.value = ''
  }

  function updateDocType(localId: string, type: DocType) {
    setPending((prev) => prev.map((d) => d.localId === localId ? { ...d, type } : d))
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
    if (pending.length === 0) return
    setSubmitting(true)
    setUploadError(null)

    try {
      const supabase = getSupabaseBrowserClient()
      const registeredIds: string[] = []

      for (const doc of pending) {
        // 1. Upload file bytes to Supabase Storage (browser → storage, uses anon key + bucket policy)
        const storagePath = `runs/${runId}/${crypto.randomUUID()}-${doc.name}`
        const { error: storageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, doc.file, {
            contentType: doc.file.type || 'application/octet-stream',
            upsert: false,
          })

        if (storageError) {
          throw new Error(`Upload failed for "${doc.name}": ${storageError.message}`)
        }

        // 2. Register document metadata with backend — backend creates the uploaded_documents row
        const registered = await registerDocument({
          runId,
          storagePath,
          fileName: doc.name,
          mimeType: doc.file.type || 'application/octet-stream',
          documentType: doc.type,
        })

        registeredIds.push(String(registered.id))
      }

      // 3. Trigger text extraction + chunking for all registered documents
      await onDocumentsReady(registeredIds)
      setPending([])
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = isLoading || submitting

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

      {/* Persisted documents — shown after reload, read-only */}
      {existingDocuments.length > 0 && (
        <div className="space-y-1">
          {existingDocuments.map((doc) => {
            const docId = String(doc.id)
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
                      onClick={() => handleDeleteDoc(docId)}
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

      {/*
        Drop zone — implemented as a <div role="button"> rather than a <label> wrapping
        an sr-only <input>.

        The old <label> + sr-only pattern placed the input with `position: absolute;
        margin: -1px` in the DOM. When the browser focused the input (on label click)
        it scrolled the Radix ScrollArea viewport to show the element, instantly
        jumping scroll position and making the Setup section appear to vanish.

        Fix: input is display:none (className="hidden"), opened programmatically via
        fileInputRef. The drag-and-drop path is unchanged.
      */}
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

      {/* Pending (not-yet-uploaded) files with type selector */}
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

      {pending.length > 0 && (
        <Button variant="archai" size="sm" className="w-full" onClick={handleSubmit} disabled={disabled}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
          {submitting ? 'Uploading…' : `Ingest ${pending.length} Document${pending.length !== 1 ? 's' : ''}`}
        </Button>
      )}
    </div>
  )
}
