import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind CSS classes safely, resolving conflicts.
 * Used by all shadcn/ui components and custom components.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a number with compact notation (e.g. 12400 → "12.4k")
 */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/**
 * Format a carbon value in kgCO₂e with appropriate units
 */
export function formatCarbon(kgCO2e: number): string {
  if (kgCO2e >= 1000) {
    return `${(kgCO2e / 1000).toFixed(1)} tCO₂e`
  }
  return `${kgCO2e.toFixed(0)} kgCO₂e`
}
