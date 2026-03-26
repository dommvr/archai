'use client'

import { useState } from 'react'
import { usePathname, useParams } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Box,
  FileText,
  PlaySquare,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Map,
  Grid3x3,
  Activity,
  Columns2,
  Leaf,
  BookOpen,
  PenLine,
  Download,
  Eye,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'

// ── Project-level section items ───────────────────────────────────────────────

interface SectionItem {
  id: string
  label: string
  Icon: React.ComponentType<{ className?: string }>
  segment: string  // URL segment relative to /dashboard/projects/[id]/
}

const PROJECT_SECTIONS: SectionItem[] = [
  { id: 'overview',   label: 'Overview',   Icon: LayoutDashboard, segment: ''          },
  { id: 'viewer',     label: 'Viewer',     Icon: Eye,             segment: 'viewer'    },
  { id: 'models',     label: 'Models',     Icon: Box,             segment: 'models'    },
  { id: 'documents',  label: 'Documents',  Icon: FileText,        segment: 'documents' },
  { id: 'runs',       label: 'Runs',       Icon: PlaySquare,      segment: 'runs'      },
]

// ── Tool sub-items (shown collapsed under "Tools") ────────────────────────────

interface ToolItem {
  id: string
  label: string
  Icon: React.ComponentType<{ className?: string }>
  segment: string
}

