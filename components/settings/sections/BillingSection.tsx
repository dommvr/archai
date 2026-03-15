'use client'

import { CreditCard, Download, Zap, HardDrive, Upload, Bot, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'

function DemoBadge() {
  return (
    <Badge
      variant="outline"
      className="border-amber-500/30 py-0 text-[10px] text-amber-500/70"
    >
      Demo
    </Badge>
  )
}

// Demo usage data
const USAGE_ITEMS = [
  {
    id: 'runs',
    label: 'Tool Runs',
    icon: Zap,
    used: 47,
    limit: 100,
    unit: 'runs',
    color: '',
  },
  {
    id: 'uploads',
    label: 'Model Uploads',
    icon: Upload,
    used: 23,
    limit: 50,
    unit: 'uploads',
    color: '',
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: HardDrive,
    used: 2.3,
    limit: 5,
    unit: 'GB',
    color: '',
  },
  {
    id: 'ai',
    label: 'AI Token Usage',
    icon: Bot,
    used: 18200,
    limit: 50000,
    unit: 'tokens',
    color: '',
  },
]

// Demo invoices
const INVOICES = [
  { id: 'inv-003', date: 'Jan 1, 2026',  amount: '$49.00', status: 'Paid' },
  { id: 'inv-002', date: 'Dec 1, 2025',  amount: '$49.00', status: 'Paid' },
  { id: 'inv-001', date: 'Nov 1, 2025',  amount: '$49.00', status: 'Paid' },
]

function formatUsed(used: number, unit: string): string {
  if (unit === 'tokens') {
    return used >= 1000 ? `${(used / 1000).toFixed(1)}k` : String(used)
  }
  return String(used)
}
function formatLimit(limit: number, unit: string): string {
  if (unit === 'tokens') {
    return limit >= 1000 ? `${(limit / 1000).toFixed(0)}k` : String(limit)
  }
  return String(limit)
}

export function BillingSection() {
  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your plan, usage, payment details, and invoices
        </p>
      </div>

      {/* Current Plan */}
      <Card className="border-archai-orange/20">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Current Plan</CardTitle>
              <CardDescription className="mt-1">Your subscription renews automatically.</CardDescription>
            </div>
            <DemoBadge />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-white">Pro</span>
                <Badge variant="archai">Active</Badge>
              </div>
              <p className="text-2xl font-semibold text-white">
                $49
                <span className="text-sm font-normal text-muted-foreground"> / month</span>
              </p>
              <p className="text-xs text-muted-foreground">Next billing date: Feb 1, 2026</p>
            </div>
            <div className="space-y-1.5 text-right">
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                {[
                  '100 tool runs / month',
                  '50 GB model storage',
                  'AI copilot access',
                  'Speckle integration',
                ].map((feat) => (
                  <span key={feat} className="flex items-center justify-end gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    {feat}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <Separator className="bg-archai-graphite my-4" />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled>
              Manage plan
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground" disabled>
              Cancel subscription
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Usage */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Usage This Month</CardTitle>
              <CardDescription className="mt-1">Resets on Feb 1, 2026.</CardDescription>
            </div>
            <DemoBadge />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {USAGE_ITEMS.map(({ id, label, icon: Icon, used, limit, unit }) => {
            const pct = Math.round((used / limit) * 100)
            const isHigh = pct >= 80
            const isMed = pct >= 50 && !isHigh
            return (
              <div key={id} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-white">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {label}
                  </span>
                  <span className={isHigh ? 'text-red-400' : isMed ? 'text-amber-400' : 'text-muted-foreground'}>
                    {formatUsed(used, unit)} / {formatLimit(limit, unit)} {unit}
                  </span>
                </div>
                <Progress
                  value={used}
                  max={limit}
                  indicatorClassName={
                    isHigh ? 'bg-red-500' : isMed ? 'bg-amber-500' : 'bg-archai-orange'
                  }
                />
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Payment Method */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Payment Method</CardTitle>
            </div>
            <DemoBadge />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-md border border-archai-graphite bg-archai-graphite/20 px-4 py-3">
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-white">Visa ending in 4242</p>
                <p className="text-xs text-muted-foreground">Expires 12 / 2027</p>
              </div>
            </div>
            <Button variant="outline" size="sm" disabled>
              Update
            </Button>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground/60">
            Payment management will be handled via Stripe in a future release.
          </p>
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Invoices</CardTitle>
              <CardDescription className="mt-1">Your recent billing history.</CardDescription>
            </div>
            <DemoBadge />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border border-archai-graphite">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-archai-graphite bg-archai-graphite/20">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Invoice</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Date</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Amount</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">PDF</th>
                </tr>
              </thead>
              <tbody>
                {INVOICES.map((inv, i) => (
                  <tr
                    key={inv.id}
                    className={i < INVOICES.length - 1 ? 'border-b border-archai-graphite' : ''}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inv.id}</td>
                    <td className="px-4 py-3 text-white">{inv.date}</td>
                    <td className="px-4 py-3 text-white">{inv.amount}</td>
                    <td className="px-4 py-3">
                      <Badge variant="risk_low" className="py-0 text-[10px]">{inv.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        aria-label={`Download ${inv.id}`}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-white transition-colors"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
