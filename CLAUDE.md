# CLAUDE.md — ArchAI

## Agent conventions
**Canonical conventions live in `AGENTS.md`.**
If `CLAUDE.md` and `AGENTS.md` conflict on conventions, follow `AGENTS.md`.

> Working rules, architecture context, and playbooks for Claude sessions in this repo.
> Update this file whenever a material architectural decision changes.

---

## 1. Project Purpose

**ArchAI** is an AI-native design workflow platform for architects. It accelerates feasibility, code checking, BIM-aware design assistance, sustainability analysis, and firm knowledge reuse — aiming for 5–10x speed gains on early-stage design tasks.

**Target users:** Professional architects, small to mid-size AEC firms, design technologists.

### What this repo currently contains (scaffold)
- Next.js 16 App Router with TypeScript strict mode
- Public landing page (`/`) with all marketing sections
- Protected dashboard shell (`/dashboard`) with full layout
- Supabase auth integration (magic link + email/password)
- Placeholder viewer panel (Speckle integration seam)
- AI tool stubs with FastAPI/LangGraph integration hooks
- CLAUDE.md, `.env.example`, full component structure

### What is intentionally NOT implemented yet
- The 9 AI tool logic (all are stubs/placeholders)
- FastAPI backend
- LangGraph agent flows
- Supabase pgvector / RAG
- @speckle/viewer package mounting (clean placeholder wrapper exists)
- Replicate API calls
- Ladybug Tools integration
- Real-time Supabase subscriptions beyond auth
- IFC/Revit export flows

---

## 2. Product Vision

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

## 3. Key Architecture Decisions

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

### Auth and Routing
- **Primary:** `middleware.ts` runs on every request, calls `updateSession()` which validates the JWT via `getUser()` (network call to Supabase — do NOT use `getSession()` server-side).
- **Secondary:** `app/dashboard/layout.tsx` re-validates and passes user to DashboardShell.
- Route rules: `/dashboard` requires auth → redirect `/`. `/` if authed → redirect `/dashboard`.
- Sign out: Server Action calls `supabase.auth.signOut()` + `redirect('/')`.

### UI Architecture
- CSS Grid for the dashboard shell (topbar / sidebar + main + right panel / statusbar)
- Framer Motion for all transitions and entrance animations
- shadcn/ui components styled to the archai dark palette
- Tailwind CSS v3 with custom design tokens
- No global state library — React Context for user, useState for UI state

### State Management
No Zustand, Redux, or Jotai at this stage. Use:
- React Context for cross-component auth state (UserContext in DashboardShell)
- useState / useReducer for local component state
- Server Component data fetching for initial data loads
- When real-time AI tool state grows complex, evaluate Zustand at that point

### Placeholder Strategy
All future AI tool entry points use these comment markers:
```
// READY FOR TOOL X INTEGRATION HERE
// FASTAPI CALL PLACEHOLDER
// LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
// SUPABASE REALTIME SUBSCRIPTION PLACEHOLDER
// SPECKLE VIEWER WILL BE MOUNTED HERE
// SPECKLE EXPORT PLACEHOLDER
```
Never remove these until the integration is actually implemented.

---

## 4. Coding Conventions

### TypeScript
- `strict: true` always. No `any` without a comment explaining why.
- All props must have explicit interfaces or types.
- Import types with `import type { ... }` to keep runtime bundle clean.

### Server vs Client Components
- Default to **Server Components** — no `'use client'` unless the component needs:
  - `useState`, `useEffect`, `useRef`, or other React hooks
  - Browser APIs (`window`, `document`)
  - Event listeners
  - Framer Motion animations
  - R3F canvas
- Add `'use client'` at the top of the file, not inside a function.

### Naming Conventions
- Components: `PascalCase` (`DashboardShell.tsx`)
- Hooks: `camelCase` starting with `use` (`useAuth.ts`)
- Utilities: `camelCase` (`lib/utils.ts`)
- Server Actions: `camelCase` verb-first (`runMassingGenerator`)
- Types/interfaces: `PascalCase` (`NavItem`, `ToolId`)
- Constants: `SCREAMING_SNAKE_CASE` for module-level constants (`NAV_ITEMS`)
- CSS classes: Tailwind utilities only, no custom class names unless in `globals.css`

### File Organization
```
app/                    → Routes (Next.js App Router)
components/landing/     → Landing page section components
components/dashboard/   → Dashboard shell components
components/ui/          → shadcn/ui primitive components
lib/supabase/           → Supabase client utilities (client, server, middleware)
lib/actions/            → Server Actions
hooks/                  → React hooks (client-side only)
types/                  → Shared TypeScript types
public/                 → Static assets
```

