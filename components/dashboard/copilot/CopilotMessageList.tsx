'use client'

import { useEffect, useRef } from 'react'
import { Bot, User, Loader2, Wrench } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { CopilotMessage } from '@/types'

interface CopilotMessageListProps {
  messages: CopilotMessage[]
  loading: boolean
  sending: boolean
}

export function CopilotMessageList({ messages, loading, sending }: CopilotMessageListProps) {
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
          visibleMessages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}

        {/* Streaming/sending indicator */}
        {sending && <ThinkingBubble />}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}

function MessageBubble({ message }: { message: CopilotMessage }) {
  const isUser      = message.role === 'user'
  const isTool      = message.role === 'tool'
  const isAssistant = message.role === 'assistant'

  if (isTool) {
    // Tool result messages are shown as a compact info strip
    return <ToolResultStrip message={message} />
  }

  return (
    <div className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
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

      {/* Bubble */}
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed',
          isAssistant
            ? 'bg-archai-black/50 border border-archai-graphite text-muted-foreground'
            : 'bg-archai-orange/10 border border-archai-orange/20 text-white'
        )}
      >
        {/* Basic markdown: bold **text** and newlines */}
        <MessageContent content={message.content} />
      </div>
    </div>
  )
}

function ToolResultStrip({ message }: { message: CopilotMessage }) {
  const toolName = message.toolName ?? 'tool'

  // Parse the tool result to determine status
  let status: 'ok' | 'not_ready' | 'partial' | 'error' = 'ok'
  try {
    const result = JSON.parse(message.content) as { status?: string }
    const s = result?.status
    if (s === 'not_ready' || s === 'error' || s === 'partial') {
      status = s
    }
  } catch {
    // If not JSON, just show a neutral strip
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
 * Renders message content with minimal markdown support.
 * Handles **bold**, line breaks, and code blocks — the most common
 * patterns in GPT-5.4 responses. No heavy markdown library needed here.
 */
function MessageContent({ content }: { content: string }) {
  // Split into paragraphs on double-newline
  const paragraphs = content.split(/\n\n+/)

  return (
    <>
      {paragraphs.map((para, i) => {
        // Detect a code block
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

        // Inline formatting: render **bold** spans + line breaks
        const segments = para.split(/(\*\*[^*]+\*\*|\n)/)
        return (
          <p key={i} className="mb-1 last:mb-0">
            {segments.map((seg, j) => {
              if (seg === '\n') return <br key={j} />
              if (seg.startsWith('**') && seg.endsWith('**')) {
                return <strong key={j} className="font-semibold text-white">{seg.slice(2, -2)}</strong>
              }
              return seg
            })}
          </p>
        )
      })}
    </>
  )
}
