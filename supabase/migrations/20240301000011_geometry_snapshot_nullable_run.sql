-- Allow geometry snapshots to be stored at the project-model level
-- without requiring an associated precheck run.
-- This enables metric derivation when syncing a project model directly.

alter table public.geometry_snapshots
  alter column run_id drop not null;

-- Index for efficient lookup by model ref (project-level metrics).
create index if not exists ix_geometry_snapshots_model_ref_id
  on public.geometry_snapshots (speckle_model_ref_id);
