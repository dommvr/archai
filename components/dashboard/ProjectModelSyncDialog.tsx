'use client'

import { useState } from 'react'
import { Box, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import * as precheckApi from '@/lib/precheck/api'
import type { SpeckleModelRef } from '@/lib/precheck/types'

interface ProjectModelSyncDialogProps {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a model is successfully synced. */
  onSynced: (ref: SpeckleModelRef) => void
}

export function ProjectModelSyncDialog({
  projectId,
  open,
  onOpenChange,
  onSynced,
}: ProjectModelSyncDialogProps) {
  const [streamId,   setStreamId]   = useState('')
  const [versionId,  setVersionId]  = useState('')
  const [branchName, setBranchName] = useState('')
  const [modelName,  setModelName]  = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  function resetForm() {
    setStreamId('')
    setVersionId('')
    setBranchName('')
    setModelName('')
    setError(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm()
    onOpenChange(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!streamId.trim() || !versionId.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const ref = await precheckApi.syncProjectModel({
        projectId,
        streamId:   streamId.trim(),
        versionId:  versionId.trim(),
        branchName: branchName.trim() || undefined,
        modelName:  modelName.trim()  || undefined,
      })
      resetForm()
      onOpenChange(false)
      onSynced(ref)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync model.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Box className="h-4 w-4 text-archai-orange" />
            <DialogTitle className="text-base">Add Speckle Model</DialogTitle>
          </div>
          <DialogDescription>
            Link a Speckle model version to this project. The model will be available for
            all precheck runs and the project viewer.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Speckle Project ID <span className="text-archai-orange">*</span>
            </label>
            <Input
              placeholder="abc123def456…"
              value={streamId}
              onChange={(e) => setStreamId(e.target.value)}
              className="bg-archai-black border-archai-graphite text-sm h-8 font-mono"
              required
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Version ID <span className="text-archai-orange">*</span>
            </label>
            <Input
              placeholder="commit hash…"
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              className="bg-archai-black border-archai-graphite text-sm h-8 font-mono"
              required
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Branch
              </label>
              <Input
                placeholder="main"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="bg-archai-black border-archai-graphite text-sm h-8"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Model Name
              </label>
              <Input
                placeholder="Tower Option A"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                className="bg-archai-black border-archai-graphite text-sm h-8"
                disabled={submitting}
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="archai"
              size="sm"
              className="flex-1"
              disabled={!streamId.trim() || !versionId.trim() || submitting}
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
              {submitting ? 'Adding…' : 'Add Model'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
