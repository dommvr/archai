-- ============================================================
-- Project: Add default_site_context_id to projects table
-- Migration: 20240301000009_project_default_site_context.sql
--
-- Adds an optional FK so each project can designate one
-- SiteContext as its "default" site context. This context is
-- used to pre-fill SiteContextForm when creating new precheck runs.
--
-- ON DELETE SET NULL: deleting a site context gracefully clears the
-- project's default pointer without deleting the project itself.
--
-- Maps to: SetDefaultSiteContextInputSchema (lib/precheck/schemas.ts)
--          POST /projects/{id}/default-site-context (backend/app/api/routes/precheck.py)
-- ============================================================

alter table public.projects
  add column if not exists default_site_context_id uuid
    references public.site_contexts(id)
    on delete set null;
