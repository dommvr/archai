'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowLeft,
  User,
  Link2,
  Shield,
  CreditCard,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AuthUser } from '@/types'

interface SettingsNavItem {
  id: string
  label: string
  href: string
  Icon: React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: SettingsNavItem[] = [
  { id: 'account',      label: 'Account',      href: '/settings/account',      Icon: User },
  { id: 'integrations', label: 'Integrations', href: '/settings/integrations', Icon: Link2 },
  { id: 'security',     label: 'Security',     href: '/settings/security',     Icon: Shield },
  { id: 'billing',      label: 'Billing',      href: '/settings/billing',      Icon: CreditCard },
  { id: 'preferences',  label: 'Preferences',  href: '/settings/preferences',  Icon: SlidersHorizontal },
  { id: 'team',         label: 'Team',         href: '/settings/team',         Icon: Users },
]

interface SettingsShellProps {
  user: AuthUser
  children: React.ReactNode
}

export function SettingsShell({ user, children }: SettingsShellProps) {
  const pathname = usePathname()
  const settingsDisplayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null

  const userInitials = settingsDisplayName
    ? settingsDisplayName.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : (user.email ? user.email.slice(0, 2).toUpperCase() : 'U')

  return (
    <div className="min-h-screen bg-archai-black text-white flex flex-col">
      {/* Top bar */}
      <header className="h-14 shrink-0 bg-archai-charcoal border-b border-archai-graphite flex items-center px-6 gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-sm bg-archai-orange flex items-center justify-center">
            <span className="text-white font-bold text-xs tracking-tight">A</span>
          </div>
          <span className="font-semibold text-white text-sm tracking-wide">ArchAI</span>
        </div>
        <div className="h-5 w-px bg-archai-graphite" />
        <span className="text-sm text-muted-foreground">Settings</span>
        <div className="flex-1" />
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Link>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 border-r border-archai-graphite bg-archai-charcoal/30 flex flex-col">
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            {NAV_ITEMS.map(({ id, label, href, Icon }) => {
              const isActive = pathname.startsWith(href)
              return (
                <Link
                  key={id}
                  href={href}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-archai-graphite text-white'
                      : 'text-muted-foreground hover:bg-archai-graphite/40 hover:text-white/90'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0 transition-colors',
                      isActive ? 'text-archai-orange' : 'text-muted-foreground'
                    )}
                  />
                  <span>{label}</span>
                </Link>
              )
            })}
          </nav>

          {/* User identity footer */}
          <div className="p-3 border-t border-archai-graphite">
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-md bg-archai-graphite/30">
              <div className="h-6 w-6 rounded-full bg-archai-orange/20 border border-archai-orange/30 flex items-center justify-center shrink-0">
                <span className="text-[9px] font-bold text-archai-orange">{userInitials}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-white truncate">{settingsDisplayName ?? user.email ?? 'User'}</p>
                {settingsDisplayName && (
                  <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                )}
                <p className="text-[10px] text-muted-foreground">Pro Plan</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
