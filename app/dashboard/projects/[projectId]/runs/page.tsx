import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ProjectRuns } from '@/components/dashboard/ProjectRuns'

/**
 * Project Runs — all tool runs for a project.
 * V1 surfaces precheck runs; future tool types will appear here as stubs are implemented.
 */
export default async function ProjectRunsPage({
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

  return <ProjectRuns projectId={projectId} />
}
