import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { PrecheckWorkspace } from '@/components/dashboard/precheck/PrecheckWorkspace'

export default async function PrecheckPage() {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')

  return (
    <PrecheckWorkspace
      user={{
        id:            user.id,
        email:         user.email         ?? undefined,
        user_metadata: user.user_metadata ?? undefined,
      }}
    />
  )
}