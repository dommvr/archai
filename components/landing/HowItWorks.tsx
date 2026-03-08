const STEPS = [
  {
    number: '01',
    title: 'Connect your model',
    description:
      'Link your Speckle stream, upload an IFC file, or start from a brief. ArchAI syncs with your existing BIM workflow — no rework required.',
  },
  {
    number: '02',
    title: 'Run AI analysis',
    description:
      'Select any tool from the sidebar. Zoning checks, massing generation, space planning, and carbon analysis run in seconds against your live model data.',
  },
  {
    number: '03',
    title: 'Iterate in the viewer',
    description:
      'Metrics and AI suggestions update in real-time as you design. Compare options side-by-side. Ask the AI Copilot questions about your model at any point.',
  },
  {
    number: '04',
    title: 'Export and deliver',
    description:
      'Push results back to Revit or Rhino via Speckle. Export permit-ready reports, spec documents, and carbon summaries — all formatted and client-ready.',
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 px-6 bg-archai-charcoal border-y border-archai-graphite">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-xs font-medium tracking-widest uppercase text-archai-orange mb-4">
            Workflow
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-light text-white mb-4">
            How ArchAI works
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            From brief to permit-ready in hours, not weeks.
          </p>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical connector line */}
          <div className="absolute left-[19px] top-8 bottom-8 w-px bg-gradient-to-b from-archai-orange/60 via-archai-graphite to-archai-graphite hidden md:block" />

          <div className="space-y-10">
            {STEPS.map((step, index) => (
              <div key={step.number} className="flex gap-8 md:gap-12">
                {/* Step indicator */}
                <div className="flex-shrink-0 flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold z-10 border ${
                      index === 0
                        ? 'bg-archai-orange border-archai-orange text-white'
                        : 'bg-archai-charcoal border-archai-graphite text-muted-foreground'
                    }`}
                  >
                    {step.number}
                  </div>
                </div>

                {/* Step content */}
                <div className="pb-4">
                  <h3 className="font-semibold text-white text-base mb-2">{step.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed max-w-lg">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
