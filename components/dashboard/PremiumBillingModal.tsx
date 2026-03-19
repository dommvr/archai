'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Sparkles, Check, CreditCard, ArrowRight, X, Loader2, ShieldCheck,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { dismissBillingPrompt } from '@/lib/actions/billing'

interface PremiumBillingModalProps {
  open: boolean
  onClose: () => void
}

const PREMIUM_FEATURES = [
  'Unlimited AI tool runs per month',
  'Priority processing queue',
  'Full zoning code database access',
  'Advanced massing & test-fit generation',
  'Export to IFC / Revit / Rhino',
  'Team collaboration (coming soon)',
]

/**
 * PremiumBillingModal — shown once on first sign-in for premium-intent users.
 *
 * This is a polished demo / billing continuation screen. Real payment
 * collection is not implemented here — it routes to /settings/billing
 * or displays a seam ready for Stripe Checkout integration.
 *
 * TODO: When Stripe is integrated, replace the "Continue to billing" path
 *       with a Stripe Checkout session creation call (via dismissBillingPrompt
 *       + redirect to Stripe Checkout URL).
 */
export function PremiumBillingModal({ open, onClose }: PremiumBillingModalProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<'billing' | 'later' | null>(null)

  const dismiss = async (path: 'billing' | 'later') => {
    setLoading(path)
    await dismissBillingPrompt()
    setLoading(null)
    onClose()
    if (path === 'billing') {
      router.push('/settings/billing')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) dismiss('later') }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {/* Logo */}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-sm bg-archai-orange flex items-center justify-center">
              <span className="text-white font-bold text-xs">A</span>
            </div>
            <span className="font-semibold text-white text-sm">ArchAI</span>
          </div>

          {/* Heading */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <DialogTitle className="text-xl leading-snug">
                Complete your Premium setup
              </DialogTitle>
              <DialogDescription className="mt-1">
                You selected Premium during signup. Activate your plan to unlock the full toolset.
              </DialogDescription>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => dismiss('later')}
              className="mt-0.5 rounded-sm opacity-60 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-archai-orange/50 shrink-0"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </DialogHeader>

        {/* Plan summary */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-lg border border-archai-orange/30 bg-archai-orange/5 p-4 space-y-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-archai-orange" />
                <span className="font-semibold text-white">Premium Plan</span>
                <Badge variant="archai" className="py-0 text-[10px]">Selected</Badge>
              </div>
              <p className="text-2xl font-bold text-white mt-1">
                $49
                <span className="text-sm font-normal text-muted-foreground"> / month</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Billed monthly</p>
              <p className="text-xs text-muted-foreground mt-0.5">Cancel anytime</p>
            </div>
          </div>

          <Separator className="bg-archai-orange/20" />

          <ul className="space-y-1.5">
            {PREMIUM_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                <Check className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Trust note */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 text-archai-smoke shrink-0" />
          <span>
            Payment is handled securely. No card stored in ArchAI — managed via Stripe.
          </span>
        </div>

        {/* Demo notice */}
        <div className="rounded-md bg-amber-900/10 border border-amber-700/20 px-3 py-2">
          <p className="text-[11px] text-amber-500/80 leading-relaxed">
            <span className="font-medium text-amber-400">Demo mode:</span> Billing is not yet
            active. Clicking &ldquo;Continue to billing&rdquo; opens the billing settings page
            where payment will be configured in a future release.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-1">
          <Button
            variant="archai"
            className="w-full"
            onClick={() => dismiss('billing')}
            disabled={loading !== null}
          >
            {loading === 'billing' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <CreditCard className="h-4 w-4" />
                Continue to billing
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => dismiss('later')}
            disabled={loading !== null}
          >
            {loading === 'later' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Maybe later — go to dashboard'
            )}
          </Button>
        </div>

        <p className="text-center text-[11px] text-muted-foreground/60 -mt-1">
          You can complete billing setup at any time in{' '}
          <span className="text-muted-foreground">Settings → Billing</span>.
        </p>
      </DialogContent>
    </Dialog>
  )
}
