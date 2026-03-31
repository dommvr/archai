'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { Bot, User, Loader2, Wrench, BookmarkPlus, Check } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { CopilotMessage } from '@/types'

interface CopilotMessageListProps {
  messages: CopilotMessage[]
  loading: boolean
  sending: boolean
  /** Called when the user pins an assistant message as a project note. */
  onPinToNotes?: (message: CopilotMessage) => Promise<void>
}

export function CopilotMessageList({ messages, loading, sending, onPinToNotes }: CopilotMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // Filter out system messages — they are internal context, not shown to the user
  const visibleMessages = messages.filter((m) => m.role !== 'system')

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-archai-orange/60" />
          </div>
        ) : (
          visibleMessages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onPinToNotes={onPinToNotes}
            />
          ))
        )}

        {/* Streaming/sending indicator */}
        {sending && <ThinkingBubble />}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}

function MessageBubble({
  message,
  onPinToNotes,
}: {
  message: CopilotMessage
  onPinToNotes?: (message: CopilotMessage) => Promise<void>
}) {
  const isUser      = message.role === 'user'
  const isTool      = message.role === 'tool'
  const isAssistant = message.role === 'assistant'
  const [pinned, setPinned] = useState(false)

  if (isTool) {
    return <ToolResultStrip message={message} />
  }

  const handlePin = async () => {
    if (!onPinToNotes || pinned) return
    await onPinToNotes(message)
    setPinned(true)
    // Reset after 3s to allow re-pinning (e.g. different title)
    setTimeout(() => setPinned(false), 3000)
  }

  return (
    <div className={cn('flex gap-2.5 group', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div
        className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
          isAssistant
            ? 'bg-archai-orange/10 border border-archai-orange/20'
            : 'bg-archai-graphite'
        )}
      >
        {isAssistant ? (
          <Bot className="h-3.5 w-3.5 text-archai-orange" />
        ) : (
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </div>

      {/* Bubble + pin action */}
      <div className="flex flex-col gap-1 max-w-[85%]">
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-xs leading-relaxed',
            isAssistant
              ? 'bg-archai-black/50 border border-archai-graphite text-muted-foreground'
              : 'bg-archai-orange/10 border border-archai-orange/20 text-white'
          )}
        >
          <MessageContent content={message.content} />
        </div>

        {/* "Pin to notes" — only on assistant messages, visible on hover */}
        {isAssistant && onPinToNotes && (
          <button
            type="button"
            onClick={handlePin}
            className={cn(
              'self-start flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded',
              'opacity-0 group-hover:opacity-100 transition-opacity',
              pinned
                ? 'text-emerald-400 cursor-default'
                : 'text-muted-foreground/50 hover:text-archai-orange transition-colors',
            )}
            aria-label="Save this answer as a project note"
            disabled={pinned}
          >
            {pinned ? (
              <><Check className="h-2.5 w-2.5" />Saved to notes</>
            ) : (
              <><BookmarkPlus className="h-2.5 w-2.5" />Pin to notes</>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function ToolResultStrip({ message }: { message: CopilotMessage }) {
  const toolName = message.toolName ?? 'tool'

  let status: 'ok' | 'not_ready' | 'partial' | 'error' = 'ok'
  try {
    const result = JSON.parse(message.content) as { status?: string }
    const s = result?.status
    if (s === 'not_ready' || s === 'error' || s === 'partial') {
      status = s
    }
  } catch {
    // Not JSON — show neutral strip
  }

  const colorClass = {
    ok:        'text-archai-orange/70 border-archai-orange/20',
    partial:   'text-archai-amber/70 border-archai-amber/20',
    not_ready: 'text-muted-foreground/50 border-archai-graphite',
    error:     'text-red-400/70 border-red-500/20',
  }[status]

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded border text-[10px]',
        colorClass
      )}
    >
      <Wrench className="h-2.5 w-2.5 shrink-0" />
      <span className="font-mono">{toolName}</span>
      <span className="text-muted-foreground/40">·</span>
      <span className="text-muted-foreground/60">{status}</span>
    </div>
  )
}

function ThinkingBubble() {
  return (
    <div className="flex gap-2.5">
      <div className="w-6 h-6 rounded-full bg-archai-orange/10 border border-archai-orange/20 flex items-center justify-center shrink-0">
        <Bot className="h-3.5 w-3.5 text-archai-orange" />
      </div>
      <div className="bg-archai-black/50 border border-archai-graphite rounded-lg px-3 py-2 flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 text-archai-orange animate-spin" />
        <span className="text-[10px] text-muted-foreground">Thinking…</span>
      </div>
    </div>
  )
}

/**
 * Clickable Speckle object ID chip.
 *
 * Calls window.__speckleViewer?.highlightObjects([id]) — the same bridge used
 * by ViewerAnnotationController and ComplianceIssueDrawer throughout Tool 1.
 * Optional-chained so it is safe when the viewer is not mounted.
 *
 * The full ID is shown — no truncation. The chip wraps on overflow so
 * long IDs remain readable in the message bubble.
 */
function ObjectIdChip({ id }: { id: string }) {
  const handleClick = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewer = (window as any).__speckleViewer
    void viewer?.highlightObjects?.([id])
  }, [id])

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Highlight object ${id} in viewer`}
      className={cn(
        'inline font-mono text-[10px] break-all',
        'bg-archai-graphite hover:bg-archai-smoke',
        'border border-archai-smoke/60 hover:border-archai-orange/40',
        'rounded px-1.5 py-0.5 mx-0.5 transition-colors cursor-pointer',
        'text-archai-amber/80 hover:text-archai-orange',
      )}
      aria-label={`Click to highlight object ${id} in the 3D viewer`}
    >
      {id}
    </button>
  )
}

/**
 * Inline code span for IDs that are NOT Speckle object IDs (run IDs, model ref
 * IDs, snapshot IDs, note IDs, etc.).  These are rendered as plain code-style
 * text — readable but not interactive, since clicking them has no meaning.
 */
function InlineIdCode({ id }: { id: string }) {
  return (
    <code className="font-mono text-[10px] bg-archai-black/60 border border-archai-graphite rounded px-1 py-0.5 mx-0.5 text-muted-foreground/80 break-all">
      {id}
    </code>
  )
}

/**
 * Splits a plain-text segment into:
 *   - ObjectIdChip  → for Speckle object IDs (24–64 char hex, no hyphens)
 *   - InlineIdCode  → for UUIDs (DB IDs: run/model/snapshot/note)
 *   - plain string  → everything else
 *
 * Order matters: the UUID pattern (group 1) is tested before the hex pattern
 * (group 2) so a UUID is never partially matched by the bare-hex arm.
 */
function renderWithObjectIds(text: string, baseKey: string): React.ReactNode[] {
  // Build a combined regex that matches either pattern; use a named approach
  // by testing which group matched.
  const parts: React.ReactNode[] = []
  // Combined: group 1 = UUID, group 2 = speckle hex id
  const COMBINED_RE = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b|\b([0-9a-f]{24,64})\b/gi

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = COMBINED_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[1]) {
      // UUID → non-interactive inline code
      parts.push(<InlineIdCode key={`${baseKey}-uuid-${match.index}`} id={match[1]} />)
    } else if (match[2]) {
      // Speckle hex object ID → clickable highlight chip
      parts.push(<ObjectIdChip key={`${baseKey}-oid-${match.index}`} id={match[2]} />)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.length > 0 ? parts : [text]
}

/**
 * Renders message content with minimal markdown support.
 * Handles **bold**, line breaks, triple-backtick code blocks,
 * and object ID chips (clickable Speckle highlight triggers).
 */
function MessageContent({ content }: { content: string }) {
  const paragraphs = content.split(/\n\n+/)

  return (
    <>
      {paragraphs.map((para, i) => {
        // Code block
        if (para.startsWith('```')) {
          const lines = para.split('\n')
          const code = lines.slice(1, -1).join('\n')
          return (
            <pre
              key={i}
              className="mt-1 mb-1 bg-archai-black rounded px-2 py-1.5 overflow-x-auto font-mono text-[10px] text-archai-amber/80"
            >
              {code}
            </pre>
          )
        }

        // Inline formatting: **bold**, line breaks, then object ID chips
        const segments = para.split(/(\*\*[^*]+\*\*|\n)/)
        return (
          <p key={i} className="mb-1 last:mb-0">
            {segments.map((seg, j) => {
              if (seg === '\n') return <br key={j} />
              if (seg.startsWith('**') && seg.endsWith('**')) {
                return (
                  <strong key={j} className="font-semibold text-white">
                    {seg.slice(2, -2)}
                  </strong>
                )
              }
              // Plain text: scan for object IDs and make them clickable
              return (
                <span key={j}>
                  {renderWithObjectIds(seg, `${i}-${j}`)}
                </span>
              )
            })}
          </p>
        )
      })}
    </>
  )
}
