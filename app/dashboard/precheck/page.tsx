import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * /dashboard/precheck — redirect shim.
 *
 * Keeps bookmarked or typed URLs working by forwarding to the correct
 * project-scoped precheck route. If no project exists, falls back to /dashboard.
 */
export default async function PrecheckRedirectPage() {
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
    redirect(`/dashboard/projects/${project.id}/precheck`)
  }

  redirect('/dashboard')
}