### Styling
- Tailwind utility classes only. No inline `style={{}}` except for truly dynamic values (e.g., Framer Motion transforms).
- Use the `cn()` utility from `lib/utils.ts` for conditional class merging.
- Dark theme is the ONLY theme. No light mode toggle needed.
- Design tokens are in `tailwind.config.ts` under `theme.extend.colors.archai`.
- The blueprint grid texture is the `.blueprint-grid` background utility class.

### Component Composition
- Prefer many small, focused components over large monolith files.
- A component file should do one thing. If it exceeds ~200 lines, consider splitting.
- Pass callbacks down, not the entire state object.

### Comment Conventions
Integration point markers (see Placeholder Strategy above) are mandatory in relevant files.
Other comments: explain **why**, not **what** the code does.

### Accessibility
- All interactive elements must be keyboard accessible.
- Radix UI primitives handle ARIA roles — don't override without good reason.
- Color contrast must meet WCAG AA for body text and controls.
- Icon-only buttons must have `aria-label`.

### No Dead Code
- Remove unused imports immediately.
- Don't leave commented-out code blocks (use git history for recovery).
- Magic numbers must have a named constant or an inline comment.

---

## 5. How Claude Should Work In This Repo

### Before Making Changes
1. Read the relevant existing files before proposing changes.
2. Check if an existing component, hook, or utility already does what you need.
3. Check `types/index.ts` for existing types before creating new ones.
4. Check `lib/actions/tools.ts` for the tool stub pattern before creating new actions.

### Visual Language
- Preserve the dark cinematic aesthetic at all costs.
- New components must use `archai-*` color tokens, not hardcoded hex values.
- Blueprint grid texture (`bg-blueprint-grid bg-blueprint-grid`) is used on viewer areas and hero sections.
- Glassmorphism (`backdrop-blur`, low-opacity backgrounds) only in floating elements (toolbars, panels).

### Adding Features
- When adding a new tool: extend the existing sidebar nav, create a route under `/dashboard/[tool]`, add a server action stub in `lib/actions/tools.ts`, add the route handler in `app/api/agents/[tool]/route.ts`.
- Do NOT rebuild the dashboard layout for a new tool. Slot into the existing shell.
- Do NOT replace shadcn/ui components with custom ones without justification.
- Do NOT add new dependencies without a comment explaining the justification.

### Debugging
1. Find the root cause before changing code.
2. Check the Supabase middleware (`lib/supabase/middleware.ts`) first for any auth issues.
3. For R3F / Three.js issues, check `transpilePackages` in `next.config.ts` first.
4. For Tailwind class not applying, check the `content` glob in `tailwind.config.ts`.

### Auth Rules
- NEVER use `supabase.auth.getSession()` in server-side code. Always use `getUser()`.
- Auth state in client components comes from `useAuth()` hook or `UserContext`.
- Sign-out always goes through the `signOut()` Server Action in `lib/actions/auth.ts`.
- Do not add new Supabase client instances — use the existing singletons in `lib/supabase/`.

### Speckle Viewer
- All Speckle logic must live inside `components/dashboard/ViewerPanel.tsx` or a dedicated `lib/speckle/` directory.
- The `div#speckle-viewer` mount point must not be moved or renamed.
- When mounting @speckle/viewer, use `useEffect` + `useRef` inside a `'use client'` component.
- Keep the viewer isolated — do not let Speckle types leak into other components.

---

## 6. Common Task Playbooks

### Adding a new tool page or module
1. Add to `NAV_ITEMS` array in `components/dashboard/Sidebar.tsx`
2. Add `ToolId` variant to `types/index.ts`
3. Create `app/dashboard/[tool-slug]/page.tsx` (Server Component, redirects to `/` if no user)
4. Add stub in `lib/actions/tools.ts`
5. Add route handler case in `app/api/agents/[tool]/route.ts`
6. Create component in `components/dashboard/tools/[ToolName].tsx`
7. Add to `CommandPalette` tool list in `components/dashboard/CommandPalette.tsx`

### Wiring a FastAPI endpoint
1. Set `NEXT_PUBLIC_API_URL` in `.env.local`
2. In `lib/actions/tools.ts`, replace the stub with:
   ```ts
   const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/[endpoint]`, {
     method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(payload)
   })
   return res.json()
   ```
3. Remove the `// FASTAPI CALL PLACEHOLDER` comment once implemented.

### Adding Supabase realtime
1. In the relevant client component, get the browser client: `const supabase = getSupabaseBrowserClient()`
2. Subscribe:
   ```ts
   useEffect(() => {
     const channel = supabase.channel('table-changes')
       .on('postgres_changes', { event: '*', schema: 'public', table: 'your_table' }, handler)
       .subscribe()
     return () => { supabase.removeChannel(channel) }
   }, [])
   ```
3. Remove the `// SUPABASE REALTIME SUBSCRIPTION PLACEHOLDER` comment once implemented.

