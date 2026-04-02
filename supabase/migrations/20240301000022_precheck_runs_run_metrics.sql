-- Migration: add run_metrics JSONB column to precheck_runs
--
-- run_metrics stores run-specific computed metrics that require both
-- model geometry data (from geometry_snapshots) and site context
-- (parcel_area_m2).  These cannot be computed at model-sync time
-- because the site context may not exist yet or may change.
--
-- Shape: {
--   far:             number | null,
--   lot_coverage_pct: number | null,
--   gfa_m2:          number | null,
--   parcel_area_m2:  number | null,
--   model_ref_id:    string | null,
--   snapshot_id:     string | null,
--   computed_at:     ISO-8601 string
-- }
--
-- NULL until explicitly computed via POST .../compute-run-metrics.

ALTER TABLE precheck_runs
  ADD COLUMN IF NOT EXISTS run_metrics JSONB DEFAULT NULL;

COMMENT ON COLUMN precheck_runs.run_metrics IS
  'Run-specific metrics (FAR, lot_coverage_pct) derived from model geometry + site context. NULL until compute-run-metrics is called.';
