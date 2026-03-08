import { CheckCircle2 } from 'lucide-react'

const STATS = [
  { value: '10×', label: 'faster feasibility studies' },
  { value: '80%', label: 'reduction in zoning research time' },
  { value: '3hrs', label: 'saved per permit pre-check' },
  { value: '40%', label: 'less time on early-stage BIM setup' },
]

const BENEFITS = [
  'Zoning codes parsed and cross-referenced automatically',
  'Massing options generated from brief in under 60 seconds',
  'Embodied carbon tracked live — no spreadsheets',
  'Firm knowledge searchable across all past projects',
  'Client briefs translated to structured program in minutes',
  'Spec writing automated from model data',
  'Space layout alternatives generated, not just evaluated',
  'Export-ready for Revit, Rhino, and IFC at any stage',
]

export function Benefits() {
  return (
    <section className="py-24 px-6 bg-archai-black">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left: Stats */}
          <div>
            <p className="text-xs font-medium tracking-widest uppercase text-archai-orange mb-6">
              The Impact
            </p>
            <h2 className="font-serif text-4xl md:text-5xl font-light text-white mb-8 leading-tight">
              Work at the speed<br />of your ideas.
            </h2>
            <p className="text-muted-foreground text-base leading-relaxed mb-12">
              ArchAI doesn&apos;t replace your expertise — it removes the bottlenecks.
              Research, calculation, and documentation tasks that used to take hours now
              take minutes, leaving you more time for the work that matters.
            </p>

            <div className="grid grid-cols-2 gap-6">
              {STATS.map((stat) => (
                <div key={stat.value} className="border-l-2 border-archai-orange/40 pl-4">
                  <div className="font-serif text-4xl font-light text-archai-orange mb-1">
                    {stat.value}
                  </div>
                  <div className="text-xs text-muted-foreground leading-tight">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Benefit list */}
          <div className="rounded-lg border border-archai-graphite bg-archai-charcoal p-8">
            <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-6">
              What you get
            </p>
            <ul className="space-y-3">
              {BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start gap-3">
                  <CheckCircle2 className="h-4 w-4 text-archai-orange shrink-0 mt-0.5" />
                  <span className="text-sm text-muted-foreground leading-relaxed">{benefit}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
