import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { PrecheckWorkspace } from '@/components/dashboard/precheck/PrecheckWorkspace'

export default async function PrecheckPage() {
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

  return (
    <PrecheckWorkspace
      user={{
        id:            user.id,
        email:         user.email         ?? undefined,
        user_metadata: user.user_metadata ?? undefined,
      }}
      projectId={project?.id ?? null}
    />
  )
}
