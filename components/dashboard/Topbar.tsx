'use client'

import { useState, useContext } from 'react'
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
import { ChevronDown, Plus, LogOut, Settings, User, FolderOpen } from 'lucide-react'
import { signOut } from '@/lib/actions/auth'
import { UserContext } from './DashboardShell'

const DEMO_PROJECTS = [
  { id: '1', name: 'Riverside Mixed-Use' },
  { id: '2', name: 'Park Lane Residential' },
  { id: '3', name: 'Civic Centre Feasibility' },
]

interface TopbarProps {
  onAddTool: () => void
}

export function Topbar({ onAddTool }: TopbarProps) {
  const user = useContext(UserContext)
  const [activeProject, setActiveProject] = useState(DEMO_PROJECTS[0])

  const userInitials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : 'U'

  return (
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 text-sm text-white hover:text-white/80 transition-colors">
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="max-w-[160px] truncate font-medium">{activeProject.name}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {DEMO_PROJECTS.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onClick={() => setActiveProject(project)}
              className={activeProject.id === project.id ? 'text-archai-orange' : ''}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {project.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem>
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
        onClick={() => {
          // READY FOR NEW PROJECT FLOW INTEGRATION HERE
          console.log('New Project')
        }}
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
  )
}
