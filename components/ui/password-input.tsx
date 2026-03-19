'use client'

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * PasswordInput — Input with an accessible show/hide toggle.
 *
 * Accepts all standard <input> props (same as Input).
 * The left-icon padding class (pl-9) must be passed in via className
 * when a leading icon is present, just like the plain Input.
 * Right padding (pr-9) is always applied internally to leave room for the toggle.
 */
export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false)

    return (
      <div className="relative">
        <Input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-9', className)}
        />
        <button
          type="button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((v) => !v)}
          // Sits inside the input's right gutter; does not submit the form
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-archai-orange/50 rounded-sm"
          tabIndex={0}
        >
          {visible
            ? <EyeOff className="h-4 w-4" aria-hidden="true" />
            : <Eye    className="h-4 w-4" aria-hidden="true" />
          }
        </button>
      </div>
    )
  }
)
PasswordInput.displayName = 'PasswordInput'
