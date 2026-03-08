# components/dashboard/precheck

UI components for Tool 1: **Smart Zoning & Code Checker + Permit Pre-Check**.

## Purpose

This folder contains the dashboard-facing UI for the precheck workflow:
- creating and viewing precheck runs
- editing site context
- uploading zoning/code documents
- selecting a Speckle model/version
- viewing compliance issues
- viewing readiness score and checklist
- preparing issue-to-viewer highlighting state

These components should plug into the existing dashboard shell and must not rebuild layout, auth, or global navigation.

## Scope

Components in this folder are responsible for presentation and local interaction only.

They may handle:
- form state
- view state
- selected issue state
- dialog open/close state
- loading / empty / error UI
- calling typed actions or API wrappers

They should **not** contain:
- raw Supabase queries
- compliance formulas
- zoning/business rules
- PDF parsing logic
- Speckle geometry derivation logic
- direct FastAPI orchestration logic
- readiness scoring logic

Business logic belongs in:
- `lib/precheck/*`
- `lib/actions/tools.ts`
- backend FastAPI services

## Planned components

- `precheck-runs-list.tsx`
- `create-precheck-run-dialog.tsx`
- `site-context-form.tsx`
- `document-upload-panel.tsx`
- `rule-extraction-status-card.tsx`
- `speckle-model-picker.tsx`
- `precheck-progress-card.tsx`
- `readiness-score-card.tsx`
- `compliance-issues-table.tsx`
- `compliance-issue-drawer.tsx`
- `permit-checklist-card.tsx`
- `precheck-viewer-panel.tsx`
- `viewer-annotation-controller.tsx`

## Data contracts

Use the canonical Tool 1 contracts from:
- `lib/precheck/constants.ts`
- `lib/precheck/schemas.ts`
- `lib/precheck/types.ts`
- `lib/precheck/rule-engine.ts`
- `lib/precheck/scoring.ts`
- `lib/precheck/services.ts`
- `lib/precheck/api.ts`

If a component shape conflicts with these contracts, the contracts win.

## Viewer integration boundary

Do not mount or tightly couple the real Speckle viewer here unless explicitly needed.

This folder may manage:
- selected issue state
- highlighted object IDs
- site overlay state
- setback overlay state

Actual viewer integration should remain isolated behind the existing viewer seam in the dashboard architecture.

## Realtime boundary

Realtime subscriptions should stay thin and UI-oriented in this folder.
Heavy event handling, persistence, and orchestration belong outside the components.

## Design rules

- Preserve the existing dark cinematic dashboard style
- Use existing `components/ui/*` primitives
- Keep files small and focused
- Prefer composition over giant panels
- Use accessibility-friendly controls and keyboard navigation
- Add loading, empty, and error states for every major panel

## Notes

Tool 1 V1 supports only measurable rules:
- max building height
- front setback
- side setback left/right
- rear setback
- max FAR
- max lot coverage
- parking ratio hook

LLMs may assist with extraction and explanation, but must not decide measurable pass/fail outcomes.

## Status

Current state: scaffold / in progress