import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { getProjects } from '@/lib/actions/projects'
import { getPremiumBillingPromptState } from '@/lib/actions/billing'
import type { AuthUser } from '@/types'

/**
 * Dashboard Layout — Server Component.
 *
 * Secondary auth protection (primary is middleware.ts).
 * Fetches the authenticated user server-side so it can be passed
 * to DashboardShell → UserContext without client-side waterfall.
 *
 * Also fetches the user's projects so the Topbar project switcher
 * can be initialised with real data.
 *
 * IMPORTANT: Uses getUser() not getSession() — getUser() validates the JWT
 * via a network call to Supabase, ensuring token hasn't been revoked.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await getSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (!user || error) {
    redirect('/')
  }

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    user_metadata: user.user_metadata as Record<string, unknown>,
  }

  // Run projects fetch and billing prompt check in parallel — neither depends on the other.
  const [{ projects }, { show: showBillingPrompt }] = await Promise.all([
    getProjects(),
    getPremiumBillingPromptState(),
  ])

  return (
    <DashboardShell user={authUser} initialProjects={projects} showBillingPrompt={showBillingPrompt}>
      {children}
    </DashboardShell>
  )
}
