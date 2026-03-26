import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ProjectOverview } from '@/components/dashboard/ProjectOverview'

/**
 * Project overview — the main landing workspace for a specific project.
 *
 * Shows: project summary, active model, latest runs, readiness, metrics, quick actions.
 * Verifies project ownership before rendering.
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
    .select('id, name, updated_at')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!project) redirect('/dashboard')

  return (
    <ProjectOverview
      projectId={projectId}
      projectName={project.name}
    />
  )
}
