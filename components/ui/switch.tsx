'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface SwitchProps {
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  onCheckedChange?: (checked: boolean) => void
  className?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, defaultChecked, disabled, onCheckedChange, className, id, ...rest }, ref) => {
    const [internalChecked, setInternalChecked] = React.useState(defaultChecked ?? false)
    const isControlled = checked !== undefined
    const isChecked = isControlled ? checked : internalChecked

    const handleClick = () => {
      if (disabled) return
      const next = !isChecked
      if (!isControlled) setInternalChecked(next)
      onCheckedChange?.(next)
    }

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        id={id}
        aria-checked={isChecked}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-archai-orange focus-visible:ring-offset-2 focus-visible:ring-offset-archai-black',
          'disabled:cursor-not-allowed disabled:opacity-50',
          isChecked ? 'bg-archai-orange' : 'bg-archai-graphite',
          className
        )}
        {...rest}
      >
        <span
          className={cn(
            'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform',
            isChecked ? 'translate-x-4' : 'translate-x-0'
          )}
        />
      </button>
    )
  }
)
Switch.displayName = 'Switch'

export { Switch }
