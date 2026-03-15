-- ============================================================
-- Tool 1: SELECT-only RLS policies for Supabase Realtime
-- Migration: 20240301000002_precheck_realtime_rls.sql
--
-- The supabase_realtime publication for precheck_runs and
-- compliance_issues is already configured in the Supabase
-- dashboard — this migration must NOT alter the publication.
--
-- These policies allow the frontend browser client (user JWT /
-- anon key) to SELECT rows for projects the user owns.
-- All writes continue to flow through the FastAPI service-role
-- client, which bypasses RLS entirely.
--
-- Ownership check: public.projects.user_id = auth.uid()
-- ============================================================


-- ── precheck_runs ─────────────────────────────────────────────
-- Users can read their own runs (for realtime subscription filter
-- `id=eq.{runId}` and for PrecheckRunsList initial load if ever
-- queried directly).

create policy "owner_select" on public.precheck_runs
  for select
  using (
    project_id in (
      select id from public.projects where user_id = auth.uid()
    )
  );


-- ── compliance_issues ─────────────────────────────────────────
-- Users can read issues for runs in their own projects.
-- Required so the Realtime publication can deliver INSERT events
-- to the subscribed browser client.

create policy "owner_select" on public.compliance_issues
  for select
  using (
    run_id in (
      select id from public.precheck_runs
      where project_id in (
        select id from public.projects where user_id = auth.uid()
      )
    )
  );
