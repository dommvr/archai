'use client'

import { createContext, useState } from 'react'
import { Topbar } from './Topbar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { CommandPalette } from './CommandPalette'
import type { AuthUser, Project } from '@/types'

// UserContext — distributes the SSR-fetched user to client components
// without prop drilling. Topbar reads from this directly.
export const UserContext = createContext<AuthUser | null>(null)

export interface ProjectContextValue {
  projects: Project[]
  addProject: (project: Project) => void
  removeProject: (projectId: string) => void
}

// ProjectContext — distributes the real project list for the dropdown and
// mutation helpers. The canonical selected project comes from the URL
// (route params), not from this context.
export const ProjectContext = createContext<ProjectContextValue>({
  projects: [],
  addProject: () => {},
  removeProject: () => {},
})

interface DashboardShellProps {
  user: AuthUser | null
  initialProjects: Project[]
  children: React.ReactNode
}

/**
 * DashboardShell — CSS Grid layout orchestrator for the dashboard.
 *
 * Layout grid:
 *   Rows:    topbar (56px) / content area / statusbar (28px)
 *   Columns: sidebar (56px or 220px) / main workspace / right panel (320px)
 *
 * Manages:
 * - Sidebar collapsed/expanded state
 * - Command palette open state (Cmd+K or "+ Add Tool" button)
 * - UserContext.Provider for auth state distribution
 * - ProjectContext.Provider for the project list (dropdown + mutations)
 *
 * The active project is NOT stored here. It is derived from the URL
 * via useParams() in Topbar and Sidebar so that navigation is the
 * single source of truth.
 */
export function DashboardShell({ user, initialProjects, children }: DashboardShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>(initialProjects)

  const addProject = (project: Project) => {
    setProjects((prev) => [project, ...prev])
  }

  const removeProject = (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId))
  }

  return (
    <UserContext.Provider value={user}>
      <ProjectContext.Provider value={{ projects, addProject, removeProject }}>
        <div className="h-screen flex flex-col bg-archai-black overflow-hidden">
          {/* Top Bar */}
          <Topbar onAddTool={() => setPaletteOpen(true)} />

          {/* Main Content Area */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left Sidebar */}
            <Sidebar
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed((v) => !v)}
            />

            {/* Page content — viewer + right panel rendered by each page */}
            {/* READY FOR RESIZABLE PANELS INTEGRATION HERE */}
            <div className="flex-1 min-w-0 overflow-hidden">
              {children}
            </div>
          </div>

          {/* Status Bar */}
          <StatusBar />

          {/* Command Palette */}
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        </div>
      </ProjectContext.Provider>
    </UserContext.Provider>
  )
}
