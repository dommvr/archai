# AGENTS.md — ArchAI

> Unified working rules, architecture context, and playbooks for AI coding agents
> (Claude, Codex, and compatible repo assistants).
> Update this file whenever a material architectural decision changes.

---

## 1. Purpose of This File

This file defines the **shared conventions and constraints** all coding agents must follow in this repository.

It exists to:
- keep Claude and Codex aligned
- reduce inconsistent code style and architecture drift
- preserve intentional seams and placeholders
- make future AI-assisted work predictable and safe

If another agent-specific file exists (for example `CLAUDE.md`), this file should be treated as the **canonical default** unless a tool explicitly requires its own format.

---

## 2. Project Purpose

**ArchAI** is an AI-native design workflow platform for architects. It accelerates feasibility, code checking, BIM-aware design assistance, sustainability analysis, and firm knowledge reuse — aiming for 5–10x speed gains on early-stage design tasks.

**Target users:** Professional architects, small to mid-size AEC firms, design technologists.

### What this repo currently contains (scaffold)
- Next.js 16 App Router with TypeScript strict mode
- Public landing page (`/`) with all marketing sections
- Protected dashboard shell (`/dashboard`) with full layout
- Supabase auth integration (magic link + email/password)
- Placeholder viewer panel (Speckle integration seam)
- AI tool stubs with FastAPI/LangGraph integration hooks
- Environment template and full component structure

### What is intentionally NOT implemented yet
- The 9 AI tool logic (all are stubs/placeholders)
- FastAPI backend
- LangGraph agent flows
- Supabase pgvector / RAG
- `@speckle/viewer` package mounting (clean placeholder wrapper exists)
- Replicate API calls
- Ladybug Tools integration
- Real-time Supabase subscriptions beyond auth
- IFC/Revit export flows

---

## 3. Product Vision

ArchAI is a **viewer-centric, interoperable** design platform. It is NOT a Revit replacement. It augments existing AEC toolchains through AI-powered automation and insight overlaid on a central 3D model viewer.

### The 9 Future AI Tools (not yet implemented)

| # | Tool | Purpose |
|---|------|---------|
| 1 | Site Analysis & Zoning Checker | Parse zoning codes, flag violations, pre-check permit conditions |
| 2 | Massing Generator | AI feasibility massing from a brief and site constraints |
| 3 | Space Planner / Test-Fit | Generate space layouts from program requirements |
| 4 | Live Metrics Dashboard | GFA, efficiency, carbon, code risk — live as model changes |
| 5 | Option Comparison Board | Side-by-side comparison of design alternatives |
| 6 | Sustainability Copilot | Real-time embodied carbon, Ladybug solar/wind analysis |
| 7 | Firm Knowledge Assistant | RAG over firm documents, specs, past projects |
| 8 | Brief-to-Program Translator | Parse client brief into structured architectural program |
| 9 | Spec Writer + Sketch-to-BIM | Generate specs and translate rough sketches to BIM elements |

---

## 4. Core Architecture Decisions

### Why Next.js App Router
Server Components allow auth-checked page rendering without client-side flicker. Layouts compose cleanly for the dashboard shell. Server Actions provide type-safe API calls without boilerplate REST endpoints for simple operations.

### Why Supabase
Auth, Postgres, pgvector (for future RAG), realtime subscriptions, and file storage in one service. The `@supabase/ssr` package handles cookie-based sessions correctly in Next.js App Router without client-side only auth.

### Why Speckle (placeholder)
Speckle is the open-source 3D model collaboration layer used in AEC. The viewer will be mounted into `div#speckle-viewer` inside `ViewerPanel`. The `@speckle/viewer` package is NOT installed at scaffold stage — it requires careful integration with Next.js SSR. The wrapper is clean and ready.

### Why placeholders for FastAPI / LangGraph
The AI tools require a Python backend (LangChain/LangGraph agents, Ladybug Tools, PuLP optimization). These run in a separate FastAPI service. Next.js communicates via `fetch` to `/api/agents/[tool]` (currently a stub) or directly to the FastAPI URL. The seam is clean.

### Why modular feature seams
Each tool is isolated behind:
1. A sidebar nav item → tool route
2. A Server Action in `lib/actions/tools.ts`
3. An API route handler in `app/api/agents/[tool]/route.ts`
4. A dashboard panel component

Adding a new tool means extending the existing seam, not rewiring the layout.

---

## 5. Auth and Routing Rules

### Auth model
- **Primary:** `middleware.ts` runs on every request, calls `updateSession()` which validates the JWT via `getUser()`
- **Secondary:** `app/dashboard/layout.tsx` re-validates and passes user to `DashboardShell`
- Route rules:
  - `/dashboard` requires auth → redirect `/`
  - `/` if authenticated → redirect `/dashboard`

### Critical auth constraints
- **Never** use `supabase.auth.getSession()` in server-side code
- Always use `getUser()` for server-side auth validation
- Sign out goes through the Server Action in `lib/actions/auth.ts`
- Do not introduce duplicate Supabase client instances
- Use existing utilities from `lib/supabase/`

---

## 6. UI and State Architecture

### UI architecture
- CSS Grid for dashboard shell layout
- Framer Motion for transitions and entrance animations
- shadcn/ui components styled to the ArchAI dark palette
- Tailwind CSS v3 with custom design tokens
- No global state library at this stage

### State management
Use:
- React Context for cross-component auth state
- `useState` / `useReducer` for local UI state
- Server Component data fetching for initial data loads

Do **not** add Zustand, Redux, Jotai, or another state library unless there is a demonstrated need and the change is explicitly justified.

---

## 7. Placeholder Strategy

All future AI tool entry points use these comment markers:

```ts
// READY FOR TOOL X INTEGRATION HERE
// FASTAPI CALL PLACEHOLDER
// LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
// SUPABASE REALTIME SUBSCRIPTION PLACEHOLDER
// SPECKLE VIEWER WILL BE MOUNTED HERE
// SPECKLE EXPORT PLACEHOLDER