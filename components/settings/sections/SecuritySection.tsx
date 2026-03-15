'use client'

import { useState } from 'react'
import {
  Shield,
  ShieldCheck,
  Monitor,
  Smartphone,
  Globe,
  Loader2,
  LogOut,
  Lock,
  Eye,
  EyeOff,
  Check,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import type { AuthUser } from '@/types'

interface SecuritySectionProps {
  user: AuthUser
}

// Demo session data
const DEMO_SESSIONS = [
  {
    id: 'current',
    device: 'Chrome on Windows',
    icon: Monitor,
    location: 'New York, US',
    lastActive: 'Active now',
    isCurrent: true,
  },
  {
    id: 'mobile',
    device: 'Safari on iPhone',
    icon: Smartphone,
    location: 'New York, US',
    lastActive: '2 days ago',
    isCurrent: false,
  },
  {
    id: 'browser-2',
    device: 'Firefox on macOS',
    icon: Globe,
    location: 'Brooklyn, US',
    lastActive: '5 days ago',
    isCurrent: false,
  },
]

// Demo security activity
const DEMO_ACTIVITY = [
  { id: 1, event: 'Signed in', detail: 'Chrome on Windows', time: 'Today, 9:14 AM' },
  { id: 2, event: 'Password changed', detail: 'Via account settings', time: '12 Jan 2026' },
  { id: 3, event: 'Magic link used', detail: 'Safari on iPhone', time: '8 Jan 2026' },
  { id: 4, event: 'Signed in', detail: 'Firefox on macOS', time: '3 Jan 2026' },
]

function ComingSoonBadge() {
  return (
    <Badge variant="outline" className="border-archai-graphite/60 py-0 text-[10px] text-muted-foreground/70">
      Coming soon
    </Badge>
  )
}

function DemoBadge() {
  return (
    <Badge variant="outline" className="border-amber-500/30 py-0 text-[10px] text-amber-500/70">
      Demo
    </Badge>
  )
}

export function SecuritySection({ user: _user }: SecuritySectionProps) {
  // Password change dialog
  const [pwDialogOpen, setPwDialogOpen] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwSaved, setPwSaved] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  // Sign out all — demo state
  const [signOutAllLoading, setSignOutAllLoading] = useState(false)
  const [signOutAllDone, setSignOutAllDone] = useState(false)

  // TODO: wire to supabase.auth.updateUser({ password: newPw }) after verifying currentPw
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError(null)
    if (newPw.length < 8) {
      setPwError('Password must be at least 8 characters.')
      return
    }
    if (newPw !== confirmPw) {
      setPwError('Passwords do not match.')
      return
    }
    setPwSaving(true)
    await new Promise((r) => setTimeout(r, 1000))
    setPwSaving(false)
    setPwSaved(true)
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
    setTimeout(() => {
      setPwSaved(false)
      setPwDialogOpen(false)
    }, 1500)
  }

  // TODO: wire to supabase.auth.admin.signOut for all sessions, or a custom endpoint
  const handleSignOutAll = async () => {
    setSignOutAllLoading(true)
    await new Promise((r) => setTimeout(r, 1200))
    setSignOutAllLoading(false)
    setSignOutAllDone(true)
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your password, login methods, sessions, and security activity
        </p>
      </div>

      {/* Password */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Password</CardTitle>
          <CardDescription>Keep your account secure with a strong password.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-white">Password set</span>
              <span className="text-xs text-muted-foreground">— last changed 12 Jan 2026</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPwDialogOpen(true)}>
              Change password
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Login Methods */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Login Methods</CardTitle>
          <CardDescription>Ways you can sign in to ArchAI.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: 'Email + Password', status: 'Active', active: true },
            { label: 'Magic Link', status: 'Active', active: true },
            { label: 'Google OAuth', status: 'Not connected', active: false },
          ].map(({ label, status, active }) => (
            <div key={label} className="flex items-center justify-between py-1">
              <span className="text-sm text-white">{label}</span>
              <div className="flex items-center gap-2">
                <Badge variant={active ? 'risk_low' : 'outline'} className={active ? '' : 'text-muted-foreground/60 border-archai-graphite/50'}>
                  {status}
                </Badge>
                {!active && <ComingSoonBadge />}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 2FA */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Two-Factor Authentication</CardTitle>
              <CardDescription className="mt-1">Add an extra layer of security to your account.</CardDescription>
            </div>
            <ComingSoonBadge />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-md border border-archai-graphite/50 bg-archai-graphite/10 px-4 py-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-sm">2FA is not enabled</span>
            </div>
            <Button variant="outline" size="sm" disabled>
              Enable 2FA
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Active Sessions */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Active Sessions</CardTitle>
              <CardDescription className="mt-1">Devices currently signed in to your account.</CardDescription>
            </div>
            <DemoBadge />
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {DEMO_SESSIONS.map((session) => {
            const Icon = session.icon
            return (
              <div
                key={session.id}
                className="flex items-center justify-between rounded-md px-3 py-2.5 hover:bg-archai-graphite/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-white flex items-center gap-2">
                      {session.device}
                      {session.isCurrent && (
                        <Badge variant="risk_low" className="py-0 text-[10px]">This device</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {session.location} · {session.lastActive}
                    </p>
                  </div>
                </div>
                {!session.isCurrent && (
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-red-400">
                    Revoke
                  </Button>
                )}
              </div>
            )
          })}
          <Separator className="bg-archai-graphite my-2" />
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-xs text-muted-foreground">Sign out all other devices</p>
            {signOutAllDone ? (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                Done
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSignOutAll}
                disabled={signOutAllLoading}
              >
                {signOutAllLoading ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Signing out…</>
                ) : (
                  <><LogOut className="h-3.5 w-3.5" />Sign out all</>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Security Activity */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent Security Activity</CardTitle>
              <CardDescription className="mt-1">A log of recent security-relevant events.</CardDescription>
            </div>
            <DemoBadge />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-0.5">
            {DEMO_ACTIVITY.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-archai-graphite/20 transition-colors"
              >
                <Shield className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">{entry.event}</p>
                  <p className="text-xs text-muted-foreground truncate">{entry.detail}</p>
                </div>
                <span className="text-[11px] text-muted-foreground/60 shrink-0">{entry.time}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Change Password Dialog */}
      <Dialog open={pwDialogOpen} onOpenChange={setPwDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Enter your current password, then choose a new one.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePasswordChange} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="current-pw">Current password</Label>
              <div className="relative">
                <Input
                  id="current-pw"
                  type={showPw ? 'text' : 'password'}
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="pr-9"
                  disabled={pwSaving || pwSaved}
                />
                <button
                  type="button"
                  aria-label="Toggle password visibility"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
                >
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">New password</Label>
              <Input
                id="new-pw"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="At least 8 characters"
                disabled={pwSaving || pwSaved}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw">Confirm new password</Label>
              <Input
                id="confirm-pw"
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                disabled={pwSaving || pwSaved}
              />
            </div>
            {pwError && <p className="text-xs text-red-400">{pwError}</p>}
            {pwSaved && (
              <p className="flex items-center gap-1 text-xs text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                Password updated successfully
              </p>
            )}
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPwDialogOpen(false)}
                disabled={pwSaving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="archai"
                size="sm"
                disabled={!currentPw || !newPw || !confirmPw || pwSaving || pwSaved}
              >
                {pwSaving ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Updating…</>
                ) : (
                  'Update password'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
