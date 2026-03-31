'use client'

/**
 * hooks/useCopilot.ts
 *
 * React hook that manages Copilot state for a project:
 *   - thread list
 *   - active thread + messages
 *   - send-message flow (optimistic user message → await assistant response)
 *   - auto-create thread when sending with no active thread
 *   - new thread creation
 *   - thread archiving + renaming
 *
 * API client calls go through the Next.js proxy routes under /api/copilot.
 * All state is in-memory; persistence is in Supabase via the backend.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type {
  CopilotThread,
  CopilotMessage,
  CopilotUiContext,
  CreateNotePayload,
} from '@/types'

// ── Last-active-thread persistence ─────────────────────────
// Per-project localStorage key so switching projects resets to that project's
// last thread. Key: archai:copilotActiveThread:{projectId}

function getLastThreadKey(projectId: string) {
  return `archai:copilotActiveThread:${projectId}`
}

function readLastThreadId(projectId: string): string | null {
  try {
    return localStorage.getItem(getLastThreadKey(projectId))
  } catch {
    return null
  }
}

function writeLastThreadId(projectId: string, threadId: string | null) {
  try {
    const key = getLastThreadKey(projectId)
    if (threadId) {
      localStorage.setItem(key, threadId)
    } else {
      localStorage.removeItem(key)
    }
  } catch {
    // localStorage may be unavailable (SSR / private browsing) — fail silently
  }
}

interface UseCopilotOptions {
  projectId: string
  /** Optional snapshot of the current UI context forwarded with every message. */
  uiContext?: CopilotUiContext
}

export interface UseCopilotReturn {
  // Thread list
  threads: CopilotThread[]
  threadsLoading: boolean
  threadsError: string | null
  loadThreads: () => Promise<void>

  // Active thread + messages
  activeThread: CopilotThread | null
  messages: CopilotMessage[]
  messagesLoading: boolean

  // Actions
  openThread: (thread: CopilotThread) => Promise<void>
  createThread: () => Promise<CopilotThread | null>
  archiveThread: (threadId: string) => Promise<void>
  renameThread: (threadId: string, title: string) => Promise<void>
  sendMessage: (content: string, attachmentIds?: string[]) => Promise<void>
  sending: boolean
  sendError: string | null
  createError: string | null
  pinToNotes: (message: CopilotMessage) => Promise<void>
}

