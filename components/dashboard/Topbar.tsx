'use client'

import { useState, useContext } from 'react'
import { useRouter, useParams, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  ChevronDown,
  Plus,
  LogOut,
  Settings,
  User,
  FolderOpen,
  Loader2,
  Trash2,
} from 'lucide-react'
import { signOut } from '@/lib/actions/auth'
import { createProject, deleteProject } from '@/lib/actions/projects'
import { UserContext, ProjectContext } from './DashboardShell'
import type { Project } from '@/types'

interface TopbarProps {
  onAddTool: () => void
}

export function Topbar({ onAddTool }: TopbarProps) {
  const user = useContext(UserContext)
  const { projects, addProject, removeProject } = useContext(ProjectContext)
  const router = useRouter()
  const pathname = usePathname()

  // The active project is the one whose ID is in the current URL.
  const params = useParams<{ projectId?: string }>()
  const currentProjectId = params.projectId ?? null
  const activeProject = projects.find((p) => p.id === currentProjectId) ?? null

  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [projectPendingDeletion, setProjectPendingDeletion] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const userInitials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : 'U'

  /**
   * Build the target URL for a project, preserving the current tool segment
   * so that switching projects in precheck goes to the new project's precheck.
   * e.g. /dashboard/projects/old-id/precheck → /dashboard/projects/new-id/precheck
   */
  const routeForProject = (projectId: string): string => {
    const match = pathname.match(/\/dashboard\/projects\/[^/]+(\/[^?#]*)/)
    const toolSuffix = match?.[1] ?? ''
    return `/dashboard/projects/${projectId}${toolSuffix}`
  }

  const handleSelectProject = (project: Project) => {
    setProjectMenuOpen(false)
    if (project.id === currentProjectId) return
    router.push(routeForProject(project.id))
  }

  const openNewProjectDialog = () => {
    setProjectMenuOpen(false)
    setNewProjectName('')
    setCreateError(null)
    setDialogOpen(true)
  }

  const openDeleteDialog = (project: Project) => {
    setProjectMenuOpen(false)
    setProjectPendingDeletion(project)
    setDeleteError(null)
    setDeleteDialogOpen(true)
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProjectName.trim() || creating) return

    setCreating(true)
    setCreateError(null)

    const { project, error } = await createProject(newProjectName)

    setCreating(false)

    if (error || !project) {
      setCreateError(error ?? 'Failed to create project.')
      return
    }

    addProject(project)
    setDialogOpen(false)
    // Always land on the new project's dashboard overview, never preserving the
    // current tool route — the new project has no data yet.
    router.push(`/dashboard/projects/${project.id}`)
  }

  const closeDeleteDialog = (open: boolean) => {
    if (deleting) return
    setDeleteDialogOpen(open)
    if (!open) {
      setProjectPendingDeletion(null)
      setDeleteError(null)
    }
  }

  const handleDeleteProject = async () => {
    if (!projectPendingDeletion || deleting) return

    setDeleting(true)
    setDeleteError(null)

    const result = await deleteProject(projectPendingDeletion.id)

    setDeleting(false)

    if (!result.success) {
      setDeleteError(result.error)
      return
    }

    const deletedId = projectPendingDeletion.id
    removeProject(deletedId)
    closeDeleteDialog(false)

    // Only navigate if the deleted project was the one currently in the URL.
    if (deletedId === currentProjectId) {
      const remaining = projects.filter((p) => p.id !== deletedId)
      if (remaining.length > 0) {
        router.push(`/dashboard/projects/${remaining[0].id}`)
      } else {
        router.push('/dashboard')
      }
    }
  }

  const displayName = activeProject?.name ?? 'No project'

  return (
    <>
      <div className="h-14 bg-archai-charcoal border-b border-archai-graphite flex items-center px-4 gap-4 shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 min-w-[100px]">
          <div className="w-6 h-6 rounded-sm bg-archai-orange flex items-center justify-center">
            <span className="text-white font-bold text-xs tracking-tight">A</span>
          </div>
          <span className="font-semibold text-white text-sm tracking-wide">ArchAI</span>
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-archai-graphite" />

        {/* Project Selector */}
        <DropdownMenu open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 text-sm text-white hover:text-white/80 transition-colors">
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[160px] truncate font-medium">{displayName}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {projects.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No projects yet
              </div>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="flex items-center gap-1 rounded-sm px-1">
                  <button
                    type="button"
                    onClick={() => handleSelectProject(project)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-white outline-none transition-colors hover:bg-archai-graphite focus-visible:bg-archai-graphite',
                      project.id === currentProjectId && 'text-archai-orange'
                    )}
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{project.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${project.name}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      openDeleteDialog(project)
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-red-900/20 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={openNewProjectDialog}>
              <Plus className="h-3.5 w-3.5" />
              New Project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Spacer */}
        <div className="flex-1" />

        {/* New Project Button */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={openNewProjectDialog}
        >
          <Plus className="h-3.5 w-3.5" />
          New Project
        </Button>

        {/* Add Tool Button */}
        <Button
          variant="archai"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={onAddTool}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Tool
        </Button>

        {/* User Avatar + Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md hover:bg-archai-graphite px-2 py-1 transition-colors">
              <Avatar className="h-7 w-7">
                <AvatarImage src={undefined} alt="User avatar" />
                <AvatarFallback className="text-[10px]">{userInitials}</AvatarFallback>
              </Avatar>
              <span className="text-xs text-muted-foreground max-w-[120px] truncate hidden sm:block">
                {user?.email ?? 'Account'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-white">{user?.email ?? 'User'}</span>
                <span className="text-[10px] text-muted-foreground">Pro Plan</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="h-3.5 w-3.5" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="h-3.5 w-3.5" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-400 focus:text-red-400 focus:bg-red-900/20"
              onClick={() => signOut()}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* New Project Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>
              Give your project a name to get started.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="space-y-4 pt-2">
            <Input
              placeholder="e.g. Riverside Mixed-Use"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              autoFocus
              disabled={creating}
            />
            {createError && (
              <p className="text-xs text-red-400">{createError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="archai"
                size="sm"
                disabled={!newProjectName.trim() || creating}
              >
                {creating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Creating…
                  </>
                ) : (
                  'Create Project'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={closeDeleteDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              This will permanently delete{' '}
              <span className="font-medium text-white">
                {projectPendingDeletion?.name ?? 'this project'}
              </span>
              .
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="pt-2 text-xs text-red-400">{deleteError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => closeDeleteDialog(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDeleteProject}
              disabled={!projectPendingDeletion || deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Project'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
