import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ProjectDocuments } from '@/components/dashboard/ProjectDocuments'

/**
 * Project Documents — all documents uploaded across all runs for this project.
 * Reuses the precheck-level document schema at project scope.
 */
export default async function ProjectDocumentsPage({
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

  return <ProjectDocuments projectId={projectId} />
}
