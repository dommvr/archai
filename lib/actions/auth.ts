'use server'

import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { SignupFormData } from '@/types'

/**
 * Sign in with email and password.
 * Returns an error message if login fails, otherwise redirects to /dashboard.
 */
export async function signIn(email: string, password: string) {
  const supabase = await getSupabaseServerClient()

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: error.message }
  }

  redirect('/dashboard')
}

/**
 * Sign up with email and password.
 * Supabase will send a confirmation email (magic link or OTP depending on settings).
 */
export async function signUp(email: string, password: string) {
  const supabase = await getSupabaseServerClient()

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/dashboard`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  return { success: 'Check your email to confirm your account.' }
}

/**
 * Multi-step signup — creates the auth account AND writes the user profile row.
 *
 * Called after the user completes all 4 signup steps.
 * Profile data is written to public.user_profiles immediately after account
 * creation so it is available on first login even before email verification.
 *
 * Plan intent is stored on the profile row (no billing collected here).
 * Premium plan billing is deferred until after email verification / first login.
 * TODO: hook into a billing provider (e.g. Stripe) in the post-verification
 *       onboarding flow — check plan_intent on first authenticated session.
 */
export async function signUpWithProfile(data: SignupFormData) {
  const supabase = await getSupabaseServerClient()

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        full_name: data.fullName,
        company_or_studio: data.companyOrStudio || null,
        role: data.role || null,
        timezone: data.timezone,
        default_units: data.defaultUnits,
        plan_intent: data.planIntent,
      },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/dashboard`,
    },
  })

  if (authError) return { error: authError.message }
  if (!authData.user?.id) return { error: 'Account creation failed — no user ID returned.' }

  return {
    success: 'Account created. Check your email to verify before signing in.',
    planIntent: data.planIntent,
  }
}

/**
 * Resend the verification email for the given address.
 * Used on the Step 4 (Verify Email) screen.
 */
export async function resendVerificationEmail(email: string) {
  const supabase = await getSupabaseServerClient()

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/dashboard`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  return { success: 'Verification email resent — check your inbox.' }
}

/**
 * Send a magic link (passwordless) to the provided email.
 */
export async function sendMagicLink(email: string) {
  const supabase = await getSupabaseServerClient()

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/dashboard`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  return { success: 'Magic link sent — check your email.' }
}

/**
 * Sign out the current user and redirect to landing page.
 */
export async function signOut() {
  const supabase = await getSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/')
}
