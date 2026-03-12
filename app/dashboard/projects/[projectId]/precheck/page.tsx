import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { PrecheckWorkspace } from '@/components/dashboard/precheck/PrecheckWorkspace'

/**
 * Project-scoped Zoning & Permit Check (Tool 1).
 *
 * The projectId in the URL is the canonical source of truth for which
 * project's runs, site context, rules, and compliance results are loaded.
 * PrecheckWorkspace receives it directly — no global state required.
 *
 * Verifies the project belongs to the authenticated user before rendering.
 * Redirects to /dashboard if the projectId is invalid or unauthorised.
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
    <PrecheckWorkspace
      user={{
        id: user.id,
        email: user.email ?? undefined,
        user_metadata: user.user_metadata ?? undefined,
      }}
      projectId={projectId}
    />
  )
}
