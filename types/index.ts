// ============================================================
// ArchAI — Shared TypeScript Types
// ============================================================

export type ToolId =
  | 'dashboard'
  | 'precheck'
  | 'massing-generator'
  | 'space-planner'
  | 'live-metrics'
  | 'option-comparison'
  | 'sustainability-copilot'
  | 'firm-knowledge'
  | 'brief-translator'
  | 'spec-writer'
  | 'export-sync'

export interface NavItem {
  id: ToolId
  label: string
  icon: string
  href: string
  badge?: string
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  userId: string
  speckleStreamId?: string
}

export type ProjectDeleteResult =
  | { success: true }
  | { success: false; error: string }

export interface Metrics {
  gfa: number       // Gross Floor Area in m²
  carbon: number    // Embodied carbon in kgCO₂e
  efficiency: number // Space efficiency 0–100%
  codeRisk: 'low' | 'medium' | 'high'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  toolId?: ToolId
}

export interface ToolResult<T = unknown> {
  toolId: ToolId
  status: 'ok' | 'error' | 'pending'
  data: T | null
  message?: string
  error?: string
}

// Supabase user type (minimal shape we use from auth.User)
export interface AuthUser {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
}

export interface PricingTier {
  id: 'freemium' | 'pro'
  name: string
  price: string
  period: string
  description: string
  features: string[]
  cta: string
  highlighted: boolean
}
