'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, Plus, Trash2, Loader2, Check, X, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { CopilotThread } from '@/types'

interface CopilotThreadListProps {
  threads: CopilotThread[]
  activeThreadId: string | null
  loading: boolean
  onSelectThread: (thread: CopilotThread) => void
  onNewThread: () => void
  onArchiveThread: (threadId: string) => void
  onRenameThread: (threadId: string, title: string) => void
}

export function CopilotThreadList({
  threads,
  activeThreadId,
  loading,
  onSelectThread,
  onNewThread,
  onArchiveThread,
  onRenameThread,
}: CopilotThreadListProps) {
  return (
    <div className="flex flex-col h-full border-r border-archai-graphite">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-archai-graphite shrink-0">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Threads
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-white"
          onClick={onNewThread}
          aria-label="New conversation"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Thread list */}
      <ScrollArea className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-archai-orange/60" />
          </div>
        ) : threads.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <MessageSquare className="h-5 w-5 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-[10px] text-muted-foreground/50">No conversations yet.</p>
            <button
              onClick={onNewThread}
              className="mt-2 text-[10px] text-archai-orange/70 hover:text-archai-orange transition-colors"
            >
              Start one →
            </button>
          </div>
        ) : (
          <ul className="py-1">
            {threads.map((thread) => (
              <ThreadItem
                key={thread.id}
                thread={thread}
                isActive={thread.id === activeThreadId}
                onSelect={() => onSelectThread(thread)}
                onArchive={() => onArchiveThread(thread.id)}
                onRename={(title) => onRenameThread(thread.id, title)}
              />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}

interface ThreadItemProps {
  thread: CopilotThread
  isActive: boolean
  onSelect: () => void
  onArchive: () => void
  onRename: (title: string) => void
}

function ThreadItem({ thread, isActive, onSelect, onArchive, onRename }: ThreadItemProps) {
  const rawTitle = thread.title ?? 'New conversation'
  const preview = thread.lastMessagePreview

  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(rawTitle)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the rename input when it appears
  useEffect(() => {
    if (renaming) {
      setRenameValue(rawTitle)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming, rawTitle])

  // Auto-dismiss delete confirmation after 3 s if no action
  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== rawTitle) {
      onRename(trimmed)
    }
    setRenaming(false)
  }, [renameValue, rawTitle, onRename])

  const cancelRename = useCallback(() => {
    setRenaming(false)
    setRenameValue(rawTitle)
  }, [rawTitle])

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename() }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirmDelete) {
      onArchive()
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
    }
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmDelete(false)
    setRenaming(true)
  }

  // Truncate title/preview to fixed character counts for stable display
  const titleDisplay = rawTitle.length > 16 ? rawTitle.slice(0, 15) + '…' : rawTitle
  const previewDisplay = preview
    ? (preview.length > 22 ? preview.slice(0, 21) + '…' : preview)
    : null

  return (
    <li
      className={cn(
        'group relative flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors',
        isActive
          ? 'bg-archai-graphite/60'
          : 'hover:bg-archai-graphite/30'
      )}
      onClick={renaming ? undefined : onSelect}
    >
      <MessageSquare
        className={cn(
          'h-3 w-3 mt-0.5 shrink-0',
          isActive ? 'text-archai-orange' : 'text-muted-foreground/50'
        )}
      />

      <div className="flex-1 min-w-0 overflow-hidden">
        {renaming ? (
          /* Inline rename input */
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={commitRename}
              className={cn(
                'flex-1 min-w-0 bg-archai-black/60 border border-archai-orange/40',
                'rounded px-1.5 py-0.5 text-[11px] text-white',
                'focus:outline-none focus:ring-1 focus:ring-archai-orange/50',
              )}
              maxLength={120}
            />
            <button
              onMouseDown={(e) => { e.preventDefault(); commitRename() }}
              className="text-archai-orange/70 hover:text-archai-orange"
              aria-label="Save"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); cancelRename() }}
              className="text-muted-foreground/50 hover:text-white"
              aria-label="Cancel"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <>
            <p
              className={cn(
                'text-[11px] font-medium leading-tight whitespace-nowrap overflow-hidden',
                isActive ? 'text-white' : 'text-muted-foreground'
              )}
            >
              {titleDisplay}
            </p>
            {previewDisplay && (
              <p className="text-[10px] text-muted-foreground/50 mt-0.5 leading-tight whitespace-nowrap overflow-hidden">
                {previewDisplay}
              </p>
            )}
          </>
        )}
      </div>

      {/* Action buttons — visible on hover (or when confirmDelete is pending) */}
      {!renaming && (
        <div
          className={cn(
            'absolute right-2 top-1.5 flex items-center gap-0.5 transition-opacity',
            confirmDelete ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {confirmDelete ? (
            <>
              <span className="text-[9px] text-red-400/80 mr-0.5">Delete?</span>
              <button
                onClick={handleDeleteClick}
                className="text-red-400 hover:text-red-300"
                aria-label="Confirm delete"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
                className="text-muted-foreground/50 hover:text-white"
                aria-label="Cancel delete"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleEditClick}
                className="text-muted-foreground/40 hover:text-white transition-colors"
                aria-label="Rename conversation"
              >
                <Pencil className="h-2.5 w-2.5" />
              </button>
              <button
                onClick={handleDeleteClick}
                className="text-muted-foreground/40 hover:text-archai-orange transition-colors"
                aria-label="Delete conversation"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </>
          )}
        </div>
      )}
    </li>
  )
}
