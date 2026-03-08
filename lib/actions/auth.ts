'use server'

import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'

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