export function useCopilot({ projectId, uiContext }: UseCopilotOptions): UseCopilotReturn {
  const [threads, setThreads] = useState<CopilotThread[]>([])
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [threadsError, setThreadsError] = useState<string | null>(null)

  const [activeThread, setActiveThread] = useState<CopilotThread | null>(null)
  const [messages, setMessages] = useState<CopilotMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)

  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  // Prevent double-sends from React StrictMode double-invoking effects
  const sendingRef = useRef(false)

  // ── Load thread list (+ restore last active thread) ─────

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true)
    setThreadsError(null)
    try {
      const res = await fetch(
        `/api/copilot/projects/${projectId}/threads`,
        { cache: 'no-store' }
      )
      if (!res.ok) throw new Error(`Failed to load threads (${res.status})`)
      const data = (await res.json()) as CopilotThread[]
      setThreads(data)

      // Restore last active thread for this project
      // Only restore if no thread is currently active (avoid clobbering a manual selection)
      setActiveThread((current) => {
        if (current) return current // already have an active thread
        if (data.length === 0) return null

        const lastId = readLastThreadId(projectId)
        if (lastId) {
          const found = data.find((t) => t.id === lastId && !t.archived)
          if (found) return found
        }
        // No persisted selection — do NOT auto-select; show starter state
        return null
      })
    } catch (err) {
      setThreadsError(err instanceof Error ? err.message : 'Failed to load threads')
    } finally {
      setThreadsLoading(false)
    }
  }, [projectId])

  // ── Open a thread and load its messages ──────────────────

  const openThread = useCallback(async (thread: CopilotThread) => {
    setActiveThread(thread)
    writeLastThreadId(projectId, thread.id)
    setMessages([])
    setMessagesLoading(true)
    try {
      const res = await fetch(
        `/api/copilot/threads/${thread.id}/messages?limit=50`,
        { cache: 'no-store' }
      )
      if (!res.ok) throw new Error(`Failed to load messages (${res.status})`)
      const data = (await res.json()) as CopilotMessage[]
      setMessages(data)
    } catch {
      // Non-fatal: show empty state rather than blocking the UI
      setMessages([])
    } finally {
      setMessagesLoading(false)
    }
  }, [projectId])

  // When activeThread is set (e.g. restored from localStorage), load its messages
  // if messages are empty and we're not already loading them.
  useEffect(() => {
    if (!activeThread) return
    if (messages.length > 0 || messagesLoading) return
    // Load messages for the restored/active thread
    void openThread(activeThread)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id])

  // ── Create a new thread ──────────────────────────────────

  const createThread = useCallback(async (): Promise<CopilotThread | null> => {
    setCreateError(null)
    try {
      // Only include optional fields when they have a real value.
      // The Zod schema uses .optional() (not .nullable()), so sending null fails validation.
      const threadBody: Record<string, unknown> = { projectId }
      if (uiContext?.currentPage) threadBody.pageContext = uiContext.currentPage
      if (uiContext?.activeRunId)  threadBody.activeRunId  = uiContext.activeRunId

      const res = await fetch('/api/copilot/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(threadBody),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const raw = (body as { error?: unknown }).error
        // error may be a Zod flatten object {formErrors, fieldErrors} — always stringify
        const msg =
          typeof raw === 'string'
            ? raw
            : raw != null
              ? `Validation error (${res.status})`
              : `Failed to create thread (${res.status})`
        setCreateError(msg)
        return null
      }
      const thread = (await res.json()) as CopilotThread

      // Prepend to thread list
      setThreads((prev) => [thread, ...prev])
      // Open the new thread with empty messages
      setActiveThread(thread)
      writeLastThreadId(projectId, thread.id)
      setMessages([])
      return thread
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create thread')
      return null
    }
  }, [projectId, uiContext])

  // ── Archive a thread ─────────────────────────────────────

  const archiveThread = useCallback(async (threadId: string) => {
    try {
      await fetch(`/api/copilot/threads/${threadId}`, { method: 'DELETE' })
      setThreads((prev) => prev.filter((t) => t.id !== threadId))
      if (activeThread?.id === threadId) {
        setActiveThread(null)
        setMessages([])
        writeLastThreadId(projectId, null)
      }
    } catch {
      // Non-fatal
    }
  }, [activeThread, projectId])

  // ── Rename a thread ──────────────────────────────────────

  const renameThread = useCallback(async (threadId: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    try {
      const res = await fetch(`/api/copilot/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (!res.ok) return
      // Update in local thread list
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, title: trimmed } : t))
      )
      // Update active thread if it's the one being renamed
      setActiveThread((prev) =>
        prev?.id === threadId ? { ...prev, title: trimmed } : prev
      )
    } catch {
      // Non-fatal — title reverts in UI on next load
    }
  }, [])

  // ── Send a message (auto-creates thread if none active) ──

  const sendMessage = useCallback(
    async (content: string, attachmentIds: string[] = []) => {
      if (sendingRef.current) return
      if (!content.trim()) return

      sendingRef.current = true
      setSending(true)
      setSendError(null)
      setCreateError(null)
      setThreadsError(null)

      // Auto-create a thread if none is active
      let thread = activeThread
      if (!thread) {
        // Build thread body (no title yet — service auto-derives it)
        const threadBody: Record<string, unknown> = { projectId }
        if (uiContext?.currentPage) threadBody.pageContext = uiContext.currentPage
        if (uiContext?.activeRunId)  threadBody.activeRunId  = uiContext.activeRunId

        try {
          const createRes = await fetch('/api/copilot/threads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(threadBody),
          })
          if (!createRes.ok) {
            const body = await createRes.json().catch(() => ({}))
            const raw = (body as { error?: unknown }).error
            const msg =
              typeof raw === 'string'
                ? raw
                : `Failed to create thread (${createRes.status})`
            setSendError(msg)
            sendingRef.current = false
            setSending(false)
            return
          }
          thread = (await createRes.json()) as CopilotThread
          setThreads((prev) => [thread!, ...prev])
          setActiveThread(thread)
          writeLastThreadId(projectId, thread.id)
          setMessages([])
        } catch (err) {
          setSendError(err instanceof Error ? err.message : 'Failed to create thread')
          sendingRef.current = false
          setSending(false)
          return
        }
      }

      // Optimistic: append user message immediately
      const optimisticUserMsg: CopilotMessage = {
        id: `optimistic-${Date.now()}`,
        threadId: thread.id,
        projectId,
        role: 'user',
        content: content.trim(),
        createdAt: new Date().toISOString(),
        uiContext: uiContext ?? null,
      }
      setMessages((prev) => [...prev, optimisticUserMsg])

      try {
        const res = await fetch(
          `/api/copilot/threads/${thread.id}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: content.trim(),
              uiContext: uiContext ?? undefined,
              attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
            }),
          }
        )

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          const raw = (errBody as { error?: unknown }).error
          const msg =
            typeof raw === 'string'
              ? raw
              : raw != null
                ? `Validation error (${res.status})`
                : `Request failed (${res.status})`
          throw new Error(msg)
        }

        const { userMessage, assistantMessage, toolMessages = [] } = (await res.json()) as {
          userMessage: CopilotMessage
          assistantMessage: CopilotMessage
          toolMessages?: CopilotMessage[]
        }

        // Replace optimistic message with persisted ones (user → tool steps → assistant)
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticUserMsg.id),
          userMessage,
          ...toolMessages,
          assistantMessage,
        ])

        // Update the thread's updatedAt / title in the list (service auto-derives title)
        setThreads((prev) =>
          prev.map((t) =>
            t.id === thread!.id
              ? {
                  ...t,
                  updatedAt: userMessage.createdAt,
                  lastMessagePreview: assistantMessage.content.slice(0, 120),
                }
              : t
          )
        )
      } catch (err) {
        // Remove optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== optimisticUserMsg.id))
        setSendError(err instanceof Error ? err.message : 'Failed to send message')
      } finally {
        sendingRef.current = false
        setSending(false)
      }
    },
    [activeThread, projectId, uiContext]
  )

  // ── Pin assistant message as a project note ───────────────
  const pinToNotes = useCallback(
    async (message: CopilotMessage) => {
      // Derive a title from the first sentence of the message content
      const text = message.content.trim()
      const firstSentenceEnd = Math.min(
        ...['.', '?', '!', '\n'].map((sep) => {
          const idx = text.indexOf(sep)
          return idx > 0 ? idx + 1 : Number.MAX_SAFE_INTEGER
        })
      )
      const title =
        firstSentenceEnd < 80
          ? text.slice(0, firstSentenceEnd).trim()
          : text.slice(0, 80).trim() + '…'

      const payload: CreateNotePayload = {
        title,
        content: message.content,
        pinned: false,
        sourceType: 'copilot',
        sourceMessageId: message.id,
      }

      const res = await fetch(`/api/copilot/projects/${projectId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`Failed to save note (${res.status})`)
    },
    [projectId]
  )

  return {
    threads,
    threadsLoading,
    threadsError,
    loadThreads,
    activeThread,
    messages,
    messagesLoading,
    openThread,
    createThread,
    archiveThread,
    renameThread,
    sendMessage,
    sending,
    sendError,
    createError,
    pinToNotes,
  }
}
