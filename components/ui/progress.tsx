import * as React from 'react'
import { cn } from '@/lib/utils'

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
  max?: number
  /** Optional color override — defaults to archai-orange */
  indicatorClassName?: string
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, indicatorClassName, ...props }, ref) => {
    const pct = Math.min(100, Math.max(0, (value / max) * 100))
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-archai-graphite', className)}
        {...props}
      >
        <div
          className={cn('h-full rounded-full bg-archai-orange transition-all duration-500', indicatorClassName)}
          style={{ width: `${pct}%` }}
        />
      </div>
    )
  }
)
Progress.displayName = 'Progress'

export { Progress }
