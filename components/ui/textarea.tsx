import * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[80px] w-full rounded-md border border-archai-graphite bg-archai-charcoal px-3 py-2 text-sm text-white placeholder:text-muted-foreground shadow-sm resize-none',
      'focus:outline-none focus:ring-1 focus:ring-archai-orange/50 focus:border-archai-orange/50',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Textarea }
