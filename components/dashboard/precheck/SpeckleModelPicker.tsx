'use client'

import { useState } from 'react'
import { Box, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SyncSpeckleModelInput } from '@/lib/precheck/types'

interface SpeckleModelPickerProps {
  runId:     string
  onSync:    (input: SyncSpeckleModelInput) => Promise<void>
  isLoading?: boolean
}

export function SpeckleModelPicker({ runId, onSync, isLoading }: SpeckleModelPickerProps) {
  const [streamId,   setStreamId]   = useState('')
  const [versionId,  setVersionId]  = useState('')
  const [branchName, setBranchName] = useState('')
  const [modelName,  setModelName]  = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!streamId.trim() || !versionId.trim()) return
    setSubmitting(true)
    try {
      await onSync({
        runId,
        streamId:   streamId.trim(),
        versionId:  versionId.trim(),
        branchName: branchName.trim() || undefined,
        modelName:  modelName.trim()  || undefined,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = isLoading || submitting

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-archai-graphite bg-archai-charcoal p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Box className="h-4 w-4 text-archai-orange" />
        <p className="text-sm font-medium text-white">Speckle Model</p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Stream ID <span className="text-archai-orange">*</span>
          </label>
          <Input
            placeholder="abc123def456…"
            value={streamId}
            onChange={(e) => setStreamId(e.target.value)}
            className="bg-archai-black border-archai-graphite text-sm h-8 font-mono"
            required
            disabled={disabled}
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
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Branch</label>
            <Input
              placeholder="main"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              className="bg-archai-black border-archai-graphite text-sm h-8"
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Model Name</label>
            <Input
              placeholder="Tower Option A"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="bg-archai-black border-archai-graphite text-sm h-8"
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      <Button
        type="submit"
        variant="archai"
        size="sm"
        className="w-full"
        disabled={!streamId.trim() || !versionId.trim() || disabled}
      >
        {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
        {submitting ? 'Syncing Model…' : 'Sync Speckle Model'}
      </Button>

      {/* SPECKLE VIEWER WILL BE MOUNTED HERE */}
    </form>
  )
}
