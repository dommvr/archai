/**
 * Password strength utilities for the signup flow.
 *
 * Rules applied during signup (Step 1):
 *   - Minimum 12 characters
 *   - At least 1 uppercase letter (A–Z)
 *   - At least 1 lowercase letter (a–z)
 *   - At least 1 digit (0–9)
 *   - At least 1 special character (!@#$%^&* etc.)
 *
 * These rules are enforced client-side before account creation.
 * They are intentionally NOT enforced on the sign-in path.
 */

export interface PasswordRule {
  id: string
  label: string
  test: (pw: string) => boolean
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: 'At least 12 characters',
    test: (pw) => pw.length >= 12,
  },
  {
    id: 'uppercase',
    label: 'One uppercase letter (A–Z)',
    test: (pw) => /[A-Z]/.test(pw),
  },
  {
    id: 'lowercase',
    label: 'One lowercase letter (a–z)',
    test: (pw) => /[a-z]/.test(pw),
  },
  {
    id: 'number',
    label: 'One number (0–9)',
    test: (pw) => /[0-9]/.test(pw),
  },
  {
    id: 'special',
    label: 'One special character (!@#$%…)',
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
  },
]

export type PasswordStrength = 'empty' | 'weak' | 'medium' | 'strong'

/**
 * Returns the number of rules currently satisfied.
 */
export function countSatisfied(password: string): number {
  return PASSWORD_RULES.filter((r) => r.test(password)).length
}

/**
 * Returns a strength label based on how many rules pass.
 *
 *   0     → empty
 *   1–2   → weak
 *   3–4   → medium
 *   5     → strong  (all rules satisfied)
 */
export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return 'empty'
  const satisfied = countSatisfied(password)
  if (satisfied <= 2) return 'weak'
  if (satisfied <= 4) return 'medium'
  return 'strong'
}

/**
 * Returns true only when every rule passes — used to gate the Next button.
 */
export function isPasswordStrong(password: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(password))
}

/**
 * Human-readable validation error for use in error banners.
 * Returns the first failing rule's label, or null if all pass.
 */
export function getPasswordError(password: string): string | null {
  const failing = PASSWORD_RULES.find((r) => !r.test(password))
  return failing ? `Password must include: ${failing.label.toLowerCase()}.` : null
}
