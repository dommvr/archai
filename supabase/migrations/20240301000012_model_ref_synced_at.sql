-- Track when geometry metrics were last successfully derived for a model ref.
--
-- selected_at = when the user registered/picked this model version
-- synced_at   = when derive_geometry_snapshot_for_model() last completed successfully
--
-- NULL synced_at means the background metric derivation has not yet completed
-- (e.g. the model was just synced and the background task is still running, or
--  the Speckle token is not configured).

alter table public.speckle_model_refs
  add column if not exists synced_at timestamptz;

comment on column public.speckle_model_refs.synced_at
  is 'Timestamp when geometry metrics were last successfully derived for this model ref. NULL = not yet synced.';
