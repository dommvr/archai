'use client'

import { useState, useRef, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Send, Bot, User, Loader2, Sparkles } from 'lucide-react'
import type { ChatMessage } from '@/types'
import { cn } from '@/lib/utils'

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Hello. I\'m your ArchAI Copilot. I can help you analyze your model, check zoning compliance, generate massing options, and answer questions about your design. What would you like to explore?',
  timestamp: new Date(),
}

// Demo quick prompts to show integration points
const QUICK_PROMPTS = [
  'Check zoning compliance',
  'Summarize live metrics',
  'Suggest massing options',
]

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    // LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
    // FASTAPI CALL PLACEHOLDER — replace with real AI call:
    // const response = await fetch('/api/agents/copilot', {
    //   method: 'POST',
    //   body: JSON.stringify({ message: text, history: messages }),
    // })
    // const data = await response.json()

    // Demo response stub
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `I understand you want to: "${text}". This capability will be available when the AI backend is connected. The integration point is ready at /api/agents/copilot.`,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, assistantMsg])
    setLoading(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-archai-graphite shrink-0">
        <div className="w-6 h-6 rounded bg-archai-orange/10 flex items-center justify-center">
          <Sparkles className="h-3.5 w-3.5 text-archai-orange" />
        </div>
        <span className="text-xs font-semibold text-white uppercase tracking-wider">AI Copilot</span>
        {/* LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER */}
        <span className="ml-auto text-[10px] text-archai-orange/60 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-archai-orange/60" />
          stub
        </span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn('flex gap-2.5', msg.role === 'user' && 'flex-row-reverse')}
            >
              {/* Avatar */}
              <div
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                  msg.role === 'assistant'
                    ? 'bg-archai-orange/10 border border-archai-orange/20'
                    : 'bg-archai-graphite'
                )}
              >
                {msg.role === 'assistant' ? (
                  <Bot className="h-3.5 w-3.5 text-archai-orange" />
                ) : (
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>

              {/* Bubble */}
              <div
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed',
                  msg.role === 'assistant'
                    ? 'bg-archai-black/50 border border-archai-graphite text-muted-foreground'
                    : 'bg-archai-orange/10 border border-archai-orange/20 text-white'
                )}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex gap-2.5">
              <div className="w-6 h-6 rounded-full bg-archai-orange/10 border border-archai-orange/20 flex items-center justify-center shrink-0">
                <Bot className="h-3.5 w-3.5 text-archai-orange" />
              </div>
              <div className="bg-archai-black/50 border border-archai-graphite rounded-lg px-3 py-2">
                <Loader2 className="h-3 w-3 text-archai-orange animate-spin" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Quick prompts */}
      {messages.length === 1 && (
        <div className="px-4 py-2 flex flex-wrap gap-1.5 border-t border-archai-graphite shrink-0">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => sendMessage(prompt)}
              className="text-[10px] border border-archai-graphite rounded-full px-2.5 py-1 text-muted-foreground hover:border-archai-orange/40 hover:text-white transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 p-3 border-t border-archai-graphite shrink-0"
      >
        <Input
          placeholder="Ask your Copilot..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="text-xs h-8"
          disabled={loading}
        />
        <Button
          type="submit"
          size="icon"
          variant="archai"
          className="h-8 w-8 shrink-0"
          disabled={!input.trim() || loading}
          aria-label="Send message"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  )
}
