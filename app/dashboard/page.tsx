import { ViewerPanel } from '@/components/dashboard/ViewerPanel'
import { ChatPanel } from '@/components/dashboard/ChatPanel'
import { MetricsPanel } from '@/components/dashboard/MetricsPanel'
import { Separator } from '@/components/ui/separator'

/**
 * Dashboard Home Page — the main workspace view.
 *
 * Layout:
 *   Left: Full-height 3D viewer (Speckle mount point)
 *   Right: AI Copilot chat (top) + Live Metrics (bottom)
 *
 * The DashboardShell layout.tsx provides the outer shell
 * (topbar, sidebar, statusbar). This page renders the content area.
 */
export default function DashboardPage() {
  return (
    <div className="flex h-full">
      {/* Main Viewer Area */}
      <div className="flex-1 min-w-0 relative">
        {/* SPECKLE VIEWER WILL BE MOUNTED HERE */}
        <ViewerPanel />
      </div>

      {/* Right Panel: Chat + Metrics */}
      <aside className="w-80 shrink-0 bg-archai-charcoal border-l border-archai-graphite flex flex-col overflow-hidden">
        {/* AI Copilot Chat — top portion */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <ChatPanel />
        </div>

        <Separator />

        {/* Live Metrics — bottom portion */}
        <div className="shrink-0 max-h-72 overflow-y-auto">
          <MetricsPanel />
        </div>
      </aside>
    </div>
  )
}
