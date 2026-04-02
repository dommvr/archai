'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Send, Paperclip, Loader2, X, Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PendingAttachmentMeta } from '@/types'

interface StagedAttachment {
  /** Local object URL for preview (revoked after upload). */
  previewUrl: string
  file: File
  /** Set after upload completes. */
  attachmentId?: string
}

interface CopilotComposerProps {
  onSend: (content: string, attachmentIds: string[], pendingAttachments: PendingAttachmentMeta[]) => void
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

      const readyAttachments = attachments.filter((a) => a.attachmentId)
      const readyAttachmentIds = readyAttachments.map((a) => a.attachmentId!)
      const pendingMeta: PendingAttachmentMeta[] = readyAttachments.map((a) => ({
        attachmentId: a.attachmentId!,
        filename: a.file.name,
        mimeType: a.file.type,
        // Pass the previewUrl — it must stay valid until the send response
        // replaces the optimistic message with a server-issued signed URL.
        previewUrl: a.previewUrl,
        isImage: a.file.type.startsWith('image/'),
      }))

      // Call onSend — previewUrls stay alive in the optimistic message until the
      // server response replaces them with signed URLs. The browser GCs the blob
      // references once the optimistic message is replaced and nothing holds them.
      onSend(input.trim(), readyAttachmentIds, pendingMeta)

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

      // Upload in the background.
      // Do NOT revoke previewUrl here — it must stay valid for the optimistic
      // message thumbnail until the send response replaces it with a signed URL.
      // Revocation happens in handleSubmit after onSend is called.
      uploadAttachment(file, previewUrl, threadId, projectId).then((attachmentId) => {
        setAttachments((prev) =>
          prev.map((a) =>
            a.previewUrl === previewUrl ? { ...a, attachmentId } : a
          )
        )
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
            <StagedAttachmentPreview
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

        {/* Screenshot button — captures the browser tab using getDisplayMedia
            with preferCurrentTab:true (no OS screen picker, tab-only). */}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-white self-end"
          onClick={() => captureTabScreenshot(threadId, projectId, setAttachments, setUploadError)}
          disabled={disabled || !threadId}
          aria-label="Capture screenshot"
          title={!threadId ? 'Send a message to start a conversation first' : 'Attach a screenshot of the current view'}
        >
          <Camera className="h-3.5 w-3.5" />
        </Button>

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

/**
 * Previews a staged (pre-send) attachment in the composer.
 *
 * Images: show a 56×56 thumbnail with a click-to-enlarge lightbox.
 *         A spinning overlay indicates the upload is still in progress.
 * Files:  show a filename pill (same as before).
 *
 * The remove button always appears on hover.
 */
function StagedAttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: StagedAttachment
  onRemove: () => void
}) {
  const isImage = attachment.file.type.startsWith('image/')
  const isReady = Boolean(attachment.attachmentId)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  if (isImage) {
    return (
      <>
        <div className="relative group/thumb shrink-0">
          {/* Thumbnail — click to open lightbox */}
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className={cn(
              'relative w-14 h-14 rounded border overflow-hidden block',
              isReady
                ? 'border-archai-orange/30 hover:border-archai-orange/60'
                : 'border-archai-graphite',
              'transition-colors',
            )}
            aria-label={`Preview ${attachment.file.name}`}
            title={attachment.file.name}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.previewUrl}
              alt={attachment.file.name}
              className="w-full h-full object-cover"
            />
            {/* Uploading spinner overlay */}
            {!isReady && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <Loader2 className="h-3 w-3 text-white animate-spin" />
              </div>
            )}
          </button>

          {/* Remove button — top-right corner, visible on hover */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className={cn(
              'absolute -top-1 -right-1 w-4 h-4 rounded-full',
              'bg-archai-charcoal border border-archai-graphite',
              'flex items-center justify-center',
              'opacity-0 group-hover/thumb:opacity-100 transition-opacity',
              'text-muted-foreground/70 hover:text-white',
            )}
            aria-label={`Remove ${attachment.file.name}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>

        {/* Inline lightbox for this staged image */}
        {lightboxOpen && (
          <ComposerImageLightbox
            src={attachment.previewUrl}
            filename={attachment.file.name}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </>
    )
  }

  // Non-image: filename pill
  return (
    <div
      className={cn(
        'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border',
        isReady
          ? 'border-archai-orange/30 text-archai-orange/80'
          : 'border-archai-graphite text-muted-foreground/60'
      )}
    >
      <Paperclip className="h-2.5 w-2.5 shrink-0" />
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
 * Fullscreen lightbox for a composer-staged image (before send).
 * Identical behaviour to the one in CopilotMessageList but scoped here
 * so the two components remain independently maintainable.
 */
function ComposerImageLightbox({
  src,
  filename,
  onClose,
}: {
  src: string
  filename: string
  onClose: () => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${filename}`}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-1.5 rounded bg-archai-charcoal/80 text-white hover:text-archai-orange transition-colors"
        aria-label="Close preview"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex flex-col items-center gap-3 max-w-full max-h-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={filename}
          className="max-w-full max-h-[80vh] rounded shadow-2xl object-contain"
          onClick={(e) => e.stopPropagation()}
        />
        <p className="text-[10px] text-muted-foreground/70 truncate max-w-[300px]">
          {filename}
        </p>
      </div>
    </div>
  )
}

/**
 * Captures the current browser tab using getDisplayMedia with preferCurrentTab.
 * This captures only the app viewport — no OS-level screen picker appears.
 * The captured frame is drawn onto a canvas, converted to a PNG blob, and fed
 * into the existing uploadAttachment flow as a "screenshot" attachment type.
 *
 * Browser support: Chrome/Edge 107+ (preferCurrentTab). Falls back gracefully
 * with an error message if the API is unavailable or the user cancels.
 */
async function captureTabScreenshot(
  threadId: string | null,
  projectId: string,
  setAttachments: React.Dispatch<React.SetStateAction<StagedAttachment[]>>,
  setUploadError: React.Dispatch<React.SetStateAction<string | null>>,
): Promise<void> {
  if (!threadId) return
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setUploadError('Screenshot capture is not supported in this browser.')
    return
  }

