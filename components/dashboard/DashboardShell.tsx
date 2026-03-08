'use client'

import { createContext, useState } from 'react'
import { Topbar } from './Topbar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { CommandPalette } from './CommandPalette'
import { Plus } from 'lucide-react'
import type { AuthUser } from '@/types'
import { Button } from '@/components/ui/button'

// UserContext — distributes the SSR-fetched user to client components
// without prop drilling. Topbar reads from this directly.
export const UserContext = createContext<AuthUser | null>(null)

interface DashboardShellProps {
  user: AuthUser | null
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
 */
export function DashboardShell({ user, children }: DashboardShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  return (
    <UserContext.Provider value={user}>
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

        {/* Floating "+ Add Tool" FAB */}
        <Button
          variant="archai"
          size="icon"
          className="fixed bottom-10 right-6 h-10 w-10 rounded-full shadow-xl z-30 glow-orange"
          onClick={() => setPaletteOpen(true)}
          aria-label="Add tool (⌘K)"
        >
          <Plus className="h-5 w-5" />
        </Button>

        {/* Command Palette */}
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </UserContext.Provider>
  )
}
