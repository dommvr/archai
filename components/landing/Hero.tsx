'use client'

import dynamic from 'next/dynamic'
import { motion, type Variants } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { ArrowRight, Play } from 'lucide-react'

// ssr:false is MANDATORY — R3F uses window/WebGL at import time
const HeroCanvas = dynamic(() => import('./HeroCanvas'), { ssr: false })

interface HeroProps {
  onGetStarted: () => void
}

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15, delayChildren: 0.2 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' } },
}

export function Hero({ onGetStarted }: HeroProps) {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-archai-black bg-blueprint-grid">
      {/* 3D Background Canvas */}
      <HeroCanvas />

      {/* Radial gradient overlay — fades the grid at center for text readability */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(10,10,10,0.6) 0%, rgba(10,10,10,0.1) 100%)',
        }}
      />

      {/* Bottom fade to next section */}
      <div className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, transparent, #0A0A0A)' }} />

      {/* Hero Content */}
      <motion.div
        className="relative z-10 max-w-5xl mx-auto px-6 pt-24 pb-16 text-center"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Eyebrow label */}
        <motion.div variants={itemVariants} className="flex justify-center mb-8">
          <span className="inline-flex items-center gap-2 text-xs font-medium tracking-widest uppercase text-archai-orange border border-archai-orange/30 bg-archai-orange/5 rounded-full px-4 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-archai-orange animate-pulse-slow" />
            AI-Native Architecture Platform
          </span>
        </motion.div>

        {/* Headline — Cormorant Garamond serif */}
        <motion.h1
          variants={itemVariants}
          className="font-serif text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-light leading-[0.95] tracking-tight mb-6"
        >
          <span className="text-white block">Design faster.</span>
          <span className="text-white block">Build smarter.</span>
          <span className="text-gradient-hero block italic">Think deeper.</span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          variants={itemVariants}
          className="text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto leading-relaxed mb-10"
        >
          ArchAI gives architects AI-powered tools for zoning analysis, massing generation,
          sustainability copiloting, and BIM-aware design — all in one precise workspace.
          Accelerate your workflow by 5–10×.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div variants={itemVariants} className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button
            variant="archai"
            size="xl"
            onClick={onGetStarted}
            className="w-full sm:w-auto"
          >
            Get Started Free
            <ArrowRight className="h-5 w-5" />
          </Button>
          <Button
            variant="outline"
            size="xl"
            className="w-full sm:w-auto group"
            onClick={() => {
              // TODO: open demo video modal
              console.log('Watch Demo clicked')
            }}
          >
            <Play className="h-4 w-4 text-archai-orange group-hover:text-archai-orange" />
            Watch Demo
          </Button>
        </motion.div>

        {/* Social proof micro-text */}
        <motion.p variants={itemVariants} className="mt-8 text-xs text-muted-foreground/60">
          Trusted by architects at leading firms · No credit card required
        </motion.p>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-10 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.5 }}
      >
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs text-muted-foreground/50 tracking-widest uppercase">Scroll</span>
          <motion.div
            className="w-px h-8 bg-gradient-to-b from-archai-graphite to-transparent"
            animate={{ scaleY: [1, 0.5, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
      </motion.div>
    </section>
  )
}
