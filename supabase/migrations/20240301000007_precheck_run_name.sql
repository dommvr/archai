-- ============================================================
-- Tool 1: Add human-readable name to precheck_runs
-- Migration: 20240301000007_precheck_run_name.sql
--
-- Adds an optional user-supplied name so runs can be labelled
-- ("Tower Option A check", "Variance submission 2026") instead
-- of being identified only by their UUID.
--
-- Maps to: PrecheckRunSchema.name (lib/precheck/schemas.ts)
--          PrecheckRun.name       (backend/app/core/schemas.py)
-- ============================================================

alter table public.precheck_runs
  add column name text;
