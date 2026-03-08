'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Map, Box, Grid3x3, Activity, Columns2,
  Leaf, BookOpen, FileText, PenLine, Download, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import type { NavItem } from '@/types'

const ICON_MAP = {
  LayoutDashboard, Map, Box, Grid3x3, Activity, Columns2,
  Leaf, BookOpen, FileText, PenLine, Download,
}

type IconName = keyof typeof ICON_MAP

const NAV_ITEMS: (NavItem & { iconName: IconName })[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', iconName: 'LayoutDashboard', href: '/dashboard' },
  { id: 'site-analysis', label: 'Site Analysis', icon: 'Map', iconName: 'Map', href: '/dashboard/site-analysis' },
  { id: 'massing-generator', label: 'Massing Generator', icon: 'Box', iconName: 'Box', href: '/dashboard/massing' },
  { id: 'space-planner', label: 'Space Planner', icon: 'Grid3x3', iconName: 'Grid3x3', href: '/dashboard/space-planner' },
  { id: 'live-metrics', label: 'Live Metrics', icon: 'Activity', iconName: 'Activity', href: '/dashboard/metrics' },
  { id: 'option-comparison', label: 'Option Comparison', icon: 'Columns2', iconName: 'Columns2', href: '/dashboard/comparison' },
  { id: 'sustainability-copilot', label: 'Sustainability Copilot', icon: 'Leaf', iconName: 'Leaf', href: '/dashboard/sustainability' },
  { id: 'firm-knowledge', label: 'Firm Knowledge Base', icon: 'BookOpen', iconName: 'BookOpen', href: '/dashboard/knowledge' },
  { id: 'brief-translator', label: 'Brief Translator', icon: 'FileText', iconName: 'FileText', href: '/dashboard/brief' },
  { id: 'spec-writer', label: 'Spec Writer', icon: 'PenLine', iconName: 'PenLine', href: '/dashboard/specs' },
  { id: 'export-sync', label: 'Export & Revit Sync', icon: 'Download', iconName: 'Download', href: '/dashboard/export' },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()

  return (
    <TooltipProvider delayDuration={300}>
      <motion.nav
        animate={{ width: collapsed ? 56 : 220 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="h-full bg-archai-charcoal border-r border-archai-graphite flex flex-col overflow-hidden shrink-0"
        aria-label="Main navigation"
      >
        {/* Nav Items */}
        <div className="flex-1 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden px-2">
          {NAV_ITEMS.map((item) => {
            const Icon = ICON_MAP[item.iconName]
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))

            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-2 py-2 text-xs transition-all duration-150 group',
                      isActive
                        ? 'bg-archai-orange/10 text-archai-orange border border-archai-orange/20'
                        : 'text-muted-foreground hover:bg-archai-graphite hover:text-white'
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isActive ? 'text-archai-orange' : 'text-muted-foreground group-hover:text-white'
                      )}
                    />
                    <AnimatePresence>
                      {!collapsed && (
                        <motion.span
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: 'auto' }}
                          exit={{ opacity: 0, width: 0 }}
                          transition={{ duration: 0.2 }}
                          className="whitespace-nowrap overflow-hidden font-medium"
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </Link>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right" className="text-xs">
                    {item.label}
                  </TooltipContent>
                )}
              </Tooltip>
            )
          })}
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
