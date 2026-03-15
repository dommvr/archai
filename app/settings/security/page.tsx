import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { SecuritySection } from '@/components/settings/sections/SecuritySection'
import type { AuthUser } from '@/types'

export default async function SecurityPage() {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/')

  const authUser: AuthUser = {
    id: user.id,
    email: user.email ?? undefined,
    user_metadata: user.user_metadata,
  }

  return <SecuritySection user={authUser} />
}
