'use client'

import { useState } from 'react'
import { Play, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface CreatePrecheckRunDialogProps {
  open:           boolean
  onOpenChange:   (open: boolean) => void
  projectId:      string
  userId:         string
  onCreate:       (projectId: string, userId: string) => Promise<void>
}

export function CreatePrecheckRunDialog({
  open,
  onOpenChange,
  projectId,
  userId,
  onCreate,
}: CreatePrecheckRunDialogProps) {
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    setLoading(true)
    try {
      await onCreate(projectId, userId)
      onOpenChange(false)
    } catch (err) {
      console.error('[CreatePrecheckRunDialog] Failed to create run:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Zoning &amp; Code Check</DialogTitle>
          <DialogDescription>
            Start a permit pre-check run for this project. You will walk through site data ingestion,
            document upload, AI rule extraction, Speckle model sync, and compliance evaluation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-archai-charcoal border border-archai-graphite p-3 space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Project ID</p>
            <p className="text-xs font-mono text-white truncate">{projectId}</p>
          </div>

          <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
            <li>Ingest site context — address, zoning district, parcel data</li>
            <li>Process zoning and building code documents</li>
            <li>Extract compliance rules via AI (LangGraph)</li>
            <li>Sync Speckle model geometry and compute metrics</li>
            <li>Evaluate compliance and produce a readiness score</li>
          </ul>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="archai" size="sm" onClick={handleCreate} disabled={loading}>
            {loading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
              : <Play    className="h-3.5 w-3.5 mr-2" />
            }
            {loading ? 'Creating…' : 'Start Check'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
