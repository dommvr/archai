'use client'

import { useState, useRef, useCallback } from 'react'
import { Send, Paperclip, Loader2, X, Image } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface StagedAttachment {
  /** Local object URL for preview (revoked after upload). */
  previewUrl: string
  file: File
  /** Set after upload completes. */
  attachmentId?: string
}

interface CopilotComposerProps {
  onSend: (content: string, attachmentIds: string[]) => void
  disabled: boolean
  sending: boolean
  projectId: string
  threadId: string | null
}

export function CopilotComposer({
  onSend,
  disabled,
  sending,
  projectId,
  threadId,
}: CopilotComposerProps) {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // threadId may be null when no thread exists — sendMessage auto-creates one
  const canSend = input.trim().length > 0 && !disabled && !sending

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault()
      if (!canSend) return

      const readyAttachmentIds = attachments
        .filter((a) => a.attachmentId)
        .map((a) => a.attachmentId!)

      onSend(input.trim(), readyAttachmentIds)
      setInput('')
      setAttachments([])
      setUploadError(null)

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    },
    [canSend, input, attachments, onSend]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    // Auto-expand: min 4 lines (~80px), max 8 lines (~192px)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(Math.max(e.target.scrollHeight, 80), 192)}px`
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length || !threadId) return

    setUploadError(null)

    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        setUploadError(`${file.name} exceeds 10 MB limit`)
        continue
      }

      const previewUrl = URL.createObjectURL(file)
      const staged: StagedAttachment = { previewUrl, file }
      setAttachments((prev) => [...prev, staged])

      // Upload in the background
      uploadAttachment(file, previewUrl, threadId, projectId).then((attachmentId) => {
        setAttachments((prev) =>
          prev.map((a) =>
            a.previewUrl === previewUrl ? { ...a, attachmentId } : a
          )
        )
        URL.revokeObjectURL(previewUrl)
      }).catch(() => {
        setUploadError(`Failed to upload ${file.name}`)
        setAttachments((prev) => prev.filter((a) => a.previewUrl !== previewUrl))
        URL.revokeObjectURL(previewUrl)
      })
    }

    // Reset the file input so the same file can be selected again
    e.target.value = ''
  }

  const removeAttachment = (previewUrl: string) => {
    setAttachments((prev) => prev.filter((a) => a.previewUrl !== previewUrl))
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="shrink-0 border-t border-archai-graphite p-3 space-y-2"
    >
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <AttachmentChip
              key={att.previewUrl}
              attachment={att}
              onRemove={() => removeAttachment(att.previewUrl)}
            />
          ))}
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <p className="text-[10px] text-red-400">{uploadError}</p>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        {/* Attachment button */}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-white self-end"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || !threadId}
          aria-label="Attach file"
          title={!threadId ? 'Send a message to start a conversation first' : 'Attach file or image'}
        >
          <Paperclip className="h-3.5 w-3.5" />
        </Button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf,.txt,.md,.csv"
          multiple
          className="sr-only"
          onChange={handleFileSelect}
          aria-hidden="true"
        />

        {/* TODO: Screenshot/snip button — captures viewer or screen region.
            Implement when Speckle viewer is mounted and browser capture API
            integration is scoped. See CopilotScreenshotButton placeholder below. */}

        {/* Text input — min 4 rows so it feels spacious from the start */}
        <textarea
          ref={textareaRef}
          rows={4}
          placeholder="Ask your Copilot… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className={cn(
            'flex-1 min-h-[80px] max-h-48 resize-none overflow-y-auto',
            'rounded-md border border-archai-graphite bg-archai-black/60',
            'px-3 py-2 text-xs text-white placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-1 focus:ring-archai-orange/40',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        />

        {/* Send button */}
        <Button
          type="submit"
          size="icon"
          variant="archai"
          className="h-8 w-8 shrink-0 self-end"
          disabled={!canSend}
          aria-label="Send message"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </form>
  )
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: StagedAttachment
  onRemove: () => void
}) {
  const isImage = attachment.file.type.startsWith('image/')
  const isReady = Boolean(attachment.attachmentId)

  return (
    <div
      className={cn(
        'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border',
        isReady
          ? 'border-archai-orange/30 text-archai-orange/80'
          : 'border-archai-graphite text-muted-foreground/60'
      )}
    >
      {isImage ? (
        <Image className="h-2.5 w-2.5" />
      ) : (
        <Paperclip className="h-2.5 w-2.5" />
      )}
      <span className="max-w-[100px] truncate">{attachment.file.name}</span>
      {!isReady && <Loader2 className="h-2 w-2 animate-spin ml-0.5" />}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 text-muted-foreground/40 hover:text-white transition-colors"
        aria-label={`Remove ${attachment.file.name}`}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

/**
 * Uploads a file attachment to the backend.
 * Returns the attachment ID on success.
 *
 * Flow:
 *   1. POST /api/copilot/threads/[id]/attachments?action=upload-url
 *      → get signed Supabase Storage upload URL + attachmentId
 *   2. PUT to the signed URL with the raw file bytes
 *   3. Return the attachmentId for use in SendMessageRequest
 *
 * TODO: Step 2 requires the "copilot-attachments" Supabase Storage bucket
 * to be created. Until the bucket exists, the signed URL will be a placeholder
 * and uploads will fail. The attachment chip will remain in "uploading" state.
 */
async function uploadAttachment(
  file: File,
  _previewUrl: string,
  threadId: string,
  projectId: string
): Promise<string> {
  const attachmentType = file.type.startsWith('image/')
    ? 'image'
    : 'document'

  // Step 1: Get signed upload URL
  const metaRes = await fetch(
    `/api/copilot/threads/${threadId}/attachments?action=upload-url`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        filename:       file.name,
        mimeType:       file.type,
        attachmentType,
        fileSizeBytes:  file.size,
      }),
    }
  )

  if (!metaRes.ok) {
    throw new Error(`Failed to get upload URL (${metaRes.status})`)
  }

  const { uploadUrl, attachmentId } = (await metaRes.json()) as {
    uploadUrl: string
    attachmentId: string
  }

  // Step 2: Upload to Supabase Storage
  // TODO: uploadUrl will be a placeholder until the storage bucket is created.
  if (uploadUrl.startsWith('__TODO_STORAGE_SIGNED_URL__')) {
    // Return the ID anyway so the metadata row exists — file bytes not stored yet
    return attachmentId
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })

  if (!uploadRes.ok) {
    throw new Error(`Storage upload failed (${uploadRes.status})`)
  }

  return attachmentId
}
