'use client'

import { useEffect, useState, useCallback } from 'react'
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
}

/**
 * Hook for accessing authentication state in client components.
 *
 * Returns the current user, session, loading state, and a signOut function.
 * Listens for auth state changes (sign in, sign out, token refresh) and
 * updates state automatically.
 *
 * Usage:
 *   const { user, loading, signOut } = useAuth()
 */
export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  })

  const supabase = getSupabaseBrowserClient()

  useEffect(() => {
    // Get the initial session on mount
    void supabase.auth.getSession().then(
      (response: { data: { session: Session | null }; error: unknown }) => {
        const session = response.data.session
        setState({ user: session?.user ?? null, session, loading: false })
      }
    )

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        setState({ user: session?.user ?? null, session, loading: false })
      }
    )

    return () => subscription.unsubscribe()
  }, [supabase.auth])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [supabase.auth])

  return {
    user: state.user,
    session: state.session,
    loading: state.loading,
    signOut,
  }
}
