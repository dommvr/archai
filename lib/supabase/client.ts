import { createBrowserClient } from '@supabase/ssr'

// Singleton pattern — prevents creating multiple GoTrue auth instances on re-renders.
// Use this in 'use client' components and hooks.
let client: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseBrowserClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}
