'use client'

import { Bot } from 'lucide-react'

interface CopilotEmptyStateProps {
  /**
   * Whether a thread exists but has no messages yet.
   * When false (no thread), clicking a prompt creates a thread then sends.
   * When true (thread exists, empty), clicking a prompt sends directly.
   */
  hasThread: boolean
  onPromptSelect: (prompt: string) => void
}

const QUICK_PROMPTS = [
  'Summarize this project',
  'What are the active zoning rules?',
  'Show me recent compliance issues',
  'What documents have been uploaded?',
  'What is the readiness score?',
]

export function CopilotEmptyState({ hasThread, onPromptSelect }: CopilotEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
      <div className="w-8 h-8 rounded-full bg-archai-orange/10 border border-archai-orange/20 flex items-center justify-center">
        <Bot className="h-4 w-4 text-archai-orange" />
      </div>

      {!hasThread && (
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-white">ArchAI Copilot</p>
          <p className="text-[11px] text-muted-foreground max-w-[200px]">
            Ask questions about this project's zoning rules, compliance, and more.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5 w-full max-w-[220px]">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPromptSelect(prompt)}
            className="text-[11px] border border-archai-graphite rounded-lg px-3 py-1.5 text-muted-foreground hover:border-archai-orange/40 hover:text-white transition-colors text-left"
          >
            {prompt}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/40">
        or ask me anything else below
      </p>
    </div>
  )
}
