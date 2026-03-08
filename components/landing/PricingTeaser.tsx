import { CheckCircle2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PricingTier } from '@/types'

const TIERS: PricingTier[] = [
  {
    id: 'freemium',
    name: 'Freemium',
    price: 'Free',
    period: 'forever',
    description: 'Get started with core AI tools. No credit card required.',
    features: [
      '3 active projects',
      'Zoning checker (10 checks/month)',
      'Basic massing generator',
      'Live metrics dashboard',
      'Speckle viewer integration',
      'Community support',
    ],
    cta: 'Start Free',
    highlighted: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$149',
    period: '/month per seat',
    description: 'Full AI suite for active practices and growing firms.',
    features: [
      'Unlimited projects',
      'All 9 AI tools, unlimited usage',
      'Sustainability Copilot with Ladybug',
      'Firm Knowledge Assistant (RAG)',
      'Spec Writer + Sketch-to-BIM',
      'Priority support & onboarding',
      'Revit / Rhino sync via Speckle',
      'Export: IFC, PDF reports, CSV',
    ],
    cta: 'Start Pro Trial',
    highlighted: true,
  },
]

interface PricingTeaserProps {
  onGetStarted: () => void
}

export function PricingTeaser({ onGetStarted }: PricingTeaserProps) {
  return (
    <section id="pricing" className="py-24 px-6 bg-archai-black">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-medium tracking-widest uppercase text-archai-orange mb-4">
            Pricing
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-light text-white mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-muted-foreground text-base max-w-xl mx-auto">
            Start free. Scale when your practice does. No per-tool fees.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`rounded-lg p-8 flex flex-col ${
                tier.highlighted
                  ? 'border border-archai-orange/40 bg-archai-charcoal border-glow-orange relative'
                  : 'border border-archai-graphite bg-archai-charcoal'
              }`}
            >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 bg-archai-orange text-white text-xs font-semibold tracking-wider uppercase rounded-full px-3 py-1">
                    <Zap className="h-3 w-3" />
                    Most Popular
                  </span>
                </div>
              )}

              <div className="mb-6">
                <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-2">
                  {tier.name}
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="font-serif text-4xl font-light text-white">{tier.price}</span>
                  <span className="text-sm text-muted-foreground">{tier.period}</span>
                </div>
                <p className="text-sm text-muted-foreground">{tier.description}</p>
              </div>

              <ul className="space-y-2.5 mb-8 flex-1">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <CheckCircle2
                      className={`h-4 w-4 shrink-0 mt-0.5 ${
                        tier.highlighted ? 'text-archai-orange' : 'text-muted-foreground'
                      }`}
                    />
                    <span className="text-sm text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                variant={tier.highlighted ? 'archai' : 'outline'}
                className="w-full"
                onClick={onGetStarted}
              >
                {tier.cta}
              </Button>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground/60 mt-8">
          Enterprise plans with custom models, on-premises deployment, and volume licensing available.{' '}
          <a href="mailto:enterprise@archai.io" className="text-archai-orange/70 hover:text-archai-orange transition-colors">
            Contact us →
          </a>
        </p>
      </div>
    </section>
  )
}
