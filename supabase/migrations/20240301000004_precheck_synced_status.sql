-- ============================================================
-- Tool 1: Add 'synced' to precheck_run_status enum
-- Migration: 20240301000004_precheck_synced_status.sql
--
-- The backend was transitioning status back to 'created' after
-- a successful model sync, discarding the semantic that the run
-- now has a synced model and geometry snapshot. 'synced' is the
-- correct stable state between model sync completion and the user
-- triggering compliance evaluation.
--
-- Lifecycle after this migration:
--   syncing_model → computing_metrics → synced → evaluating → …
--
-- ALTER TYPE … ADD VALUE cannot run inside a transaction block;
-- Supabase migrations run in autocommit mode so this is safe.
-- The AFTER clause positions 'synced' in the correct lifecycle order.
-- ============================================================

alter type public.precheck_run_status add value 'synced' after 'computing_metrics';
