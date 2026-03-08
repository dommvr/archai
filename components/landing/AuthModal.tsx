'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Mail, Lock, Loader2, CheckCircle2, ArrowRight } from 'lucide-react'
import { sendMagicLink, signIn, signUp } from '@/lib/actions/auth'

type AuthMode = 'login' | 'signup' | 'magic'

interface AuthModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultMode?: AuthMode
}

export function AuthModal({ open, onOpenChange, defaultMode = 'login' }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(defaultMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      if (mode === 'magic') {
        const result = await sendMagicLink(email)
        if (result?.error) {
          setMessage({ type: 'error', text: result.error })
        } else {
          setMessage({ type: 'success', text: result?.success ?? 'Check your email.' })
        }
      } else if (mode === 'login') {
        const result = await signIn(email, password)
        if (result?.error) {
          setMessage({ type: 'error', text: result.error })
        }
        // On success, signIn redirects to /dashboard automatically
      } else {
        const result = await signUp(email, password)
        if (result?.error) {
          setMessage({ type: 'error', text: result.error })
        } else {
          setMessage({ type: 'success', text: result?.success ?? 'Check your email.' })
        }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-sm bg-archai-orange flex items-center justify-center">
              <span className="text-white font-bold text-xs">A</span>
            </div>
            <span className="font-semibold text-white text-sm">ArchAI</span>
          </div>
          <DialogTitle className="text-xl">
            {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Sign in with email'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'magic'
              ? "We'll send a magic link to your email. No password needed."
              : mode === 'login'
              ? 'Enter your credentials to access your workspace.'
              : 'Start building with AI-powered architectural tools.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email Field */}
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs text-muted-foreground uppercase tracking-wider">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="architect@firm.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9"
                required
                autoComplete="email"
              />
            </div>
          </div>

          {/* Password Field (not shown for magic link) */}
          <AnimatePresence>
            {mode !== 'magic' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-1.5"
              >
                <label htmlFor="password" className="text-xs text-muted-foreground uppercase tracking-wider">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9"
                    required
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Feedback Message */}
          {message && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-start gap-2 rounded-md p-3 text-sm ${
                message.type === 'error'
                  ? 'bg-red-900/20 border border-red-800/40 text-red-400'
                  : 'bg-emerald-900/20 border border-emerald-800/40 text-emerald-400'
              }`}
            >
              {message.type === 'success' && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
              {message.text}
            </motion.div>
          )}

          <Button type="submit" variant="archai" className="w-full" disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {mode === 'magic' ? 'Send Magic Link' : mode === 'login' ? 'Sign In' : 'Create Account'}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        {/* Mode Switchers */}
        <div className="space-y-2 pt-2 border-t border-archai-graphite">
          {mode !== 'magic' && (
            <button
              type="button"
              onClick={() => { setMode('magic'); setMessage(null) }}
              className="w-full text-xs text-muted-foreground hover:text-white transition-colors py-1"
            >
              Sign in with magic link instead →
            </button>
          )}
          {mode === 'login' && (
            <button
              type="button"
              onClick={() => { setMode('signup'); setMessage(null) }}
              className="w-full text-xs text-muted-foreground hover:text-white transition-colors py-1"
            >
              Don&apos;t have an account? Sign up
            </button>
          )}
          {(mode === 'signup' || mode === 'magic') && (
            <button
              type="button"
              onClick={() => { setMode('login'); setMessage(null) }}
              className="w-full text-xs text-muted-foreground hover:text-white transition-colors py-1"
            >
              Already have an account? Log in
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
