import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Dashboard root — smart redirect.
 *
 * Finds the user's most-recently-updated project and redirects to its
 * project-scoped overview. If the user has no projects, renders an inline
 * empty state so they can create one via the "New Project" Topbar button.
 */
export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (project?.id) {
    redirect(`/dashboard/projects/${project.id}`)
  }

  // No projects yet — rendered within the DashboardShell provided by layout.tsx
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">No projects yet.</p>
        <p className="text-xs text-muted-foreground">
          Use the <span className="font-medium text-white">New Project</span> button above to get started.
        </p>
      </div>
    </div>
  )
}
