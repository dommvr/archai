-- ============================================================
-- Add SELECT RLS policy for speckle_model_refs.
--
-- Context: RLS was enabled on speckle_model_refs in migration
-- 20240301000001 but no SELECT policy was ever created, so any
-- direct query from the frontend (anon key + user JWT) returns
-- empty rows. All writes continue through FastAPI (service-role
-- key, bypasses RLS) — only SELECT is needed here.
--
-- The project viewer page previously queried speckle_model_refs
-- directly from a Server Component and always got null back,
-- causing the viewer to show "Sync a Speckle model to see 3D
-- view" even when a model was synced. The viewer page has since
-- been fixed to fetch via FastAPI, but this policy is added for
-- correctness and future-proofing (realtime subscriptions, etc.).
-- ============================================================

create policy "owner_select" on public.speckle_model_refs
  for select
  using (
    project_id in (
      select id from public.projects where user_id = auth.uid()
    )
  );
