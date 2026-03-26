'use client'

import { useState } from 'react'
import { Lock, Camera, Check, Loader2, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import type { AuthUser } from '@/types'

interface AccountSectionProps {
  user: AuthUser
}

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Sydney',
]

function ReadOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-archai-graphite/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/60">
      <Lock className="h-2.5 w-2.5" />
      Read only
    </span>
  )
}

function LockedField({ value, hint }: { value: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex h-9 cursor-not-allowed items-center justify-between rounded-md border border-archai-graphite/50 bg-archai-graphite/10 px-3">
        <span className="text-sm text-white/50">{value}</span>
        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
      </div>
      {hint && <p className="text-[11px] text-muted-foreground/60">{hint}</p>}
    </div>
  )
}

export function AccountSection({ user }: AccountSectionProps) {
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    'Not set'

  // Professional profile form state — seeded from signup metadata
  const [company, setCompany] = useState(
    (user.user_metadata?.company_or_studio as string | undefined) ?? ''
  )
  const [role, setRole] = useState(
    (user.user_metadata?.role as string | undefined) ?? ''
  )
  const [timezone, setTimezone] = useState(
    (user.user_metadata?.timezone as string | undefined) ?? 'UTC'
  )
  const [defaultUnits, setDefaultUnits] = useState<'metric' | 'imperial'>(
    ((user.user_metadata?.default_units as string | undefined) === 'imperial' ? 'imperial' : 'metric')
  )
  const [defaultRegion, setDefaultRegion] = useState('')

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Notification state
  const [emailCompletions, setEmailCompletions] = useState(true)
  const [emailDigest, setEmailDigest] = useState(false)
  const [inAppComments, setInAppComments] = useState(true)
  const [inAppViolations, setInAppViolations] = useState(true)

  const [deleteConfirm, setDeleteConfirm] = useState(false)

  // TODO: wire to Supabase user_metadata or a profiles table
  const handleSaveProfile = async () => {
    setSaving(true)
    await new Promise((r) => setTimeout(r, 900))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your personal information and preferences
        </p>
      </div>

      {/* Identity Card */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Identity</CardTitle>
          <CardDescription>Your core account identity is managed by Supabase Auth.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-archai-orange/20 border border-archai-orange/30 text-xl font-bold text-archai-orange">
                {displayName !== 'Not set' ? displayName.slice(0, 2).toUpperCase() : (user.email?.slice(0, 2).toUpperCase() ?? 'U')}
              </div>
              {/* TODO: implement avatar upload — wire to Supabase Storage */}
              <button
                type="button"
                aria-label="Upload avatar"
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-archai-graphite border border-archai-graphite/80 hover:bg-archai-smoke transition-colors"
              >
                <Camera className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
            <div>
              <p className="text-sm font-medium text-white">{displayName}</p>
              <p className="text-xs text-muted-foreground">{user.email ?? '—'}</p>
              <p className="mt-1 text-[10px] text-muted-foreground/50">
                Avatar upload — coming soon
              </p>
            </div>
          </div>

          <Separator className="bg-archai-graphite" />

          {/* Locked fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label>Full Name</Label>
                <ReadOnlyBadge />
              </div>
              <LockedField value={displayName} hint="Contact support to update your name." />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label>Email</Label>
                <ReadOnlyBadge />
              </div>
              <LockedField value={user.email ?? 'Not set'} hint="Email changes require support." />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Professional Profile Card */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Professional Profile</CardTitle>
          <CardDescription>Used across your workspace and reports.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="company">Company / Studio</Label>
              <Input
                id="company"
                placeholder="e.g. Studio Archetti"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">Role</Label>
              <Input
                id="role"
                placeholder="e.g. Principal Architect"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="timezone">Timezone</Label>
              <Select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="units">Default Units</Label>
              <Select
                id="units"
                value={defaultUnits}
                onChange={(e) => setDefaultUnits(e.target.value as 'metric' | 'imperial')}
              >
                <option value="metric">Metric (m, m², kgCO₂e)</option>
                <option value="imperial">Imperial (ft, ft², lbCO₂e)</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="region">Default Project Region</Label>
            <Input
              id="region"
              placeholder="e.g. New York, NY — used as default for code-check"
              value={defaultRegion}
              onChange={(e) => setDefaultRegion(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            {saved && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
            <Button
              variant="archai"
              size="sm"
              onClick={handleSaveProfile}
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Notification Preferences</CardTitle>
          <CardDescription>Control how and when ArchAI notifies you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(
            [
              { id: 'email-completions', label: 'Email: Tool completion summaries', desc: 'Get an email when a run finishes.', value: emailCompletions, setter: setEmailCompletions },
              { id: 'email-digest', label: 'Email: Weekly activity digest', desc: 'A weekly summary of project activity.', value: emailDigest, setter: setEmailDigest },
              { id: 'app-comments', label: 'In-app: New comments', desc: 'Notify when someone comments on a project.', value: inAppComments, setter: setInAppComments },
              { id: 'app-violations', label: 'In-app: Code violations detected', desc: 'Alert when a rule violation is flagged.', value: inAppViolations, setter: setInAppViolations },
            ] as const
          ).map(({ id, label, desc, value, setter }) => (
            <div key={id} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch
                id={id}
                checked={value}
                onCheckedChange={setter}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-900/40">
        <CardHeader className="pb-4">
          <CardTitle className="text-base text-red-400">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">Export account data</p>
              <p className="text-xs text-muted-foreground">Download a copy of all your projects and settings.</p>
            </div>
            <Button variant="outline" size="sm">Export data</Button>
          </div>
          <Separator className="bg-archai-graphite" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-red-400">Delete account</p>
              <p className="text-xs text-muted-foreground">
                Permanently remove your account and all data. This cannot be undone.
              </p>
            </div>
            {!deleteConfirm ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteConfirm(true)}
              >
                Delete account
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                <span className="text-xs text-red-400">Are you sure?</span>
                <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" disabled>
                  Confirm delete
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
