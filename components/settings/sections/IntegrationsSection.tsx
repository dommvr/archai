'use client'

import { useState } from 'react'
import {
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  Plug,
  ExternalLink,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error'

function ComingSoonBadge() {
  return (
    <Badge variant="outline" className="border-archai-graphite/60 py-0 text-[10px] text-muted-foreground/70">
      Coming soon
    </Badge>
  )
}

function MaskedInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  disabled?: boolean
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="pr-9 font-mono text-xs"
      />
      <button
        type="button"
        aria-label={visible ? 'Hide token' : 'Show token'}
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors disabled:opacity-40"
      >
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

export function IntegrationsSection() {
  // Speckle config
  const [speckleServer, setSpeckleServer] = useState('https://speckle.xyz')
  const [speckleToken, setSpeckleToken] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')

  // TODO: wire to Supabase — persist Speckle token securely (encrypted or via server-side vault)
  const handleTestConnection = async () => {
    if (!speckleToken.trim() || !speckleServer.trim()) {
      setConnectionStatus('error')
      return
    }
    setConnectionStatus('testing')
    // TODO: actual call → GET {speckleServer}/api/others/user?token={speckleToken}
    await new Promise((r) => setTimeout(r, 1400))
    // Demo: simulate success when both fields filled
    setConnectionStatus('success')
  }

  const handleRevoke = () => {
    setSpeckleToken('')
    setConnectionStatus('idle')
  }

  // Default behaviors
  const [defaultImportUnits, setDefaultImportUnits] = useState('metric')
  const [defaultJurisdiction, setDefaultJurisdiction] = useState('')

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Integrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect services, configure API providers, and set default behaviors
        </p>
      </div>

      {/* Speckle — primary integration */}
      <Card className="border-archai-orange/20">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-archai-orange/10 border border-archai-orange/20">
                <Plug className="h-3.5 w-3.5 text-archai-orange" />
              </div>
              <div>
                <CardTitle className="text-base">Speckle</CardTitle>
              </div>
            </div>
            {connectionStatus === 'success' && (
              <Badge variant="risk_low" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Connected
              </Badge>
            )}
            {connectionStatus === 'error' && (
              <Badge variant="risk_high" className="gap-1">
                <XCircle className="h-3 w-3" />
                Failed
              </Badge>
            )}
          </div>
          <CardDescription>
            Your personal access token for private streams and server access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="speckle-server">Server URL</Label>
            <Input
              id="speckle-server"
              value={speckleServer}
              onChange={(e) => setSpeckleServer(e.target.value)}
              placeholder="https://speckle.xyz"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="speckle-token">Personal Access Token</Label>
              <a
                href="https://speckle.xyz/profile"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-archai-orange hover:underline"
              >
                Get token
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <MaskedInput
              id="speckle-token"
              value={speckleToken}
              onChange={setSpeckleToken}
              placeholder="Paste your Speckle personal access token"
            />
          </div>

          {connectionStatus === 'success' && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-800/40 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Connection verified — server is reachable and token is valid.
            </div>
          )}
          {connectionStatus === 'error' && (
            <div className="flex items-center gap-2 rounded-md border border-red-800/40 bg-red-900/20 px-3 py-2 text-xs text-red-400">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              {!speckleToken.trim() ? 'Enter a token before testing.' : 'Could not reach server or token rejected.'}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="archai"
              size="sm"
              onClick={handleTestConnection}
              disabled={connectionStatus === 'testing'}
            >
              {connectionStatus === 'testing' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Testing…
                </>
              ) : (
                'Test connection'
              )}
            </Button>
            <Button variant="outline" size="sm" disabled={!speckleToken}>
              Save token
            </Button>
            {speckleToken && (
              <button
                type="button"
                onClick={handleRevoke}
                className="ml-auto text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Revoke token
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* AI Providers */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">AI Providers</CardTitle>
            <ComingSoonBadge />
          </div>
          <CardDescription>
            BYO API keys — bring your own OpenAI or Anthropic credentials.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="openai-key">OpenAI API Key</Label>
            <MaskedInput
              id="openai-key"
              value=""
              onChange={() => {}}
              placeholder="sk-… (coming soon)"
              disabled
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="anthropic-key">Anthropic API Key</Label>
            <MaskedInput
              id="anthropic-key"
              value=""
              onChange={() => {}}
              placeholder="sk-ant-… (coming soon)"
              disabled
            />
          </div>
          <p className="text-[11px] text-muted-foreground/60">
            BYO key support is planned for a future release. ArchAI will use your key for all AI tool calls.
          </p>
        </CardContent>
      </Card>

      {/* Data Providers */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Data Providers</CardTitle>
            <ComingSoonBadge />
          </div>
          <CardDescription>
            Zoning data, parcel APIs, and image generation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { id: 'regrid', label: 'Regrid / Zoning API Key', placeholder: 'Regrid token (coming soon)' },
            { id: 'replicate', label: 'Replicate API Key', placeholder: 'r8_… (coming soon)' },
          ].map(({ id, label, placeholder }) => (
            <div key={id} className="space-y-1.5">
              <Label htmlFor={id}>{label}</Label>
              <MaskedInput id={id} value="" onChange={() => {}} placeholder={placeholder} disabled />
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground/60">
            Replicate powers AI render previews. Regrid provides parcel and zoning data for Site Analysis.
          </p>
        </CardContent>
      </Card>

      {/* Default Behaviors */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Default Behaviors</CardTitle>
          <CardDescription>Applied when creating new runs or importing models.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="import-units">Default import units</Label>
              <Select
                id="import-units"
                value={defaultImportUnits}
                onChange={(e) => setDefaultImportUnits(e.target.value)}
              >
                <option value="metric">Metric</option>
                <option value="imperial">Imperial</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jurisdiction">Default code-check jurisdiction</Label>
              <Input
                id="jurisdiction"
                placeholder="e.g. New York City, NY"
                value={defaultJurisdiction}
                onChange={(e) => setDefaultJurisdiction(e.target.value)}
              />
            </div>
          </div>
          <Separator className="bg-archai-graphite" />
          <div className="flex justify-end">
            <Button variant="archai" size="sm">Save defaults</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
