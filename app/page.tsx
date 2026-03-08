'use client'

import { useState } from 'react'
import { Navbar } from '@/components/landing/Navbar'
import { Hero } from '@/components/landing/Hero'
import { FeaturesGrid } from '@/components/landing/FeaturesGrid'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { Benefits } from '@/components/landing/Benefits'
import { Testimonials } from '@/components/landing/Testimonials'
import { PricingTeaser } from '@/components/landing/PricingTeaser'
import { FooterCTA } from '@/components/landing/FooterCTA'
import { AuthModal } from '@/components/landing/AuthModal'

/**
 * Landing page for unauthenticated users.
 *
 * Auth redirect behavior:
 * - Handled by middleware.ts — authenticated users are redirected to /dashboard
 *   before this page renders.
 *
 * This is a Client Component because it manages the AuthModal open state.
 * The auth modal uses Server Actions internally (sendMagicLink, signIn, signUp).
 */
export default function LandingPage() {
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup'>('signup')

  const openLogin = () => {
    setAuthModalMode('login')
    setAuthModalOpen(true)
  }

  const openSignup = () => {
    setAuthModalMode('signup')
    setAuthModalOpen(true)
  }

  return (
    <main className="min-h-screen bg-archai-black">
      <Navbar onLoginClick={openLogin} onSignupClick={openSignup} />

      <Hero onGetStarted={openSignup} />

      <FeaturesGrid />

      <HowItWorks />

      <Benefits />

      <Testimonials />

      <PricingTeaser onGetStarted={openSignup} />

      <FooterCTA onGetStarted={openSignup} />

      {/* Auth Modal — shared across all CTA triggers */}
      <AuthModal
        open={authModalOpen}
        onOpenChange={setAuthModalOpen}
        defaultMode={authModalMode}
      />
    </main>
  )
}
