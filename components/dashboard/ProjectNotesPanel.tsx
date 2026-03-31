'use client'

import { useState, useEffect, useCallback } from 'react'
import { Pin, PinOff, Plus, Trash2, Pencil, X, Check, StickyNote, Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ProjectNote, CreateNotePayload, UpdateNotePayload } from '@/types'

interface ProjectNotesPanelProps {
  projectId: string
}

// ── API helpers ────────────────────────────────────────────────

async function fetchNotes(projectId: string): Promise<ProjectNote[]> {
  const res = await fetch(`/api/copilot/projects/${projectId}/notes`)
  if (!res.ok) return []
  return res.json()
}

async function createNote(projectId: string, payload: CreateNotePayload): Promise<ProjectNote> {
  const res = await fetch(`/api/copilot/projects/${projectId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to create note')
  return res.json()
}

async function updateNote(noteId: string, payload: UpdateNotePayload): Promise<ProjectNote> {
  const res = await fetch(`/api/copilot/notes/${noteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to update note')
  return res.json()
}

async function deleteNote(noteId: string): Promise<void> {
  await fetch(`/api/copilot/notes/${noteId}`, { method: 'DELETE' })
}

// ── Main component ─────────────────────────────────────────────

export function ProjectNotesPanel({ projectId }: ProjectNotesPanelProps) {
  const [notes, setNotes] = useState<ProjectNote[]>([])
  const [loading, setLoading] = useState(true)
  const [addingNew, setAddingNew] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchNotes(projectId)
      .then((n) => setNotes(n))
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => { load() }, [load])

  const handleCreate = async (title: string, content: string) => {
    const note = await createNote(projectId, { title, content })
    setNotes((prev) => [note, ...prev])
    setAddingNew(false)
  }

  const handleUpdate = async (noteId: string, payload: UpdateNotePayload) => {
    const updated = await updateNote(noteId, payload)
    setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)))
    setEditingId(null)
  }

  const handleTogglePin = async (note: ProjectNote) => {
    await handleUpdate(note.id, { pinned: !note.pinned })
  }

  const handleDelete = async (noteId: string) => {
    await deleteNote(noteId)
    setNotes((prev) => prev.filter((n) => n.id !== noteId))
    setDeleteConfirmId(null)
  }

  // Pinned first, then newest updated
  const sorted = [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Notes
        </p>
        <button
          className="text-[10px] text-archai-orange/70 hover:text-archai-orange transition-colors flex items-center gap-0.5"
          onClick={() => { setAddingNew(true); setEditingId(null) }}
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>

      {/* New note inline form */}
      {addingNew && (
        <NoteForm
          onSave={handleCreate}
          onCancel={() => setAddingNew(false)}
        />
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-lg border border-archai-graphite bg-archai-black/40 animate-pulse" />
          ))}
        </div>
      ) : sorted.length === 0 && !addingNew ? (
        <div
          className="rounded-lg border border-dashed border-archai-graphite p-4 flex items-center gap-3 cursor-pointer hover:border-archai-graphite/70 transition-colors"
          onClick={() => setAddingNew(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setAddingNew(true)}
        >
          <StickyNote className="h-4 w-4 text-muted-foreground/40 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">No notes yet</p>
            <p className="text-[10px] text-muted-foreground/60">
              Save key decisions, constraints, or Copilot answers here
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((note) =>
            editingId === note.id ? (
              <NoteForm
                key={note.id}
                initial={note}
                onSave={(title, content) => handleUpdate(note.id, { title, content })}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <NoteCard
                key={note.id}
                note={note}
                onEdit={() => { setEditingId(note.id); setAddingNew(false) }}
                onTogglePin={() => handleTogglePin(note)}
                onDelete={() => setDeleteConfirmId(note.id)}
                confirmingDelete={deleteConfirmId === note.id}
                onConfirmDelete={() => handleDelete(note.id)}
                onCancelDelete={() => setDeleteConfirmId(null)}
              />
            )
          )}
        </div>
      )}
    </section>
  )
}

// ── Note card ──────────────────────────────────────────────────

interface NoteCardProps {
  note: ProjectNote
  onEdit: () => void
  onTogglePin: () => void
  onDelete: () => void
  confirmingDelete: boolean
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

function NoteCard({
  note,
  onEdit,
  onTogglePin,
  onDelete,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
}: NoteCardProps) {
  return (
    <div
      className={cn(
        'group rounded-lg border px-3 py-2.5 transition-colors',
        note.pinned
          ? 'border-archai-orange/20 bg-archai-orange/5'
          : 'border-archai-graphite bg-archai-black/40',
      )}
    >
      <div className="flex items-start gap-2">
        {/* Source badge */}
        {note.sourceType === 'copilot' && (
          <Bot className="h-3 w-3 text-archai-orange/60 shrink-0 mt-0.5" />
        )}

        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white truncate">{note.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 whitespace-pre-wrap">
            {note.content}
          </p>
          <p className="text-[10px] text-muted-foreground/40 mt-1">
            {new Date(note.updatedAt).toLocaleDateString()}
          </p>
        </div>

        {/* Actions */}
        {confirmingDelete ? (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] text-red-400">Delete?</span>
            <button
              type="button"
              onClick={onConfirmDelete}
              className="text-red-400 hover:text-red-300 transition-colors"
              aria-label="Confirm delete"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="text-muted-foreground hover:text-white transition-colors"
              aria-label="Cancel delete"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={onTogglePin}
              className={cn(
                'p-0.5 rounded transition-colors',
                note.pinned
                  ? 'text-archai-orange hover:text-archai-orange/70'
                  : 'text-muted-foreground/40 hover:text-white',
              )}
              aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
            >
              {note.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="p-0.5 rounded text-muted-foreground/40 hover:text-white transition-colors"
              aria-label="Edit note"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="p-0.5 rounded text-muted-foreground/40 hover:text-red-400 transition-colors"
              aria-label="Delete note"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Note form (create / edit) ──────────────────────────────────

interface NoteFormProps {
  initial?: Pick<ProjectNote, 'title' | 'content'>
  onSave: (title: string, content: string) => void
  onCancel: () => void
}

function NoteForm({ initial, onSave, onCancel }: NoteFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')

  const canSave = title.trim().length > 0 && content.trim().length > 0

  return (
    <div className="rounded-lg border border-archai-orange/20 bg-archai-black/60 p-3 mb-2 space-y-2">
      <input
        type="text"
        placeholder="Note title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={cn(
          'w-full text-xs bg-transparent border-b border-archai-graphite pb-1',
          'text-white placeholder:text-muted-foreground/50',
          'focus:outline-none focus:border-archai-orange/40',
        )}
        autoFocus
      />
      <textarea
        placeholder="Note content…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        className={cn(
          'w-full text-[11px] bg-transparent resize-none',
          'text-muted-foreground placeholder:text-muted-foreground/40',
          'focus:outline-none',
        )}
      />
      <div className="flex justify-end gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="archai"
          size="sm"
          className="h-6 px-2 text-[10px]"
          disabled={!canSave}
          onClick={() => onSave(title.trim(), content.trim())}
        >
          {initial ? 'Save' : 'Add note'}
        </Button>
      </div>
    </div>
  )
}
