'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Mail, Lock, Building2, Globe, Ruler,
  Loader2, CheckCircle2, ArrowRight, ArrowLeft,
  MailOpen, RefreshCw, Sparkles, Check, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Progress } from '@/components/ui/progress'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  PASSWORD_RULES,
  getPasswordStrength,
  isPasswordStrong,
  getPasswordError,
  type PasswordStrength,
} from '@/lib/utils/password'
import { signUpWithProfile, resendVerificationEmail } from '@/lib/actions/auth'
import type { SignupFormData, DefaultUnits, UserRole, PlanIntent } from '@/types'

interface SignupFlowProps {
  onSwitchToLogin: () => void
}

// ── Constants ─────────────────────────────────────────────

const TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Central Europe (CET)' },
  { value: 'Europe/Helsinki', label: 'Eastern Europe (EET)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Seoul', label: 'Seoul (KST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEDT)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST)' },
]

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'architect', label: 'Architect' },
  { value: 'interior_designer', label: 'Interior Designer' },
  { value: 'structural_engineer', label: 'Structural Engineer' },
  { value: 'mep_engineer', label: 'MEP Engineer' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'developer', label: 'Developer / Client' },
  { value: 'student', label: 'Student' },
  { value: 'other', label: 'Other' },
]

const PREMIUM_FEATURES = [
  'Unlimited AI tool runs',
  'Priority processing queue',
  'Full zoning code database access',
  'Advanced massing & test-fit generation',
  'Export to IFC / Revit / Rhino',
  'Team collaboration (coming soon)',
]

const FREE_FEATURES = [
  '5 AI tool runs per month',
  'Public zoning code access',
  'Basic site analysis',
  'Standard export formats',
]

const TOTAL_STEPS = 4

// ── Strength bar colours ───────────────────────────────────

const STRENGTH_CONFIG: Record<
  PasswordStrength,
  { label: string; barClass: string; labelClass: string; bars: number }
> = {
  empty:  { label: '',       barClass: '',                  labelClass: '',                  bars: 0 },
  weak:   { label: 'Weak',   barClass: 'bg-red-500',        labelClass: 'text-red-400',       bars: 1 },
  medium: { label: 'Medium', barClass: 'bg-amber-500',      labelClass: 'text-amber-400',     bars: 3 },
  strong: { label: 'Strong', barClass: 'bg-emerald-500',    labelClass: 'text-emerald-400',   bars: 5 },
}

