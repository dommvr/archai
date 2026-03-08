'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Map, Box, Grid3x3, Activity, Columns2, Leaf, BookOpen, FileText, PenLine, Download,
  type LucideIcon,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import type { ToolId } from '@/types'
import { cn } from '@/lib/utils'

interface ToolEntry {
  id: ToolId
  label: string
  description: string
  icon: LucideIcon
  href: string
  badge: string
}

const ALL_TOOLS: ToolEntry[] = [
  {
    id: 'site-analysis',
    label: 'Site Analysis & Zoning Checker',
    description: 'Parse zoning codes, check compliance, pre-check permits',
    icon: Map,
    href: '/dashboard/site-analysis',
    badge: 'Code Compliance',
  },
  {
    id: 'massing-generator',
    label: 'Massing Generator',
    description: 'Generate AI massing options from brief and site constraints',
    icon: Box,
    href: '/dashboard/massing',
    badge: 'Feasibility',
  },
  {
    id: 'space-planner',
    label: 'Space Planner & Test-Fit',
    description: 'Generate optimized space layouts from program requirements',
    icon: Grid3x3,
    href: '/dashboard/space-planner',
    badge: 'Planning',
  },
  {
    id: 'live-metrics',
    label: 'Live Metrics Dashboard',
    description: 'GFA, carbon, efficiency, and code risk in real-time',
    icon: Activity,
    href: '/dashboard/metrics',
    badge: 'Real-Time',
  },
  {
    id: 'option-comparison',
    label: 'Option Comparison Board',
    description: 'Compare design alternatives across key metrics',
    icon: Columns2,
    href: '/dashboard/comparison',
    badge: 'Decision Support',
  },
  {
    id: 'sustainability-copilot',
    label: 'Sustainability Copilot',
    description: 'Real-time embodied carbon and Ladybug environmental analysis',
    icon: Leaf,
    href: '/dashboard/sustainability',
    badge: 'Carbon + Energy',
  },
  {
    id: 'firm-knowledge',
    label: 'Firm Knowledge Assistant',
    description: 'AI search over firm documents, specs, and past projects',
    icon: BookOpen,
    href: '/dashboard/knowledge',
    badge: 'RAG / Knowledge',
  },
  {
    id: 'brief-translator',
    label: 'Brief-to-Program Translator',
    description: 'Extract structured program from client briefs',
    icon: FileText,
    href: '/dashboard/brief',
    badge: 'Programming',
  },
  {
    id: 'spec-writer',
    label: 'Spec Writer & Sketch-to-BIM',
    description: 'AI-generated specs and sketch-to-BIM translation',
    icon: PenLine,
    href: '/dashboard/specs',
    badge: 'Documentation',
  },
  {
    id: 'export-sync',
    label: 'Export & Revit Sync',
    description: 'Push to Revit/Rhino via Speckle, export IFC and reports',
    icon: Download,
    href: '/dashboard/export',
    badge: 'Export',
  },
]

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = useState('')

  // Reset query when closed
  useEffect(() => {
    if (!open) setTimeout(() => setQuery(''), 200)
  }, [open])

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        onOpenChange(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onOpenChange])

  const filtered = query.trim()
    ? ALL_TOOLS.filter(
        (t) =>
          t.label.toLowerCase().includes(query.toLowerCase()) ||
          t.description.toLowerCase().includes(query.toLowerCase()) ||
          t.badge?.toLowerCase().includes(query.toLowerCase())
      )
    : ALL_TOOLS

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Add Tool</DialogTitle>
          <DialogDescription>Search and launch AI tools</DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-archai-graphite">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="Search tools..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-auto"
            autoFocus
          />
          <span className="text-[10px] text-muted-foreground/50 shrink-0 border border-archai-graphite rounded px-1.5 py-0.5">
            ESC
          </span>
        </div>

        {/* Tool List */}
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No tools match &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((tool) => {
                const Icon = tool.icon
                return (
                  <button
                    key={tool.id}
                    onClick={() => {
                      // READY FOR TOOL NAVIGATION INTEGRATION HERE
                      console.log(`Launching tool: ${tool.id}`)
                      onOpenChange(false)
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left',
                      'hover:bg-archai-graphite transition-colors group'
                    )}
                  >
                    <div className="w-8 h-8 rounded-md bg-archai-black flex items-center justify-center shrink-0 group-hover:bg-archai-orange/10 transition-colors">
                      <Icon className="h-4 w-4 text-muted-foreground group-hover:text-archai-orange transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium truncate">{tool.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{tool.description}</div>
                    </div>
                    <span className="text-[10px] text-archai-orange/60 border border-archai-orange/20 rounded-full px-2 py-0.5 shrink-0">
                      {tool.badge}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-archai-graphite px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground/50">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>ESC close</span>
          <span className="ml-auto">⌘K to open</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
