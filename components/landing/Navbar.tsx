'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Menu, X } from 'lucide-react'

interface NavbarProps {
  onLoginClick: () => void
  onSignupClick: () => void
}

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Blog', href: '#blog' },
]

export function Navbar({ onLoginClick, onSignupClick }: NavbarProps) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-archai-charcoal/95 backdrop-blur-md border-b border-archai-graphite/60 shadow-lg'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-sm bg-archai-orange flex items-center justify-center">
            <span className="text-white font-bold text-xs tracking-tight">A</span>
          </div>
          <span className="font-semibold text-white text-base tracking-wide">ArchAI</span>
        </a>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm text-muted-foreground hover:text-white transition-colors duration-200"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop Auth Buttons */}
        <div className="hidden md:flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onLoginClick} className="text-muted-foreground hover:text-white">
            Sign in
          </Button>
          <Button variant="archai" size="sm" onClick={onSignupClick}>
            Get Started
          </Button>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="md:hidden text-muted-foreground hover:text-white p-2"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {menuOpen && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="md:hidden bg-archai-charcoal border-t border-archai-graphite px-6 py-4 flex flex-col gap-4"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm text-muted-foreground hover:text-white transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <div className="flex gap-3 pt-2 border-t border-archai-graphite">
            <Button variant="ghost" size="sm" onClick={() => { onLoginClick(); setMenuOpen(false) }}>
              Sign in
            </Button>
            <Button variant="archai" size="sm" onClick={() => { onSignupClick(); setMenuOpen(false) }}>
              Get Started
            </Button>
          </div>
        </motion.div>
      )}
    </motion.header>
  )
}
