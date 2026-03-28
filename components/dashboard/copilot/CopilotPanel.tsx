'use client'

/**
 * CopilotPanel
 *
 * The main Copilot UI component. Replaces the old ChatPanel stub.
 *
 * Layout (when sidebar is expanded):
 *   ┌────────────────────────────────────────┐
 *   │  Header (title + context badge)        │
 *   ├──────────┬─────────────────────────────┤
 *   │ Thread   │  Message list               │
 *   │ list     │  (scrollable)               │
 *   │ (narrow) ├─────────────────────────────┤
 *   │          │  Composer                   │
 *   └──────────┴─────────────────────────────┘
 *
 * When the RightPanel is narrow (< 400px), the thread list collapses
 * and a back button appears instead — managed via `sidebarOpen` state.
 *
 * Project awareness is provided via:
 *   - `projectId` prop (required)
 *   - `uiContext` prop (optional — passed from parent layout)
 *
 * LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER — future: swap FastAPI /copilot
 * for a LangGraph streaming agent when multi-step agentic flows are needed.
 */

import { useEffect, useCallback, useRef } from 'react'
import { useState } from 'react'
import { Bot, Sparkles, ChevronLeft, Plus, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCopilot } from '@/hooks/useCopilot'
import { CopilotThreadList } from './CopilotThreadList'
import { CopilotMessageList } from './CopilotMessageList'
import { CopilotComposer } from './CopilotComposer'
import { CopilotEmptyState } from './CopilotEmptyState'
import { CopilotContextBadge } from './CopilotContextBadge'
import type { CopilotUiContext } from '@/types'

interface CopilotPanelProps {
  projectId: string
  /**
   * Live snapshot of the current UI context forwarded with every message.
   * Provide this from the parent layout component so the Copilot knows what
   * the user is looking at (page, active run, viewer selection).
   *
   * TODO: When the Speckle viewer is mounted (ViewerPanel.tsx), forward
   * selected_object_ids from the ObjectClicked event into this prop.
   */
  uiContext?: CopilotUiContext
}

export function CopilotPanel({ projectId, uiContext }: CopilotPanelProps) {
  const copilot = useCopilot({ projectId, uiContext })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Tracks whether we've done the initial load
  const loadedRef = useRef(false)

  // Load threads on mount
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    copilot.loadThreads()
  }, [copilot.loadThreads]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewThread = useCallback(async () => {
    await copilot.createThread()
    setSidebarOpen(false)
  }, [copilot.createThread]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Handles a starter-prompt click from CopilotEmptyState.
   * sendMessage already auto-creates a thread if none exists, so just call it.
   */
  const handlePromptSelect = useCallback(
    (prompt: string) => {
      copilot.sendMessage(prompt)
    },
    [copilot.sendMessage] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const isBackendConfigured = true // Always attempt — backend handles missing config gracefully

  return (
    <div className="flex flex-col h-full bg-archai-charcoal">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-archai-graphite shrink-0">
        {/* Back button (mobile/narrow mode when sidebar is open) */}
        {sidebarOpen ? (
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-muted-foreground hover:text-white transition-colors mr-1"
            aria-label="Back to conversation"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : (
          <div className="w-5 h-5 rounded bg-archai-orange/10 flex items-center justify-center shrink-0">
            <Sparkles className="h-3 w-3 text-archai-orange" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-white truncate">
              {copilot.activeThread?.title ?? 'AI Copilot'}
            </span>
            {/* Live indicator dot */}
            <span className="w-1.5 h-1.5 rounded-full bg-archai-orange/60 shrink-0" />
          </div>
          {/* Context badges */}
          <CopilotContextBadge uiContext={uiContext} className="mt-0.5" />
        </div>

        {/* Thread list toggle */}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="text-muted-foreground hover:text-white transition-colors p-1 rounded"
          aria-label="Toggle thread list"
          title="Conversation history"
        >
          <Bot className="h-3.5 w-3.5" />
        </button>

        {/* New thread button */}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-white"
          onClick={handleNewThread}
          aria-label="New conversation"
          title="New conversation"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Thread sidebar — slide in when toggled */}
        <div
          className={cn(
            'transition-all duration-200 overflow-hidden shrink-0',
            sidebarOpen ? 'w-44' : 'w-0'
          )}
        >
          {sidebarOpen && (
            <CopilotThreadList
              threads={copilot.threads}
              activeThreadId={copilot.activeThread?.id ?? null}
              loading={copilot.threadsLoading}
              onSelectThread={(t) => {
                copilot.openThread(t)
                setSidebarOpen(false)
              }}
              onNewThread={handleNewThread}
              onArchiveThread={copilot.archiveThread}
              onRenameThread={copilot.renameThread}
            />
          )}
        </div>

        {/* Conversation area */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {(copilot.threadsError ?? copilot.createError ?? copilot.sendError) && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border-b border-red-500/20">
              <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />
              <p className="text-[10px] text-red-400">
                {copilot.threadsError ?? copilot.createError ?? copilot.sendError}
              </p>
            </div>
          )}

          {/* Messages or empty state */}
          {copilot.activeThread ? (
            copilot.messages.length === 0 && !copilot.messagesLoading && !copilot.sending ? (
              <CopilotEmptyState hasThread onPromptSelect={handlePromptSelect} />
            ) : (
              <CopilotMessageList
                messages={copilot.messages}
                loading={copilot.messagesLoading}
                sending={copilot.sending}
              />
            )
          ) : (
            /* No thread — show starter prompts; sendMessage will auto-create */
            <CopilotEmptyState hasThread={false} onPromptSelect={handlePromptSelect} />
          )}

          {/* Composer */}
          <CopilotComposer
            onSend={copilot.sendMessage}
            disabled={!isBackendConfigured}
            sending={copilot.sending}
            projectId={projectId}
            threadId={copilot.activeThread?.id ?? null}
          />
        </div>
      </div>
    </div>
  )
}
