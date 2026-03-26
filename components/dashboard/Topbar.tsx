'use client'

import { useState, useContext, useEffect, useCallback, useRef } from 'react'
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
  CreditCard,
  FolderOpen,
  Loader2,
  Pin,
  PinOff,
  LayoutGrid,
  RefreshCw,
  UserCog,
} from 'lucide-react'
import { signOut } from '@/lib/actions/auth'
import { createProject } from '@/lib/actions/projects'
import { UserContext, ProjectContext } from './DashboardShell'
import { AllProjectsDialog } from './AllProjectsDialog'
import { ProjectModelSyncDialog } from './ProjectModelSyncDialog'
import { useProjectMeta, sortProjectsForSwitcher } from '@/hooks/useProjectMeta'
import * as precheckApi from '@/lib/precheck/api'
import type { Project } from '@/types'
import type { SpeckleModelRef } from '@/lib/precheck/types'

interface TopbarProps {
  onAddTool: () => void
}

export function Topbar({ onAddTool }: TopbarProps) {
  const user = useContext(UserContext)
  const { projects, addProject } = useContext(ProjectContext)
  const router = useRouter()
  const pathname = usePathname()

  const params = useParams<{ projectId?: string }>()
  const currentProjectId = params.projectId ?? null
  const activeProject = projects.find((p) => p.id === currentProjectId) ?? null

  const { recordOpened, togglePin, getProjectMeta } = useProjectMeta()

  // Force re-render when pin state changes (stored in localStorage)
  const [pinRevision, setPinRevision] = useState(0)

  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [allProjectsOpen, setAllProjectsOpen] = useState(false)
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [syncModelOpen, setSyncModelOpen] = useState(false)

  // Active model ref for the current project — used to power "Sync/Resync" button
  const [activeModelRef, setActiveModelRef] = useState<SpeckleModelRef | null>(null)
  // resyncing stays true until syncedAt transitions from null → value (real completion).
  const [resyncing, setResyncing] = useState(false)
  const resyncPollTimer   = useRef<ReturnType<typeof setInterval> | null>(null)
  const resyncPollDeadline = useRef<ReturnType<typeof setTimeout>  | null>(null)

  // Clear polling on unmount
  useEffect(() => {
    return () => {
      if (resyncPollTimer.current)   clearInterval(resyncPollTimer.current)
      if (resyncPollDeadline.current) clearTimeout(resyncPollDeadline.current)
    }
  }, [])

  // Record last-opened whenever the active project changes
  useEffect(() => {
    if (currentProjectId) recordOpened(currentProjectId)
  }, [currentProjectId, recordOpened])

  // Fetch active model ref so "Resync" knows the current streamId/versionId
  const refreshActiveModelRef = useCallback((projectId: string) => {
    precheckApi.getProjectActiveModelRef(projectId)
      .then((ref) => setActiveModelRef(ref ?? null))
      .catch(() => setActiveModelRef(null))
  }, [])

  useEffect(() => {
    if (currentProjectId) {
      refreshActiveModelRef(currentProjectId)
    } else {
      setActiveModelRef(null)
    }
  }, [currentProjectId, refreshActiveModelRef])

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    null

  const userInitials = displayName
    ? displayName.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : (user?.email ? user.email.slice(0, 2).toUpperCase() : 'U')

  /**
   * Preserve the tool segment when switching projects.
   * e.g. /dashboard/projects/old-id/precheck → /dashboard/projects/new-id/precheck
   */
  const routeForProject = (projectId: string): string => {
    const match = pathname.match(/\/dashboard\/projects\/[^/]+(\/[^?#]*)/)
    const toolSuffix = match?.[1] ?? ''
    return `/dashboard/projects/${projectId}${toolSuffix}`
  }

  const handleSelectProject = (projectId: string) => {
    setProjectMenuOpen(false)
    if (projectId === currentProjectId) return
    recordOpened(projectId)
    router.push(routeForProject(projectId))
  }

  const handlePin = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    togglePin(projectId)
    setPinRevision((v) => v + 1)
  }

  const openNewProjectDialog = () => {
    setProjectMenuOpen(false)
    setNewProjectName('')
    setCreateError(null)
    setNewProjectDialogOpen(true)
  }

  /**
   * Sync/Resync the project's current active model (triggers geometry extraction).
   * Only available when an active model ref exists.
   *
   * The backend returns immediately — the actual extraction runs in the background.
   * We poll GET active-model until syncedAt changes, then clear the resyncing state.
   * This ensures the button stays in "syncing" state for the full real duration.
   */
  async function handleResync() {
    if (!currentProjectId || !activeModelRef || resyncing) return
    setResyncing(true)

    try {
      await precheckApi.syncProjectModel({
        projectId:  currentProjectId,
        streamId:   activeModelRef.streamId,
        versionId:  activeModelRef.versionId,
        branchName: activeModelRef.branchName ?? undefined,
        modelName:  activeModelRef.modelName  ?? undefined,
      })
    } catch {
      // Network / backend error — stop spinner immediately
      setResyncing(false)
      return
    }

    // Poll until syncedAt appears (background task complete) or 90s timeout.
    const POLL_MS    = 2_500
    const TIMEOUT_MS = 90_000

    resyncPollDeadline.current = setTimeout(() => {
      if (resyncPollTimer.current) clearInterval(resyncPollTimer.current)
      resyncPollTimer.current = null
      setResyncing(false)
      if (currentProjectId) refreshActiveModelRef(currentProjectId)
    }, TIMEOUT_MS)

    resyncPollTimer.current = setInterval(async () => {
      try {
        const ref = await precheckApi.getProjectActiveModelRef(currentProjectId)
        if (ref?.syncedAt) {
          // Real sync complete
          if (resyncPollTimer.current)   clearInterval(resyncPollTimer.current)
          if (resyncPollDeadline.current) clearTimeout(resyncPollDeadline.current)
          resyncPollTimer.current   = null
          resyncPollDeadline.current = null
          setActiveModelRef(ref)
          setResyncing(false)
        }
      } catch {
        // Network error — keep polling
      }
    }, POLL_MS)
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
    setNewProjectDialogOpen(false)
    router.push(`/dashboard/projects/${project.id}`)
  }

  // Build the compact switcher list: pinned first, then recent, max 5, no duplicates
  // Re-computed whenever pinRevision changes (pin/unpin) or projects list changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pinRevision is the intentional dependency
  const switcherProjects = sortProjectsForSwitcher(projects, 5)

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

        {/* Project Switcher */}
        <DropdownMenu open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 text-sm text-white hover:text-white/80 transition-colors">
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[160px] truncate font-medium">
                {activeProject?.name ?? 'No project'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium pb-1">
              Projects
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {switcherProjects.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                No projects yet
              </div>
            ) : (
              switcherProjects.map((project) => {
                const meta = getProjectMeta(project.id)
                return (
                  <div key={project.id} className="group flex items-center gap-1 rounded-sm px-1">
                    <button
                      type="button"
                      onClick={() => handleSelectProject(project.id)}
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-white outline-none transition-colors hover:bg-archai-graphite focus-visible:bg-archai-graphite',
                        project.id === currentProjectId && 'text-archai-orange',
                      )}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{project.name}</span>
                      {meta.pinned && (
                        <Pin className="h-2.5 w-2.5 shrink-0 text-archai-amber/70 ml-auto" />
                      )}
                    </button>

                    {/* Pin toggle — visible on hover */}
                    <button
                      type="button"
                      aria-label={meta.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
                      onClick={(e) => handlePin(e, project.id)}
                      className="opacity-0 group-hover:opacity-100 inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:text-archai-amber transition-colors focus-visible:opacity-100"
                    >
                      {meta.pinned
                        ? <PinOff className="h-3.5 w-3.5" />
                        : <Pin className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )
              })
            )}

            <DropdownMenuSeparator />

            {/* See all projects */}
            <DropdownMenuItem
              onClick={() => {
                setProjectMenuOpen(false)
                setAllProjectsOpen(true)
              }}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              See all projects
              {projects.length > 5 && (
                <span className="ml-auto text-[10px] text-muted-foreground">{projects.length}</span>
              )}
            </DropdownMenuItem>

            <DropdownMenuItem onClick={openNewProjectDialog}>
              <Plus className="h-3.5 w-3.5" />
              New Project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Contextual action buttons — only shown when inside a project */}
        {currentProjectId && (
          <div className="flex items-center gap-2">
            {/* Sync / Resync — only shown when a project active model exists.
                Label is "Sync" if never synced, "Resync" if already synced once. */}
            {activeModelRef && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => void handleResync()}
                disabled={resyncing}
                title={`${activeModelRef.syncedAt ? 'Resync' : 'Sync'}: ${activeModelRef.modelName ?? activeModelRef.streamId}`}
              >
                {resyncing
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RefreshCw className="h-3 w-3" />}
                {activeModelRef.syncedAt ? 'Resync' : 'Sync'}
              </Button>
            )}
            {/* Add Model — always shown; opens dialog to link a new model version */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => setSyncModelOpen(true)}
            >
              <Plus className="h-3 w-3" />
              Add Model
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => router.push(`/dashboard/projects/${currentProjectId}/documents`)}
            >
              Upload Docs
            </Button>
            <Button
              variant="archai"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => router.push(`/dashboard/projects/${currentProjectId}/precheck`)}
            >
              Run Precheck
            </Button>
          </div>
        )}

        {/* No active project: show New Project button */}
        {!currentProjectId && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={openNewProjectDialog}
          >
            <Plus className="h-3.5 w-3.5" />
            New Project
          </Button>
        )}

        {/* User Avatar + Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md hover:bg-archai-graphite px-2 py-1 transition-colors">
              <Avatar className="h-7 w-7">
                <AvatarImage src={undefined} alt="User avatar" />
                <AvatarFallback className="text-[10px]">{userInitials}</AvatarFallback>
              </Avatar>
              <span className="text-xs text-muted-foreground max-w-[120px] truncate hidden sm:block">
                {displayName ?? user?.email ?? 'Account'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-white">{displayName ?? user?.email ?? 'User'}</span>
                {displayName && (
                  <span className="text-[10px] text-muted-foreground truncate">{user?.email}</span>
                )}
                <span className="text-[10px] text-muted-foreground">Pro Plan</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/settings/account')}>
              <UserCog className="h-3.5 w-3.5" />
              Account &amp; Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/settings/billing')}>
              <CreditCard className="h-3.5 w-3.5" />
              Billing
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
      <Dialog open={newProjectDialogOpen} onOpenChange={setNewProjectDialogOpen}>
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
                onClick={() => setNewProjectDialogOpen(false)}
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

      {/* Sync Model Dialog — opens in-place from anywhere in the project */}
      {currentProjectId && (
        <ProjectModelSyncDialog
          projectId={currentProjectId}
          open={syncModelOpen}
          onOpenChange={setSyncModelOpen}
          onSynced={() => {
            // Refresh active model ref so Resync button appears if first model was just synced
            refreshActiveModelRef(currentProjectId)
          }}
        />
      )}

      {/* All Projects Dialog */}
      <AllProjectsDialog
        open={allProjectsOpen}
        onOpenChange={setAllProjectsOpen}
        currentProjectId={currentProjectId}
        onSelectProject={handleSelectProject}
        onNewProject={openNewProjectDialog}
      />
    </>
  )
}
