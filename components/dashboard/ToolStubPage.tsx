'use client'

import { Construction } from 'lucide-react'

interface ToolStubPageProps {
  toolName: string
  description: string
}

/**
 * Placeholder UI rendered for AI tools that are not yet implemented.
 * Replaces Next.js 404 errors with a clean, consistent stub page.
 * Remove this component and replace with the real tool once implemented.
 */
export function ToolStubPage({ toolName, description }: ToolStubPageProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-archai-graphite border border-archai-smoke flex items-center justify-center">
        <Construction className="h-6 w-6 text-muted-foreground/60" />
      </div>
      <div className="space-y-1 max-w-sm">
        <p className="text-sm font-semibold text-white">{toolName}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <p className="text-[10px] text-muted-foreground/40 border border-archai-graphite rounded px-2 py-1">
        Coming soon — integration pending
      </p>
    </div>
  )
}
