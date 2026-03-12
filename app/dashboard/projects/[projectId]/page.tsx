import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ViewerPanel } from '@/components/dashboard/ViewerPanel'
import { ChatPanel } from '@/components/dashboard/ChatPanel'
import { MetricsPanel } from '@/components/dashboard/MetricsPanel'
import { ResizableVerticalSplit } from '@/components/ui/resizable-vertical-split'

/**
 * Project dashboard overview — the main workspace view for a specific project.
 *
 * Layout:
 *   Left: Full-height 3D viewer (Speckle mount point)
 *   Right: Live Metrics (top) + AI Copilot chat (bottom), vertically resizable
 *
 * Verifies the project belongs to the authenticated user before rendering.
 * Redirects to /dashboard if the projectId is invalid or unauthorised.
 */
export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!project) redirect('/dashboard')

  return (
    <div className="flex h-full">
      {/* Main Viewer Area */}
      <div className="flex-1 min-w-0 relative">
        {/* SPECKLE VIEWER WILL BE MOUNTED HERE */}
        <ViewerPanel />
      </div>

      {/* Right Panel: Metrics + Chat — vertically resizable */}
      <aside className="w-80 shrink-0 bg-archai-charcoal border-l border-archai-graphite overflow-hidden">
        <ResizableVerticalSplit
          storageKey="dashboard-right-split"
          defaultTopPercent={35}
          minTopPercent={20}
          maxTopPercent={70}
          topPanel={
            <div className="h-full overflow-y-auto">
              <MetricsPanel />
            </div>
          }
          bottomPanel={<ChatPanel />}
        />
      </aside>
    </div>
  )
}
