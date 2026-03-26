import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { PrecheckWorkspaceWrapper } from '@/components/dashboard/precheck/PrecheckWorkspaceWrapper'

/**
 * Project-scoped Zoning & Permit Check (Tool 1).
 *
 * Loads the project's active model ref (stored client-side) and passes it
 * to PrecheckWorkspace so new runs are pre-filled with the project default.
 * The projectId is the canonical key — no global state required.
 */
export default async function ProjectPrecheckPage({
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
    <PrecheckWorkspaceWrapper
      user={{
        id: user.id,
        email: user.email ?? undefined,
        user_metadata: user.user_metadata ?? undefined,
      }}
      projectId={projectId}
    />
  )
}
