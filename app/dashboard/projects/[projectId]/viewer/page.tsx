import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ProjectViewerLayout } from '@/components/dashboard/ProjectViewerLayout'

/**
 * Project Viewer — full-screen 3D model viewer with resizable right panel.
 *
 * Model resolution (handled client-side by ProjectViewerClient inside layout):
 *   ?previewModelId=<id>  → preview that specific model
 *   (none)                → project active model
 *
 * ProjectViewerClient fetches model data via the FastAPI route handler
 * (not direct Supabase), which bypasses RLS on speckle_model_refs.
 *
 * SPECKLE VIEWER WILL BE MOUNTED HERE
 */
export default async function ProjectViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ previewModelId?: string }>
}) {
  const { projectId } = await params
  const { previewModelId } = await searchParams
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')

  // Verify project ownership (projects table has no RLS — direct query works).
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!project) redirect('/dashboard')

  return (
    <ProjectViewerLayout
      projectId={projectId}
      previewModelId={previewModelId ?? null}
    />
  )
}
