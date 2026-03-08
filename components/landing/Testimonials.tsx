'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Quote } from 'lucide-react'

const TESTIMONIALS = [
  {
    quote:
      'ArchAI cut our feasibility study time from three days to four hours. The zoning checker alone saved us from a costly mistake on our last mixed-use project.',
    name: 'Elena Voss',
    title: 'Principal Architect',
    firm: 'Voss & Hartmann Architekten',
    initials: 'EV',
  },
  {
    quote:
      'The Sustainability Copilot has completely changed how we present embodied carbon to clients. We can now run live what-if scenarios during the design review meeting itself.',
    name: 'Marcus Chen',
    title: 'Design Director',
    firm: 'Meridian Studio',
    initials: 'MC',
  },
  {
    quote:
      'The Firm Knowledge Assistant is extraordinary. We uploaded ten years of project documentation and now our junior architects can query institutional knowledge that used to live only in senior heads.',
    name: 'Saoirse Murphy',
    title: 'Associate Director',
    firm: 'Murphy Dolan Architects',
    initials: 'SM',
  },
  {
    quote:
      'Massing generation used to be the most time-consuming part of early feasibility. ArchAI generates compliant options in under a minute. We\'re iterating 5× faster at scheme design stage.',
    name: 'James Okonkwo',
    title: 'Senior Architect',
    firm: 'Lagos Urban Practice',
    initials: 'JO',
  },
  {
    quote:
      'We integrated ArchAI into our Speckle workflow and the live metrics panel is now on our wall-mounted display during every design meeting. The team makes better decisions faster.',
    name: 'Ingrid Halvorsen',
    title: 'Partner',
    firm: 'Halvorsen + Skogsberg',
    initials: 'IH',
  },
]

export function Testimonials() {
  const [current, setCurrent] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setCurrent((c) => (c + 1) % TESTIMONIALS.length)
    }, 6000)
  }

  useEffect(() => {
    startTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const navigate = (dir: 1 | -1) => {
    if (timerRef.current) clearInterval(timerRef.current)
    setCurrent((c) => (c + dir + TESTIMONIALS.length) % TESTIMONIALS.length)
    startTimer()
  }

  const t = TESTIMONIALS[current]

  return (
    <section className="relative py-24 px-6 bg-archai-charcoal border-y border-archai-graphite overflow-hidden">
      <div className="absolute inset-0 bg-blueprint-grid opacity-30 pointer-events-none" />

      <div className="relative z-10 max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-medium tracking-widest uppercase text-archai-orange mb-4">
            From the Field
          </p>
          <h2 className="font-serif text-4xl md:text-5xl font-light text-white">
            Trusted by architects
          </h2>
        </div>

        <div className="relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={current}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="rounded-lg border border-archai-graphite bg-archai-black/50 p-10 text-center"
              onMouseEnter={() => { if (timerRef.current) clearInterval(timerRef.current) }}
              onMouseLeave={startTimer}
            >
              <Quote className="h-8 w-8 text-archai-orange/40 mx-auto mb-6" />

              <blockquote className="font-serif text-xl md:text-2xl font-light text-white leading-relaxed mb-8 italic">
                &ldquo;{t.quote}&rdquo;
              </blockquote>

              <div className="flex items-center justify-center gap-4">
                <div className="w-10 h-10 rounded-full bg-archai-graphite flex items-center justify-center text-sm font-semibold text-white">
                  {t.initials}
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-white">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.title} · {t.firm}
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex items-center justify-center gap-6 mt-8">
            <button
              onClick={() => navigate(-1)}
              className="w-8 h-8 rounded-full border border-archai-graphite flex items-center justify-center text-muted-foreground hover:border-archai-orange/40 hover:text-white transition-colors"
              aria-label="Previous testimonial"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            {/* Dots */}
            <div className="flex gap-1.5">
              {TESTIMONIALS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (timerRef.current) clearInterval(timerRef.current)
                    setCurrent(i)
                    startTimer()
                  }}
                  className={`rounded-full transition-all duration-300 ${
                    i === current
                      ? 'w-6 h-1.5 bg-archai-orange'
                      : 'w-1.5 h-1.5 bg-archai-graphite hover:bg-archai-smoke'
                  }`}
                  aria-label={`Go to testimonial ${i + 1}`}
                />
              ))}
            </div>

            <button
              onClick={() => navigate(1)}
              className="w-8 h-8 rounded-full border border-archai-graphite flex items-center justify-center text-muted-foreground hover:border-archai-orange/40 hover:text-white transition-colors"
              aria-label="Next testimonial"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
