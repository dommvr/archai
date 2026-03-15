import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Update the Supabase session in middleware.
 *
 * This handles:
 * 1. Session token refresh (writes updated cookies to both request and response)
 * 2. Route protection for /dashboard paths
 * 3. Redirect authenticated users away from / to /dashboard
 *
 * The dual cookie write pattern (request + response) ensures:
 * - The refreshed token is available to downstream Server Components in the same request
 * - The refreshed token is sent back to the browser via Set-Cookie headers
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // Start with a pass-through response that we'll modify as needed
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write to request so downstream server components see the updated cookies
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          // Rebuild the response with the updated request cookies
          supabaseResponse = NextResponse.next({ request })
          // Also write to response so the browser receives the updated cookies
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // CRITICAL: Do not use getSession() here — it does not validate the JWT.
  // getUser() makes a network call to Supabase to verify the token is valid.
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Protect /dashboard and all sub-routes
  if (pathname.startsWith('/dashboard') && !user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/'
    redirectUrl.searchParams.set('authRequired', '1')
    return NextResponse.redirect(redirectUrl)
  }

  // Protect /settings and all sub-routes
  if (pathname.startsWith('/settings') && !user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/'
    redirectUrl.searchParams.set('authRequired', '1')
    return NextResponse.redirect(redirectUrl)
  }

  // Redirect authenticated users away from the landing page to the dashboard
  if (pathname === '/' && user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/dashboard'
    return NextResponse.redirect(redirectUrl)
  }

  // Protect API agent routes — return 401 JSON instead of redirect
  if (pathname.startsWith('/api/agents/') && !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return supabaseResponse
}
