import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ProjectModels } from '@/components/dashboard/ProjectModels'

/**
 * Project Models — model library and active model management for a project.
 *
 * Models belong to the project. One model/version can be marked active
 * and used as the default across all tool runs.
 */
export default async function ProjectModelsPage({
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

  return <ProjectModels projectId={projectId} />
}
