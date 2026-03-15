'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'

const KEYBOARD_SHORTCUTS = [
  { keys: ['Ctrl', 'K'],  action: 'Open command palette' },
  { keys: ['Ctrl', '/'],  action: 'Focus AI chat' },
  { keys: ['Ctrl', 'B'],  action: 'Toggle sidebar' },
  { keys: ['Ctrl', 'P'],  action: 'Switch project' },
  { keys: ['Esc'],         action: 'Close dialog / deselect' },
  { keys: ['G', 'D'],      action: 'Go to dashboard' },
  { keys: ['G', 'P'],      action: 'Go to precheck' },
]

export function PreferencesSection() {
  // Dashboard & Navigation
  const [defaultLanding, setDefaultLanding] = useState('overview')
  const [defaultTool, setDefaultTool] = useState('dashboard')
  const [showShortcutHints, setShowShortcutHints] = useState(true)

  // Display & Formatting
  const [dateFormat, setDateFormat] = useState('DD MMM YYYY')
  const [numberFormat, setNumberFormat] = useState('1,234.5')
  const [compactNumbers, setCompactNumbers] = useState(false)

  // Autosave & Sync
  const [autosaveInterval, setAutosaveInterval] = useState('30s')
  const [autoRefreshMetrics, setAutoRefreshMetrics] = useState(true)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // TODO: wire to Supabase user_metadata or a preferences table
  const handleSave = async () => {
    setSaving(true)
    await new Promise((r) => setTimeout(r, 800))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customize your dashboard behavior, display settings, and shortcuts
        </p>
      </div>

      {/* Dashboard & Navigation */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Dashboard &amp; Navigation</CardTitle>
          <CardDescription>What you see when you open a project.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="default-landing">Default landing page</Label>
              <Select
                id="default-landing"
                value={defaultLanding}
                onChange={(e) => setDefaultLanding(e.target.value)}
              >
                <option value="overview">Project Overview</option>
                <option value="viewer">3D Viewer</option>
                <option value="metrics">Live Metrics</option>
                <option value="precheck">Zoning Checker</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="default-tool">Default tool on project open</Label>
              <Select
                id="default-tool"
                value={defaultTool}
                onChange={(e) => setDefaultTool(e.target.value)}
              >
                <option value="dashboard">None (overview)</option>
                <option value="precheck">Zoning &amp; Code Checker</option>
                <option value="live-metrics">Live Metrics</option>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-sm font-medium text-white">Show keyboard shortcut hints</p>
              <p className="text-xs text-muted-foreground">Tooltips on buttons showing their keyboard shortcut.</p>
            </div>
            <Switch
              checked={showShortcutHints}
              onCheckedChange={setShowShortcutHints}
            />
          </div>
        </CardContent>
      </Card>

      {/* Display & Formatting */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Display &amp; Formatting</CardTitle>
          <CardDescription>How dates and numbers are displayed across the app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="date-format">Date format</Label>
              <Select
                id="date-format"
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
              >
                <option value="DD MMM YYYY">14 Mar 2026</option>
                <option value="MM/DD/YYYY">03/14/2026</option>
                <option value="YYYY-MM-DD">2026-03-14</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="number-format">Number format</Label>
              <Select
                id="number-format"
                value={numberFormat}
                onChange={(e) => setNumberFormat(e.target.value)}
              >
                <option value="1,234.5">1,234.5 (comma thousands)</option>
                <option value="1.234,5">1.234,5 (dot thousands)</option>
                <option value="1234.5">1234.5 (no separator)</option>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-sm font-medium text-white">Compact number display</p>
              <p className="text-xs text-muted-foreground">Show 12.4k instead of 12,400 in metric cards.</p>
            </div>
            <Switch
              checked={compactNumbers}
              onCheckedChange={setCompactNumbers}
            />
          </div>
        </CardContent>
      </Card>

      {/* Autosave & Sync */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Autosave &amp; Sync</CardTitle>
          <CardDescription>Control how the app saves and refreshes data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5 max-w-xs">
            <Label htmlFor="autosave-interval">Autosave interval</Label>
            <Select
              id="autosave-interval"
              value={autosaveInterval}
              onChange={(e) => setAutosaveInterval(e.target.value)}
            >
              <option value="10s">Every 10 seconds</option>
              <option value="30s">Every 30 seconds</option>
              <option value="60s">Every minute</option>
              <option value="off">Off</option>
            </Select>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-sm font-medium text-white">Auto-refresh metrics</p>
              <p className="text-xs text-muted-foreground">Automatically poll for updated GFA and carbon figures.</p>
            </div>
            <Switch
              checked={autoRefreshMetrics}
              onCheckedChange={setAutoRefreshMetrics}
            />
          </div>
        </CardContent>
      </Card>

      {/* Save bar */}
      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            Preferences saved
          </span>
        )}
        <Button variant="archai" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            'Save preferences'
          )}
        </Button>
      </div>

      {/* Keyboard Shortcuts Reference */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Keyboard Shortcuts</CardTitle>
          <CardDescription>Reference for all global keyboard shortcuts.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-0.5">
            {KEYBOARD_SHORTCUTS.map(({ keys, action }) => (
              <div
                key={action}
                className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-archai-graphite/20 transition-colors"
              >
                <span className="text-sm text-white">{action}</span>
                <div className="flex items-center gap-1">
                  {keys.map((key, i) => (
                    <span key={i} className="inline-flex items-center">
                      {i > 0 && <span className="mx-1 text-muted-foreground/40 text-xs">+</span>}
                      <kbd className="inline-flex h-6 min-w-[24px] items-center justify-center rounded border border-archai-graphite bg-archai-graphite/40 px-1.5 font-mono text-[11px] text-white/80">
                        {key}
                      </kbd>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Separator className="bg-archai-graphite mt-3 mb-2" />
          <p className="text-[11px] text-muted-foreground/60">
            Custom keybinding support is planned for a future release.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