// ── Step indicator ─────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const steps = ['Account', 'Workspace', 'Plan', 'Verify']
  return (
    <div className="flex items-center gap-0 w-full mb-6">
      {steps.map((label, i) => {
        const stepNum = i + 1
        const done = stepNum < current
        const active = stepNum === current
        return (
          <div key={label} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center shrink-0">
              <div
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300',
                  done
                    ? 'bg-archai-orange text-white'
                    : active
                    ? 'bg-archai-orange/20 border border-archai-orange text-archai-orange'
                    : 'bg-archai-graphite text-muted-foreground'
                )}
              >
                {done ? <Check className="w-3 h-3" /> : stepNum}
              </div>
              <span
                className={cn(
                  'text-[10px] mt-1 transition-colors',
                  active ? 'text-white' : done ? 'text-archai-orange' : 'text-muted-foreground'
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  'h-px flex-1 mx-1 transition-colors duration-300',
                  done ? 'bg-archai-orange' : 'bg-archai-graphite'
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Field wrapper ──────────────────────────────────────────

function Field({
  label,
  htmlFor,
  optional,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  optional?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider"
      >
        {label}
        {optional && (
          <span className="normal-case text-[10px] text-muted-foreground/60 font-normal tracking-normal">
            (optional)
          </span>
        )}
      </label>
      {children}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

// ── Password strength meter ────────────────────────────────

function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null
  const strength = getPasswordStrength(password)
  const cfg = STRENGTH_CONFIG[strength]

  return (
    <div className="space-y-2 mt-1">
      {/* 5-segment bar */}
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-all duration-300',
              i < cfg.bars ? cfg.barClass : 'bg-archai-graphite'
            )}
          />
        ))}
        {strength !== 'empty' && (
          <span className={cn('text-[10px] ml-1 font-medium shrink-0', cfg.labelClass)}>
            {cfg.label}
          </span>
        )}
      </div>

      {/* Checklist */}
      <ul className="grid grid-cols-1 gap-0.5">
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(password)
          return (
            <li key={rule.id} className="flex items-center gap-1.5 text-[11px]">
              {ok ? (
                <Check className="w-3 h-3 text-emerald-400 shrink-0" />
              ) : (
                <X className="w-3 h-3 text-archai-smoke shrink-0" />
              )}
              <span className={ok ? 'text-emerald-400' : 'text-muted-foreground'}>
                {rule.label}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Plan card ──────────────────────────────────────────────

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: 'free' | 'premium'
  selected: boolean
  onSelect: () => void
}) {
  const isPremium = plan === 'premium'
  const features = isPremium ? PREMIUM_FEATURES : FREE_FEATURES

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left rounded-lg border p-4 transition-all duration-200',
        selected
          ? isPremium
            ? 'border-archai-orange bg-archai-orange/5'
            : 'border-archai-graphite bg-archai-graphite/30'
          : 'border-archai-graphite bg-transparent hover:border-archai-smoke hover:bg-archai-graphite/20'
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-white">
              {isPremium ? 'Premium' : 'Free'}
            </span>
            {isPremium && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-archai-orange/15 border border-archai-orange/30 text-archai-orange">
                <Sparkles className="w-2.5 h-2.5" />
                Recommended
              </span>
            )}
          </div>
          <div className="mt-0.5">
            {isPremium ? (
              <span className="text-xl font-bold text-white">
                $49<span className="text-xs font-normal text-muted-foreground"> / month</span>
              </span>
            ) : (
              <span className="text-xl font-bold text-white">
                Free<span className="text-xs font-normal text-muted-foreground"> forever</span>
              </span>
            )}
          </div>
        </div>
        <div
          className={cn(
            'mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all',
            selected
              ? isPremium
                ? 'border-archai-orange bg-archai-orange'
                : 'border-archai-smoke bg-archai-smoke'
              : 'border-archai-graphite bg-transparent'
          )}
        >
          {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>
      </div>

      <ul className="space-y-1.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
            <Check className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      {isPremium && selected && (
        <div className="mt-3 rounded-md bg-archai-orange/10 border border-archai-orange/20 px-3 py-2">
          <p className="text-xs text-archai-amber leading-relaxed">
            Billing will be completed after you verify your email. No payment required now.
          </p>
        </div>
      )}
    </button>
  )
}

// ── Inline error banner ────────────────────────────────────

function ErrorBanner({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-2 rounded-md bg-red-900/20 border border-red-800/40 text-red-400 p-3 text-sm"
    >
      {text}
    </motion.div>
  )
}

// ── Step 1 — Account ───────────────────────────────────────

function StepAccount({
  data,
  onChange,
  onNext,
}: {
  data: Pick<SignupFormData, 'fullName' | 'email' | 'password'>
  onChange: <K extends keyof SignupFormData>(key: K, value: SignupFormData[K]) => void
  onNext: () => void
}) {
  const [confirmPassword, setConfirmPassword] = useState('')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState('')

  const passwordMismatch = confirmPassword.length > 0 && data.password !== confirmPassword
  const passwordOk = isPasswordStrong(data.password)

  const handleNext = () => {
    setTouched(true)
    if (!data.fullName.trim()) { setError('Full name is required.'); return }
    if (!data.email.trim()) { setError('Email is required.'); return }
    const pwError = getPasswordError(data.password)
    if (pwError) { setError(pwError); return }
    if (data.password !== confirmPassword) { setError('Passwords do not match.'); return }
    setError('')
    onNext()
  }

  return (
    <div className="space-y-4">
      <Field label="Full Name" htmlFor="full-name">
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="full-name"
            type="text"
            placeholder="Jane Architects"
            value={data.fullName}
            onChange={(e) => onChange('fullName', e.target.value)}
            className="pl-9"
            autoComplete="name"
          />
        </div>
      </Field>

      <Field label="Email" htmlFor="signup-email">
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="signup-email"
            type="email"
            placeholder="architect@firm.com"
            value={data.email}
            onChange={(e) => onChange('email', e.target.value)}
            className="pl-9"
            autoComplete="email"
          />
        </div>
      </Field>

      <Field label="Password" htmlFor="signup-password">
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <PasswordInput
            id="signup-password"
            placeholder="Min. 12 characters"
            value={data.password}
            onChange={(e) => { onChange('password', e.target.value); setTouched(true) }}
            className="pl-9"
            autoComplete="new-password"
            aria-invalid={touched && !passwordOk}
          />
        </div>
        {/* Strength meter — shows as soon as user starts typing */}
        {data.password && <PasswordStrengthMeter password={data.password} />}
      </Field>

      <Field
        label="Confirm Password"
        htmlFor="confirm-password"
        error={passwordMismatch ? 'Passwords do not match.' : undefined}
      >
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <PasswordInput
            id="confirm-password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="pl-9"
            autoComplete="new-password"
            aria-invalid={passwordMismatch}
          />
        </div>
      </Field>

      {error && <ErrorBanner text={error} />}

      <Button
        type="button"
        variant="archai"
        className="w-full"
        onClick={handleNext}
        disabled={passwordMismatch}
      >
        Continue <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

// ── Step 2 — Workspace ─────────────────────────────────────

function StepWorkspace({
  data,
  onChange,
  onNext,
  onBack,
}: {
  data: Pick<SignupFormData, 'companyOrStudio' | 'role' | 'timezone' | 'defaultUnits'>
  onChange: <K extends keyof SignupFormData>(key: K, value: SignupFormData[K]) => void
  onNext: () => void
  onBack: () => void
}) {
  const [error, setError] = useState('')

  const handleNext = () => {
    if (!data.timezone) { setError('Please select a timezone.'); return }
    setError('')
    onNext()
  }

  return (
    <div className="space-y-4">
      <Field label="Company / Studio" htmlFor="company" optional>
        <div className="relative">
          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="company"
            type="text"
            placeholder="Firm name or studio"
            value={data.companyOrStudio}
            onChange={(e) => onChange('companyOrStudio', e.target.value)}
            className="pl-9"
            autoComplete="organization"
          />
        </div>
      </Field>

      <Field label="Role" htmlFor="role" optional>
        <Select
          id="role"
          value={data.role}
          onChange={(e) => onChange('role', e.target.value as UserRole | '')}
        >
          <option value="">Select your role</option>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </Select>
      </Field>

      <Field label="Timezone" htmlFor="timezone">
        <div className="relative">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
          <Select
            id="timezone"
            value={data.timezone}
            onChange={(e) => onChange('timezone', e.target.value)}
            className="pl-9"
          >
            <option value="">Select timezone</option>
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </Select>
        </div>
      </Field>

      <Field label="Default Units" htmlFor="units">
        <div className="relative">
          <Ruler className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
          <Select
            id="units"
            value={data.defaultUnits}
            onChange={(e) => onChange('defaultUnits', e.target.value as DefaultUnits)}
            className="pl-9"
          >
            <option value="metric">Metric (m, m², kgCO₂e)</option>
            <option value="imperial">Imperial (ft, ft², lbs)</option>
          </Select>
        </div>
      </Field>

      {error && <ErrorBanner text={error} />}

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button type="button" variant="archai" className="flex-1" onClick={handleNext}>
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ── Step 3 — Plan ──────────────────────────────────────────

function StepPlan({
  planIntent,
  onChange,
  onNext,
  onBack,
}: {
  planIntent: PlanIntent
  onChange: (plan: PlanIntent) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Choose the plan that fits your workflow. You can upgrade at any time.
      </p>

      <div className="space-y-3">
        <PlanCard plan="premium" selected={planIntent === 'premium'} onSelect={() => onChange('premium')} />
        <PlanCard plan="free" selected={planIntent === 'free'} onSelect={() => onChange('free')} />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button type="button" variant="archai" className="flex-1" onClick={onNext}>
          {planIntent === 'premium' ? 'Continue to Verify' : 'Create Free Account'}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ── Step 4 — Verify ────────────────────────────────────────

function StepVerify({
  email,
  planIntent,
  onSwitchToLogin,
}: {
  email: string
  planIntent: PlanIntent
  onSwitchToLogin: () => void
}) {
  const [resendLoading, setResendLoading] = useState(false)
  const [resendMessage, setResendMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleResend = async () => {
    setResendLoading(true)
    setResendMessage(null)
    const result = await resendVerificationEmail(email)
    setResendMessage(result.error
      ? { type: 'error', text: result.error }
      : { type: 'success', text: result.success ?? 'Email sent.' }
    )
    setResendLoading(false)
  }

  return (
    <div className="space-y-5">
      {/* Verification status card */}
      <div className="rounded-lg border border-archai-graphite bg-archai-graphite/20 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-archai-orange/10 border border-archai-orange/30 flex items-center justify-center shrink-0 mt-0.5">
            <MailOpen className="w-4 h-4 text-archai-orange" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Check your inbox</p>
            <p className="text-xs text-muted-foreground mt-0.5 break-all">{email}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          We sent a verification link to the address above. Click the link to activate your account
          before signing in.
        </p>
      </div>

      {/* Premium billing note */}
      {planIntent === 'premium' && (
        <div className="rounded-md bg-archai-orange/8 border border-archai-orange/20 px-3 py-2.5 flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-archai-orange mt-0.5 shrink-0" />
          <p className="text-xs text-archai-amber leading-relaxed">
            You selected Premium. Billing setup will be available after you verify your email and
            sign in for the first time.
          </p>
        </div>
      )}

      {/* Integrations note */}
      <div className="rounded-md bg-archai-charcoal border border-archai-graphite px-3 py-2.5 space-y-1.5">
        <p className="text-xs font-medium text-white">Configure integrations later in Settings</p>
        <ul className="space-y-1">
          {[
            'Speckle personal access token (for private models)',
            'Custom Speckle server URL (enterprise)',
            'Future API provider keys',
          ].map((item) => (
            <li key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-1 h-1 rounded-full bg-archai-graphite shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Resend feedback */}
      {resendMessage && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'flex items-start gap-2 rounded-md p-2.5 text-xs',
            resendMessage.type === 'error'
              ? 'bg-red-900/20 border border-red-800/40 text-red-400'
              : 'bg-emerald-900/20 border border-emerald-800/40 text-emerald-400'
          )}
        >
          {resendMessage.type === 'success' && <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
          {resendMessage.text}
        </motion.div>
      )}

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleResend}
          disabled={resendLoading}
        >
          {resendLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              Resend verification email
            </>
          )}
        </Button>

        <button
          type="button"
          onClick={onSwitchToLogin}
          className="w-full text-xs text-muted-foreground hover:text-white transition-colors py-1"
        >
          Already verified? Sign in →
        </button>
      </div>
    </div>
  )
}

// ── Main SignupFlow ─────────────────────────────────────────

const DEFAULT_DATA: SignupFormData = {
  fullName: '',
  email: '',
  password: '',
  companyOrStudio: '',
  role: '',
  timezone: Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
  defaultUnits: 'metric',
  planIntent: 'free',
}

const STEP_TITLES: Record<number, { title: string; description: string }> = {
  1: { title: 'Create your account', description: 'Start building with AI-powered architectural tools.' },
  2: { title: 'Workspace defaults', description: 'Set up your studio context and display preferences.' },
  3: { title: 'Choose your plan', description: 'Select what works for you — you can change this later.' },
  4: { title: 'Verify your email', description: 'One last step before your account is fully activated.' },
}

export function SignupFlow({ onSwitchToLogin }: SignupFlowProps) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<SignupFormData>(DEFAULT_DATA)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const set = <K extends keyof SignupFormData>(key: K, value: SignupFormData[K]) => {
    setData((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmitAccount = async () => {
    setSubmitLoading(true)
    setSubmitError('')
    const result = await signUpWithProfile(data)
    setSubmitLoading(false)
    if (result.error) {
      setSubmitError(result.error)
      return
    }
    setSubmitted(true)
    setStep(4)
  }

  const progress = Math.round((step / TOTAL_STEPS) * 100)
  const { title, description } = STEP_TITLES[step]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <StepIndicator current={step} />
        <Progress value={progress} className="h-0.5 mb-4" />
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
          Step {step} of {TOTAL_STEPS}
        </p>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>

      {/* Step body */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.18 }}
        >
          {step === 1 && (
            <StepAccount data={data} onChange={set} onNext={() => setStep(2)} />
          )}

          {step === 2 && (
            <StepWorkspace
              data={data}
              onChange={set}
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}

          {step === 3 && (
            <>
              <StepPlan
                planIntent={data.planIntent}
                onChange={(plan) => set('planIntent', plan)}
                onNext={handleSubmitAccount}
                onBack={() => setStep(2)}
              />
              {submitLoading && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground pt-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating your account…
                </div>
              )}
              {submitError && !submitLoading && (
                <div className="pt-2">
                  <ErrorBanner text={submitError} />
                </div>
              )}
            </>
          )}

          {step === 4 && submitted && (
            <StepVerify
              email={data.email}
              planIntent={data.planIntent}
              onSwitchToLogin={onSwitchToLogin}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Footer — not shown on verify step */}
      {step !== 4 && (
        <div className="pt-2 border-t border-archai-graphite">
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="w-full text-xs text-muted-foreground hover:text-white transition-colors py-1"
          >
            Already have an account? Sign in
          </button>
        </div>
      )}
    </div>
  )
}
