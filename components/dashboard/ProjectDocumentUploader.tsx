'use client'

import { useRef, useState } from 'react'
import { FileText, Loader2, X, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { registerProjectDocument } from '@/lib/precheck/api'
import type { UploadedDocument } from '@/lib/precheck/types'

type DocType = 'zoning_code' | 'building_code' | 'project_doc' | 'other'

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

interface ProjectDocumentUploaderProps {
  projectId: string
  /** Called after each document is successfully registered. */
  onDocumentUploaded: (doc: UploadedDocument) => void
  /** Optional label override for the button. Defaults to "Upload Documents". */
  buttonLabel?: string
  /** Compact mode — hides the drop zone text, only shows button to open file picker. */
  compact?: boolean
}

export function ProjectDocumentUploader({
  projectId,
  onDocumentUploaded,
  buttonLabel = 'Upload Documents',
  compact = false,
}: ProjectDocumentUploaderProps) {
  const [pending,      setPending]      = useState<PendingEntry[]>([])
  const [dragging,     setDragging]     = useState(false)
  const [submitting,   setSubmitting]   = useState(false)
  const [uploadError,  setUploadError]  = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function addFiles(files: FileList | null) {
    if (!files) return
    const entries: PendingEntry[] = Array.from(files).map((f) => ({
      localId: crypto.randomUUID(),
      file: f,
      name: f.name,
      type: 'zoning_code' as DocType,
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

  async function handleSubmit() {
    if (pending.length === 0) return
    setSubmitting(true)
    setUploadError(null)

    try {
      const supabase = getSupabaseBrowserClient()

      for (const doc of pending) {
        // 1. Upload file to Supabase Storage under the project path (not run-scoped)
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

        // 2. Register document at the project level (no runId required)
        const registered = await registerProjectDocument({
          projectId,
          storagePath,
          fileName: doc.name,
          mimeType: doc.file.type || 'application/octet-stream',
          documentType: doc.type,
        })

        onDocumentUploaded(registered)
      }

      setPending([])
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = submitting

  if (compact) {
    return (
      <div className="space-y-2">
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

        {pending.length === 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            <UploadCloud className="h-3.5 w-3.5" />
            {buttonLabel}
          </Button>
        ) : (
          <div className="space-y-2">
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
            {uploadError && <p className="text-[11px] text-red-400 leading-snug">{uploadError}</p>}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => { setPending([]); setUploadError(null) }}
                disabled={disabled}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="archai"
                size="sm"
                className="flex-1"
                onClick={handleSubmit}
                disabled={disabled}
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
                {submitting ? 'Uploading…' : `Upload ${pending.length}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Full drop-zone variant
  return (
    <div className="space-y-3">
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
        <UploadCloud className="h-6 w-6 text-muted-foreground" />
        <p className="text-xs text-muted-foreground text-center">
          Drop zoning codes, building codes, or project docs
          <br />
          <span className="text-[10px] opacity-60">PDF, TXT, DOCX</span>
        </p>
      </div>

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
          {submitting ? 'Uploading…' : `Upload ${pending.length} Document${pending.length !== 1 ? 's' : ''}`}
        </Button>
      )}
    </div>
  )
}