  let stream: MediaStream | null = null
  try {
    // preferCurrentTab avoids the OS screen-picker and captures only this tab.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stream = await (navigator.mediaDevices as any).getDisplayMedia({
      video: { displaySurface: 'browser' },
      audio: false,
      // Chrome 107+: skip the picker and capture the current tab directly
      preferCurrentTab: true,
    } as DisplayMediaStreamOptions)
  } catch {
    // User cancelled or permission denied — not an error worth surfacing
    return
  }

  // stream is guaranteed non-null here (we returned above on catch)
  const activeStream = stream!

  try {
    const track = activeStream.getVideoTracks()[0]
    // ImageCapture gives us a single frame without needing a video element
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const capture = new (window as any).ImageCapture(track)
    const bitmap: ImageBitmap = await capture.grabFrame()

    const canvas = document.createElement('canvas')
    canvas.width  = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    bitmap.close()

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
    })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = new File([blob], `screenshot-${timestamp}.png`, { type: 'image/png' })
    const previewUrl = URL.createObjectURL(file)
    const staged: StagedAttachment = { previewUrl, file }
    setAttachments((prev) => [...prev, staged])

    uploadAttachment(file, previewUrl, threadId, projectId, 'screenshot')
      .then((attachmentId) => {
        setAttachments((prev) =>
          prev.map((a) => (a.previewUrl === previewUrl ? { ...a, attachmentId } : a))
        )
        // Do not revoke previewUrl here — stays valid for the optimistic thumbnail.
      })
      .catch(() => {
        setUploadError('Failed to upload screenshot')
        setAttachments((prev) => prev.filter((a) => a.previewUrl !== previewUrl))
        URL.revokeObjectURL(previewUrl)
      })
  } catch (err) {
    setUploadError(`Screenshot failed: ${err instanceof Error ? err.message : 'unknown error'}`)
  } finally {
    activeStream.getTracks().forEach((t) => t.stop())
  }
}

/**
 * Uploads a file attachment to the backend.
 * Returns the attachment ID on success.
 *
 * Flow:
 *   1. POST /api/copilot/threads/[id]/attachments?action=upload-url
 *      → get a Supabase Storage signed upload URL + attachmentId
 *   2. PUT to the signed URL with the raw file bytes (no auth header needed)
 *   3. Return the attachmentId for use in SendMessageRequest
 *
 * Requires the "copilot-attachments" bucket in Supabase Storage.
 * If the bucket does not exist, step 1 returns 503 with an actionable message.
 */
async function uploadAttachment(
  file: File,
  _previewUrl: string,
  threadId: string,
  projectId: string,
  forceType?: 'image' | 'document' | 'screenshot',
): Promise<string> {
  const attachmentType = forceType ?? (file.type.startsWith('image/') ? 'image' : 'document')

  // Step 1: Get signed upload URL
  const metaRes = await fetch(
    `/api/copilot/threads/${threadId}/attachments?action=upload-url`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId,
        projectId,
        filename:       file.name,
        mimeType:       file.type,
        attachmentType,
        fileSizeBytes:  file.size,
      }),
    }
  )

  if (!metaRes.ok) {
    let detail = `Failed to get upload URL (${metaRes.status})`
    // Surface bucket-not-configured error with an actionable message
    if (metaRes.status === 503) {
      try {
        const body = (await metaRes.json()) as { detail?: string }
        if (body.detail) detail = body.detail
      } catch { /* ignore parse error */ }
    }
    throw new Error(detail)
  }

  const { uploadUrl, attachmentId } = (await metaRes.json()) as {
    uploadUrl: string
    attachmentId: string
  }

  // Step 2: Upload file bytes directly to Supabase Storage via the signed URL.
  // The signed URL is a time-limited authorised PUT endpoint — no auth header needed.
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
