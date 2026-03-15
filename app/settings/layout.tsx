import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { SettingsShell } from '@/components/settings/SettingsShell'
import type { AuthUser } from '@/types'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
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

  return <SettingsShell user={authUser}>{children}</SettingsShell>
}
