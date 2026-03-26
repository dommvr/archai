'use client'

import { useState, useContext } from 'react'
import { useRouter } from 'next/navigation'
import { Pin, PinOff, FolderOpen, Plus, Trash2, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ProjectContext } from './DashboardShell'
import { useProjectMeta } from '@/hooks/useProjectMeta'
import { deleteProject } from '@/lib/actions/projects'
import type { Project } from '@/types'

interface AllProjectsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentProjectId: string | null
  /** Called when the user clicks a project — lets the parent close the switcher. */
  onSelectProject: (projectId: string) => void
  /** Called when the user wants to create a new project. */
  onNewProject: () => void
}

export function AllProjectsDialog({
  open,
  onOpenChange,
  currentProjectId,
  onSelectProject,
  onNewProject,
}: AllProjectsDialogProps) {
  const { projects, removeProject } = useContext(ProjectContext)
  const router = useRouter()
  const { togglePin, getProjectMeta } = useProjectMeta()
  // Force re-render when pin state changes (meta lives in localStorage)
  const [, setPinRevision] = useState(0)

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleSelect = (project: Project) => {
    onSelectProject(project.id)
    onOpenChange(false)
    router.push(`/dashboard/projects/${project.id}`)
  }

  const handlePin = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    togglePin(projectId)
    setPinRevision((v) => v + 1)
  }

  const handleDelete = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation()
    if (deletingId) return
    setDeletingId(project.id)
    setDeleteError(null)
    const result = await deleteProject(project.id)
    setDeletingId(null)
    if (!result.success) {
      setDeleteError(result.error)
      return
    }
    removeProject(project.id)
    if (project.id === currentProjectId) {
      const remaining = projects.filter((p) => p.id !== project.id)
      router.push(remaining.length > 0 ? `/dashboard/projects/${remaining[0].id}` : '/dashboard')
    }
  }

  // Sort: pinned first (by pinnedAt DESC), then by updatedAt DESC
  const sorted = [...projects].sort((a, b) => {
    const am = getProjectMeta(a.id)
    const bm = getProjectMeta(b.id)
    if (am.pinned && !bm.pinned) return -1
    if (!am.pinned && bm.pinned) return 1
    if (am.pinned && bm.pinned) {
      return (bm.pinnedAt ?? '').localeCompare(am.pinnedAt ?? '')
    }
    return b.updatedAt.localeCompare(a.updatedAt)
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>All Projects</DialogTitle>
          <DialogDescription>
            Select, pin, or manage your projects.
          </DialogDescription>
        </DialogHeader>

        {deleteError && (
          <p className="text-xs text-red-400 px-1">{deleteError}</p>
        )}

        <div className="mt-2 space-y-1 max-h-[400px] overflow-y-auto pr-1">
          {sorted.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No projects yet. Create one to get started.
            </p>
          )}

          {sorted.map((project) => {
            const meta = getProjectMeta(project.id)
            const isActive = project.id === currentProjectId
            const isDeleting = deletingId === project.id

            return (
              <div
                key={project.id}
                className={cn(
                  'group flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors',
                  isActive
                    ? 'border-archai-orange/30 bg-archai-orange/5'
                    : 'border-archai-graphite bg-archai-black/40 hover:border-archai-graphite/70 hover:bg-archai-charcoal',
                )}
                onClick={() => !isDeleting && handleSelect(project)}
              >
                <FolderOpen className={cn(
                  'h-4 w-4 shrink-0',
                  isActive ? 'text-archai-orange' : 'text-muted-foreground',
                )} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-sm font-medium truncate',
                      isActive ? 'text-archai-orange' : 'text-white',
                    )}>
                      {project.name}
                    </span>
                    {meta.pinned && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1 border-archai-amber/40 text-archai-amber shrink-0">
                        pinned
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    Updated {new Date(project.updatedAt).toLocaleDateString()}
                    {meta.lastOpenedAt && (
                      <> · Opened {new Date(meta.lastOpenedAt).toLocaleDateString()}</>
                    )}
                  </p>
                </div>

                {/* Pin / Unpin */}
                <button
                  type="button"
                  onClick={(e) => handlePin(e, project.id)}
                  aria-label={meta.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-archai-amber transition-colors"
                >
                  {meta.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={(e) => void handleDelete(e, project)}
                  aria-label={`Delete ${project.name}`}
                  disabled={isDeleting}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-900/20 transition-colors"
                >
                  {isDeleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            )
          })}
        </div>

        <div className="pt-3 border-t border-archai-graphite">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => {
              onOpenChange(false)
              onNewProject()
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            New Project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
