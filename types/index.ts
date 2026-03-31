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

/** Sections in the project-centric left navigation rail. */
export type ProjectSectionId =
  | 'overview'
  | 'viewer'
  | 'models'
  | 'documents'
  | 'runs'
  | 'tools'
  | 'settings'

export interface NavItem {
  id: ToolId | ProjectSectionId
  label: string
  icon: string
  href: string
  badge?: string
  /** When set, this item is rendered inside the Tools collapsible group. */
  isTool?: boolean
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  userId: string
  speckleStreamId?: string
  /** ISO timestamp of the last time the user navigated to this project. Client-persisted via localStorage. */
  lastOpenedAt?: string
  /** Whether the user has pinned this project to the top of the switcher. Client-persisted via localStorage. */
  pinned?: boolean
  /** ISO timestamp when the project was pinned. Used to order pinned projects. Client-persisted via localStorage. */
  pinnedAt?: string
  /** The Speckle model ref ID currently marked as the project's active model. */
  activeModelRefId?: string | null
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

// ── Signup & user profile types ─────────────────────────────

export type DefaultUnits = 'metric' | 'imperial'
export type UserRole =
  | 'architect'
  | 'interior_designer'
  | 'structural_engineer'
  | 'mep_engineer'
  | 'project_manager'
  | 'developer'
  | 'student'
  | 'other'

export type PlanIntent = 'free' | 'premium'

/**
 * Fields collected during the multi-step signup wizard.
 * Stored in public.user_profiles after account creation.
 */
export interface SignupFormData {
  // Step 1 — Account
  fullName: string
  email: string
  password: string
  // Step 2 — Workspace defaults
  companyOrStudio: string   // optional — empty string if skipped
  role: UserRole | ''       // optional — empty string if skipped
  timezone: string
  defaultUnits: DefaultUnits
  // Step 3 — Plan
  planIntent: PlanIntent
}

/**
 * Data extracted from a Speckle TreeNode on ObjectClicked.
 * raw mirrors NodeData.raw (typed { [prop: string]: any } in @speckle/viewer) but
 * cast to Record<string, unknown> to keep strict mode clean.
 */
export interface ViewerSelectedObject {
  /** Speckle object ID — the string passed to highlightObjects() etc. */
  id: string
  /** Raw Speckle object properties from node.model.raw. */
  raw: Record<string, unknown>
}

// ── Copilot types ────────────────────────────────────────────

export type CopilotMessageRole = 'user' | 'assistant' | 'tool' | 'system'
export type CopilotAttachmentType = 'image' | 'document' | 'screenshot'

/** A persisted copilot thread (one conversation within a project). */
export interface CopilotThread {
  id: string
  projectId: string
  userId: string
  /** Auto-generated from first message or manually set. */
  title: string | null
  /** Run that was active when the thread was created. */
  activeRunId: string | null
  /** The page/route the user was on when this thread started. */
  pageContext: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
  /** Injected client-side: most recent message preview for the thread list. */
  lastMessagePreview?: string | null
}

/** A persisted copilot message. */
export interface CopilotMessage {
  id: string
  threadId: string
  projectId: string
  role: CopilotMessageRole
  content: string
  /** Set for role='tool' or when the assistant requested a tool call. */
  toolName?: string | null
  /** Links a tool result back to the assistant tool_call it satisfies. */
  toolCallId?: string | null
  /** Raw tool call/result payload (JSONB). */
  toolPayload?: Record<string, unknown> | null
  /** UI snapshot at send time (currentPage, activeRunId, selectedObjectIds). */
  uiContext?: CopilotUiContext | null
  createdAt: string
}

/** Context snapshot captured from the frontend at message send time. */
export interface CopilotUiContext {
  currentPage?: string
  activeRunId?: string | null
  selectedObjectIds?: string[]
  selectedIssueId?: string | null
  /** The speckle_model_refs.id currently displayed in the Speckle viewer. */
  activeModelRefId?: string | null
}

/** Attachment metadata row. Binary lives in Supabase Storage. */
export interface CopilotAttachment {
  id: string
  threadId: string
  messageId: string | null
  projectId: string
  userId: string
  attachmentType: CopilotAttachmentType
  filename: string
  mimeType: string | null
  storagePath: string
  fileSizeBytes: number | null
  /** Rich metadata: page, run, selected objects, etc. */
  contextMetadata: Record<string, unknown> | null
  createdAt: string
}

/** Payload sent from the frontend when the user submits a message. */
export interface CopilotSendMessagePayload {
  content: string
  uiContext?: CopilotUiContext
  attachmentIds?: string[]
}

/** Response shape from POST /api/copilot/threads/[id]/messages */
export interface CopilotSendMessageResponse {
  userMessage: CopilotMessage
  assistantMessage: CopilotMessage
  /** Tool execution steps produced during this turn, in execution order. */
  toolMessages?: CopilotMessage[]
}

// ── Project notes ─────────────────────────────────────────────

export type NoteSourceType = 'manual' | 'copilot'

export interface ProjectNote {
  id: string
  projectId: string
  userId: string
  title: string
  content: string
  pinned: boolean
  sourceType: NoteSourceType
  /** ID of the copilot_messages row that was saved as this note. */
  sourceMessageId?: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateNotePayload {
  title: string
  content: string
  pinned?: boolean
  sourceType?: NoteSourceType
  sourceMessageId?: string | null
}

export interface UpdateNotePayload {
  title?: string
  content?: string
  pinned?: boolean
}

/**
 * Minimal user profile record stored in public.user_profiles.
 * Mirrors the database schema — nullable optional fields match DB defaults.
 */
export interface UserProfile {
  id: string               // = auth.users.id
  fullName: string
  companyOrStudio: string | null
  role: UserRole | null
  timezone: string
  defaultUnits: DefaultUnits
  planIntent: PlanIntent
  createdAt: string
  updatedAt: string
}
