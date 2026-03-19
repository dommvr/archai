'use server'

import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Returns whether the first-sign-in billing continuation modal should be shown.
 *
 * Conditions for showing the modal:
 *   1. User has plan_intent = 'premium'
 *   2. billing_prompt_dismissed_at IS NULL (never dismissed before)
 *
 * Returns { show: true } when both conditions are met,
 * { show: false } otherwise (also false on any DB/auth error — fail safe).
 *
 * Called server-side in dashboard/layout.tsx so the result can be passed
 * to DashboardShell as a prop — no client-side waterfall needed.
 */
export async function getPremiumBillingPromptState(): Promise<{ show: boolean }> {
  try {
    const supabase = await getSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { show: false }

    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('plan_intent, billing_prompt_dismissed_at')
      .eq('id', user.id)
      .maybeSingle()

    if (error || !profile) return { show: false }

    const show =
      profile.plan_intent === 'premium' &&
      profile.billing_prompt_dismissed_at === null

    return { show }
  } catch {
    // Fail safe — never crash the dashboard over a billing prompt check.
    return { show: false }
  }
}

/**
 * Mark the billing continuation prompt as dismissed for the current user.
 *
 * Writes the current timestamp to billing_prompt_dismissed_at.
 * Called when the user clicks "Maybe later" OR "Continue to billing"
 * in the PremiumBillingModal — in both cases we should not show it again.
 *
 * TODO: When Stripe is integrated, also update the subscription status here
 *       for the "Continue to billing" path (e.g. create a Stripe checkout session).
 */
export async function dismissBillingPrompt(): Promise<{ error?: string }> {
  try {
    const supabase = await getSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not authenticated.' }

    const { error } = await supabase
      .from('user_profiles')
      .update({ billing_prompt_dismissed_at: new Date().toISOString() })
      .eq('id', user.id)

    if (error) return { error: error.message }
    return {}
  } catch {
    return { error: 'Failed to dismiss billing prompt.' }
  }
}
