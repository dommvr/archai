'use client'

import { useEffect, useState } from 'react'
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
import { PasswordInput } from '@/components/ui/password-input'
import { Mail, Lock, Loader2, CheckCircle2, ArrowRight } from 'lucide-react'
import { sendMagicLink, signIn } from '@/lib/actions/auth'
import { SignupFlow } from '@/components/landing/SignupFlow'

// AuthMode only covers the two non-signup modes here.
// Signup is handled entirely by SignupFlow.
type AuthMode = 'login' | 'magic'

interface AuthModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultMode?: 'login' | 'signup'
}

export function AuthModal({ open, onOpenChange, defaultMode = 'login' }: AuthModalProps) {
  // 'signup' routes to SignupFlow; 'login' and 'magic' use the inline form
  const [view, setView] = useState<'login' | 'magic' | 'signup'>(defaultMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Sync view when the modal is opened with a new defaultMode
  useEffect(() => {
    if (open) {
      setView(defaultMode)
      setMessage(null)
    }
  }, [defaultMode, open])

  const handleLoginOrMagic = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      if (view === 'magic') {
        const result = await sendMagicLink(email)
        setMessage(result?.error
          ? { type: 'error', text: result.error }
          : { type: 'success', text: result?.success ?? 'Check your email.' }
        )
      } else {
        // view === 'login'
        const result = await signIn(email, password)
        if (result?.error) {
          setMessage({ type: 'error', text: result.error })
        }
        // On success, signIn redirects to /dashboard automatically
      }
    } finally {
      setLoading(false)
    }
  }

  const switchTo = (next: 'login' | 'magic' | 'signup') => {
    setMessage(null)
    setView(next)
  }

  const isSignup = view === 'signup'
  const authMode = view as AuthMode  // safe — only used when !isSignup

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Widen for signup steps which have more content */}
      <DialogContent className={isSignup ? 'sm:max-w-lg' : 'sm:max-w-md'}>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-sm bg-archai-orange flex items-center justify-center">
              <span className="text-white font-bold text-xs">A</span>
            </div>
            <span className="font-semibold text-white text-sm">ArchAI</span>
          </div>

          {/* Only show the static header for login/magic — SignupFlow has its own */}
          {!isSignup && (
            <>
              <DialogTitle className="text-xl">
                {authMode === 'login' ? 'Welcome back' : 'Sign in with email'}
              </DialogTitle>
              <DialogDescription>
                {authMode === 'magic'
                  ? "We'll send a magic link to your email. No password needed."
                  : 'Enter your credentials to access your workspace.'}
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        <AnimatePresence mode="wait" initial={false}>
          {isSignup ? (
            <motion.div
              key="signup"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <SignupFlow onSwitchToLogin={() => switchTo('login')} />
            </motion.div>
          ) : (
            <motion.div
              key="login-magic"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <form onSubmit={handleLoginOrMagic} className="space-y-4">
                {/* Email */}
                <div className="space-y-1.5">
                  <label htmlFor="auth-email" className="text-xs text-muted-foreground uppercase tracking-wider">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="auth-email"
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

                {/* Password — login only */}
                <AnimatePresence>
                  {authMode === 'login' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-1.5"
                    >
                      <label htmlFor="auth-password" className="text-xs text-muted-foreground uppercase tracking-wider">
                        Password
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <PasswordInput
                          id="auth-password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-9"
                          required
                          autoComplete="current-password"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Feedback */}
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
                      {authMode === 'magic' ? 'Send Magic Link' : 'Sign In'}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>

              {/* Mode switchers */}
              <div className="space-y-2 pt-3 border-t border-archai-graphite mt-4">
                <button
                  type="button"
                  onClick={() => switchTo(authMode === 'magic' ? 'login' : 'magic')}
                  className="w-full text-xs text-muted-foreground hover:text-white transition-colors py-1"
                >
                  {authMode === 'magic'
                    ? 'Sign in with password instead →'
                    : 'Sign in with magic link instead →'}
                </button>
                <button
                  type="button"
                  onClick={() => switchTo('signup')}
                  className="w-full text-xs text-muted-foreground hover:text-white transition-colors py-1"
                >
                  Don&apos;t have an account? Sign up
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