### Integrating Speckle viewer logic
1. Install: `npm install @speckle/viewer`
2. In `components/dashboard/ViewerPanel.tsx`, add:
   ```ts
   import { Viewer, DefaultViewerParams } from '@speckle/viewer'
   // Inside useEffect:
   const viewer = new Viewer(viewerRef.current!, DefaultViewerParams)
   await viewer.init()
   ```
3. Load streams via `viewer.loadObject(streamUrl, token)`
4. Remove the `// SPECKLE VIEWER WILL BE MOUNTED HERE` comment once mounted.

### Debugging broken auth
1. Check browser console for Supabase errors.
2. Check `middleware.ts` matcher — ensure the route is not excluded.
3. Check `lib/supabase/middleware.ts` — verify cookie `get`/`set`/`remove` handlers.
4. Confirm `.env.local` has correct `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. In Supabase dashboard, check Auth → Users to confirm the user exists.
6. Check Supabase Auth settings → URL Configuration → Site URL and Redirect URLs.

### Improving dashboard performance
1. Profile with React DevTools Profiler.
2. Check for unnecessary re-renders — add `React.memo` or split state down.
3. Lazy-load heavy components with `dynamic(() => import(...), { ssr: false })`.
4. Check for large bundle sizes with `npm run build` and review the size report.

### Creating skeleton loading states
Use the `Skeleton` pattern (animate-pulse gray blocks):
```tsx
<div className="h-4 w-full rounded bg-archai-graphite animate-pulse" />
```
Place skeletons in the same layout position as the real content.

### Adding modals/dialog flows
1. Use shadcn/ui `Dialog` from `components/ui/dialog.tsx`.
2. Control open state with `useState` in the parent.
3. Pass `onOpenChange` down to allow closing from within.
4. For complex multi-step flows, use a `step` state inside the dialog.

---

## 7. Local Development

### Install
```bash
npm install
# If peer dependency conflicts occur (R3F/drei):
npm install --legacy-peer-deps
```

### Environment Setup
```bash
cp .env.example .env.local
# Edit .env.local with your Supabase project URL and anon key
```

### Supabase Setup
1. Create a project at [supabase.com](https://supabase.com)
2. Go to Project Settings → API → copy Project URL and anon key
3. Go to Authentication → URL Configuration:
   - Site URL: `http://localhost:3000`
   - Redirect URLs: `http://localhost:3000/dashboard`
4. Enable Email auth (magic link) in Authentication → Providers

### Run Dev
```bash
npm run dev
# App runs at http://localhost:3000
```

### Common Commands
```bash
npm run dev          # Start development server
npm run build        # Production build (also runs type check)
npm run type-check   # TypeScript check only (no build)
npm run lint         # ESLint
```

### Where to Swap Placeholder Viewer
`components/dashboard/ViewerPanel.tsx` — see the "Integrating Speckle viewer logic" playbook above.

---

## 8. Future Integration Notes

### FastAPI Backend
- Set `NEXT_PUBLIC_API_URL` env var pointing to the FastAPI server.
- Stubs in `lib/actions/tools.ts` are the entry points.
- Auth: pass the Supabase JWT token in `Authorization: Bearer` header to FastAPI.
- FastAPI should verify the JWT using the Supabase JWT secret.

### LangGraph Agents
- Each tool maps to a LangGraph graph in the FastAPI backend.
- The `app/api/agents/[tool]/route.ts` route proxies to FastAPI and streams responses.
- Use SSE (Server-Sent Events) or Next.js streaming for long-running agent runs.

### pgvector / RAG (Firm Knowledge Assistant)
- Supabase already has pgvector enabled as an extension.
- Create a `documents` table with a `embedding vector(1536)` column.
- Use OpenAI `text-embedding-3-small` or a local embedding model via FastAPI.
- The `firm-knowledge` stub in `lib/actions/tools.ts` is the entry point.

### Ladybug Tools
- Runs as a Python microservice (Grasshopper/Rhino.Compute or standalone).
- FastAPI acts as the bridge between Next.js and Ladybug.
- Results (solar analysis, wind rose, energy use) are returned as GeoJSON or metrics JSON.
- The `sustainability-copilot` stub is the entry point.

### Replicate
- Used for AI image generation (render previews, concept art from massing).
- Set `REPLICATE_API_TOKEN` env var.
- Call via `fetch('https://api.replicate.com/v1/predictions', ...)` or the Replicate SDK.
- Integrate in the `spec-writer` or `massing-generator` tools.

### IFC Export
- Use `web-ifc` (TypeScript) or `IfcOpenShell` (Python via FastAPI) for IFC parsing/writing.
- The `export-sync` stub is the entry point.
- Speckle can also handle IFC import/export natively.

### Revit / Rhino Interoperability
- Revit: Speckle Connector for Revit handles bidirectional sync.
- Rhino: Speckle Connector for Rhino + Grasshopper.
- Both sync to the Speckle stream that the viewer displays.
- The `export-sync` tool route covers both.