const TOOL_ITEMS: ToolItem[] = [
  { id: 'precheck',              label: 'Zoning & Code Check',    Icon: Map,        segment: 'precheck'      },
  { id: 'massing-generator',     label: 'Massing Generator',      Icon: Box,        segment: 'massing'       },
  { id: 'space-planner',         label: 'Space Planner',          Icon: Grid3x3,    segment: 'space-planner' },
  { id: 'live-metrics',          label: 'Live Metrics',           Icon: Activity,   segment: 'metrics'       },
  { id: 'option-comparison',     label: 'Option Comparison',      Icon: Columns2,   segment: 'comparison'    },
  { id: 'sustainability-copilot',label: 'Sustainability Copilot', Icon: Leaf,       segment: 'sustainability' },
  { id: 'firm-knowledge',        label: 'Firm Knowledge',         Icon: BookOpen,   segment: 'knowledge'     },
  { id: 'brief-translator',      label: 'Brief Translator',       Icon: FileText,   segment: 'brief'         },
  { id: 'spec-writer',           label: 'Spec Writer',            Icon: PenLine,    segment: 'specs'         },
  { id: 'export-sync',           label: 'Export & Sync',          Icon: Download,   segment: 'export'        },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function sectionHref(projectId: string | null, segment: string): string {
  if (!projectId) return '/dashboard'
  const base = `/dashboard/projects/${projectId}`
  return segment ? `${base}/${segment}` : base
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const params = useParams<{ projectId?: string }>()
  const projectId = params.projectId ?? null

  // Tools group starts expanded when a tool route is active
  const isOnToolRoute = TOOL_ITEMS.some((t) =>
    projectId && pathname.startsWith(`/dashboard/projects/${projectId}/${t.segment}`)
  )
  const [toolsOpen, setToolsOpen] = useState(isOnToolRoute)

  function isActive(segment: string): boolean {
    if (!projectId) return false
    const href = sectionHref(projectId, segment)
    // Overview: exact match only so it doesn't highlight on sub-routes
    if (segment === '') return pathname === href
    return pathname === href || pathname.startsWith(href + '/')
  }

  const noProject = !projectId

  return (
    <TooltipProvider delayDuration={300}>
      <motion.nav
        animate={{ width: collapsed ? 56 : 220 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="h-full bg-archai-charcoal border-r border-archai-graphite flex flex-col overflow-hidden shrink-0"
        aria-label="Main navigation"
      >
        <div className="flex-1 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden px-2">

          {/* ── Project sections ─────────────────────────── */}
          {PROJECT_SECTIONS.map(({ id, label, Icon, segment }) => {
            const href = sectionHref(projectId, segment)
            const active = isActive(segment)
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <Link
                    href={noProject ? '/dashboard' : href}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-2 py-2 text-xs transition-all duration-150 group',
                      active
                        ? 'bg-archai-orange/10 text-archai-orange border border-archai-orange/20'
                        : noProject
                          ? 'text-muted-foreground/40 pointer-events-none'
                          : 'text-muted-foreground hover:bg-archai-graphite hover:text-white',
                    )}
                    aria-current={active ? 'page' : undefined}
                    tabIndex={noProject ? -1 : 0}
                  >
                    <Icon className={cn(
                      'h-4 w-4 shrink-0',
                      active ? 'text-archai-orange' : 'text-muted-foreground group-hover:text-white',
                    )} />
                    <AnimatePresence>
                      {!collapsed && (
                        <motion.span
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: 'auto' }}
                          exit={{ opacity: 0, width: 0 }}
                          transition={{ duration: 0.2 }}
                          className="whitespace-nowrap overflow-hidden font-medium"
                        >
                          {label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </Link>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right" className="text-xs">{label}</TooltipContent>
                )}
              </Tooltip>
            )
          })}

          {/* ── Separator before Tools ───────────────────── */}
          <div className="py-1">
            <Separator />
          </div>

          {/* ── Tools collapsible group ──────────────────── */}
          {collapsed ? (
            /* In collapsed mode show each tool icon directly */
            TOOL_ITEMS.map(({ id, label, Icon, segment }) => {
              const href = sectionHref(projectId, segment)
              const active = isActive(segment)
              return (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>
                    <Link
                      href={noProject ? '/dashboard' : href}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2 py-2 text-xs transition-all duration-150 group',
                        active
                          ? 'bg-archai-orange/10 text-archai-orange border border-archai-orange/20'
                          : noProject
                            ? 'text-muted-foreground/40 pointer-events-none'
                            : 'text-muted-foreground hover:bg-archai-graphite hover:text-white',
                      )}
                      aria-current={active ? 'page' : undefined}
                      tabIndex={noProject ? -1 : 0}
                    >
                      <Icon className={cn(
                        'h-4 w-4 shrink-0',
                        active ? 'text-archai-orange' : 'text-muted-foreground group-hover:text-white',
                      )} />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">{label}</TooltipContent>
                </Tooltip>
              )
            })
          ) : (
            /* Expanded: show collapsible Tools group */
            <>
              <button
                onClick={() => setToolsOpen((v) => !v)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-md px-2 py-2 text-xs transition-colors group',
                  isOnToolRoute
                    ? 'text-archai-orange'
                    : 'text-muted-foreground hover:bg-archai-graphite hover:text-white',
                )}
                aria-expanded={toolsOpen}
              >
                <PlaySquare className={cn(
                  'h-4 w-4 shrink-0',
                  isOnToolRoute ? 'text-archai-orange' : 'text-muted-foreground group-hover:text-white',
                )} />
                <span className="flex-1 text-left font-medium whitespace-nowrap overflow-hidden">Tools</span>
                <ChevronDown className={cn(
                  'h-3 w-3 shrink-0 transition-transform',
                  toolsOpen && 'rotate-180',
                )} />
              </button>

              <AnimatePresence initial={false}>
                {toolsOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden pl-3 space-y-0.5"
                  >
                    {TOOL_ITEMS.map(({ id, label, Icon, segment }) => {
                      const href = sectionHref(projectId, segment)
                      const active = isActive(segment)
                      return (
                        <Link
                          key={id}
                          href={noProject ? '/dashboard' : href}
                          className={cn(
                            'flex items-center gap-3 rounded-md px-2 py-1.5 text-xs transition-all duration-150 group',
                            active
                              ? 'bg-archai-orange/10 text-archai-orange border border-archai-orange/20'
                              : noProject
                                ? 'text-muted-foreground/40 pointer-events-none'
                                : 'text-muted-foreground hover:bg-archai-graphite hover:text-white',
                          )}
                          aria-current={active ? 'page' : undefined}
                          tabIndex={noProject ? -1 : 0}
                        >
                          <Icon className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            active ? 'text-archai-orange' : 'text-muted-foreground group-hover:text-white',
                          )} />
                          <span className="whitespace-nowrap overflow-hidden font-medium">{label}</span>
                        </Link>
                      )
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {/* ── Settings at bottom ───────────────────────── */}
          <div className="py-1">
            <Separator />
          </div>

          {(() => {
            const href = sectionHref(projectId, 'settings')
            const active = isActive('settings')
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={noProject ? '/dashboard' : href}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-2 py-2 text-xs transition-all duration-150 group',
                      active
                        ? 'bg-archai-orange/10 text-archai-orange border border-archai-orange/20'
                        : noProject
                          ? 'text-muted-foreground/40 pointer-events-none'
                          : 'text-muted-foreground hover:bg-archai-graphite hover:text-white',
                    )}
                    aria-current={active ? 'page' : undefined}
                    tabIndex={noProject ? -1 : 0}
                  >
                    <Settings className={cn(
                      'h-4 w-4 shrink-0',
                      active ? 'text-archai-orange' : 'text-muted-foreground group-hover:text-white',
                    )} />
                    <AnimatePresence>
                      {!collapsed && (
                        <motion.span
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: 'auto' }}
                          exit={{ opacity: 0, width: 0 }}
                          transition={{ duration: 0.2 }}
                          className="whitespace-nowrap overflow-hidden font-medium"
                        >
                          Settings
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </Link>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right" className="text-xs">Settings</TooltipContent>
                )}
              </Tooltip>
            )
          })()}
        </div>

        {/* Collapse toggle */}
        <div className="px-2 pb-3 pt-2">
          <Separator className="mb-3" />
          <button
            onClick={onToggle}
            className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-muted-foreground hover:bg-archai-graphite hover:text-white transition-colors text-xs"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span className="font-medium">Collapse</span>
              </>
            )}
          </button>
        </div>
      </motion.nav>
    </TooltipProvider>
  )
}
