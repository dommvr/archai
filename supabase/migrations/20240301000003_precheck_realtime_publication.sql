-- ============================================================
-- Tool 1: Add precheck tables to Supabase Realtime publication
-- Migration: 20240301000003_precheck_realtime_publication.sql
--
-- Migration 001 left this commented-out as "(optional)".
-- Migration 002 added the RLS SELECT policies that realtime
-- requires, but assumed the publication was already set up in
-- the Supabase dashboard — it was not.
--
-- Without this, supabase.channel(...).on('postgres_changes', ...)
-- subscriptions on these tables silently connect but receive zero
-- events, regardless of RLS policies or subscription filter.
--
-- After applying this migration, the existing realtime
-- subscription in PrecheckWorkspace.tsx will receive UPDATE
-- events on precheck_runs and INSERT events on compliance_issues
-- for the authenticated user's runs.
--
-- Idempotent: each ALTER PUBLICATION is wrapped in a DO block
-- that skips it if the table is already in the publication.
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from   pg_publication_tables
    where  pubname   = 'supabase_realtime'
    and    schemaname = 'public'
    and    tablename  = 'precheck_runs'
  ) then
    alter publication supabase_realtime add table public.precheck_runs;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from   pg_publication_tables
    where  pubname   = 'supabase_realtime'
    and    schemaname = 'public'
    and    tablename  = 'compliance_issues'
  ) then
    alter publication supabase_realtime add table public.compliance_issues;
  end if;
end
$$;
