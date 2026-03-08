import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Create a Supabase client for use in Server Components and Server Actions.
 *
 * IMPORTANT: Must be called inside an async function (not at module level).
 * `cookies()` is async in Next.js 15+ — always await it.
 *
 * NOTE: Server Components cannot set cookies (only read them).
 * The `setAll` handler uses a try/catch to silently fail when called from
 * a Server Component context — token refresh is handled by middleware instead.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Expected in Server Components — middleware handles token refresh.
          }
        },
      },
    }
  )
}
