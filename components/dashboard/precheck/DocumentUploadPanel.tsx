'use client'

import { useState } from 'react'
import { FileText, Loader2, UploadCloud, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type DocType = 'zoning_code' | 'building_code' | 'project_doc' | 'other'

interface DocEntry {
  id: string
  name: string
  type: DocType
}

const DOC_TYPE_LABELS: Record<DocType, string> = {
  zoning_code:   'Zoning Code',
  building_code: 'Building Code',
  project_doc:   'Project Doc',
  other:         'Other',
}

interface DocumentUploadPanelProps {
  runId: string
  onDocumentsReady: (documentIds: string[]) => Promise<void>
  isLoading?: boolean
}

export function DocumentUploadPanel({ runId: _runId, onDocumentsReady, isLoading }: DocumentUploadPanelProps) {
  const [docs,       setDocs]       = useState<DocEntry[]>([])
  const [dragging,   setDragging]   = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function addFiles(files: FileList | null) {
    if (!files) return
    const entries: DocEntry[] = Array.from(files).map((f) => ({
      id:   crypto.randomUUID(),
      name: f.name,
      type: 'zoning_code',
    }))
    setDocs((prev) => [...prev, ...entries])
  }

  async function handleSubmit() {
    if (docs.length === 0) return
    setSubmitting(true)
    try {
      // FASTAPI CALL PLACEHOLDER — Supabase Storage upload + chunking + embedding pipeline
      await onDocumentsReady(docs.map((d) => d.id))
      setDocs([])
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = isLoading || submitting

  return (
    <div className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-archai-orange" />
        <p className="text-sm font-medium text-white">Zoning Documents</p>
      </div>

      {/* Drop zone */}
      <label
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-6 cursor-pointer transition-colors',
          dragging
            ? 'border-archai-orange bg-archai-orange/5'
            : 'border-archai-graphite hover:border-archai-orange/40 hover:bg-archai-graphite/10',
          disabled && 'pointer-events-none opacity-50',
        )}
        onDragOver={(e)  => { e.preventDefault(); setDragging(true)  }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e)      => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
      >
        <input
          type="file"
          multiple
          accept=".pdf,.txt,.docx"
          className="sr-only"
          onChange={(e) => addFiles(e.target.files)}
          disabled={disabled}
        />
        <UploadCloud className="h-6 w-6 text-muted-foreground" />
        <p className="text-xs text-muted-foreground text-center">
          Drop zoning codes, building codes, or project docs
          <br />
          <span className="text-[10px] opacity-60">PDF, TXT, DOCX</span>
        </p>
      </label>

      {/* File list */}
      {docs.length > 0 && (
        <div className="space-y-1.5">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2 rounded-lg bg-archai-black border border-archai-graphite/50 px-3 py-2">
              <FileText className="h-3.5 w-3.5 text-archai-orange/60 shrink-0" />
              <span className="flex-1 text-xs text-white truncate">{doc.name}</span>
              <span className="text-[10px] text-muted-foreground/60 shrink-0">{DOC_TYPE_LABELS[doc.type]}</span>
              <button
                type="button"
                onClick={() => setDocs((prev) => prev.filter((d) => d.id !== doc.id))}
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

      {docs.length > 0 && (
        <Button variant="archai" size="sm" className="w-full" onClick={handleSubmit} disabled={disabled}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
          {submitting ? 'Uploading…' : `Ingest ${docs.length} Document${docs.length !== 1 ? 's' : ''}`}
        </Button>
      )}
    </div>
  )
}
