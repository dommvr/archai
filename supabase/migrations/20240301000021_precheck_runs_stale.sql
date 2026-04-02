-- Migration: 20240301000021_precheck_runs_stale.sql
--
-- Adds staleness tracking to precheck_runs.
--
-- `is_stale` becomes true when the authoritative rule set changes (approve /
-- unapprove / reject / new manual rule) AFTER the last successful evaluation.
-- The evaluate endpoint resets it to false at the start of each run.
--
-- `rules_changed_at` records when rules last changed so the UI can show
-- a precise "results are based on rules as of …" message.

alter table public.precheck_runs
  add column if not exists is_stale boolean not null default false,
  add column if not exists rules_changed_at timestamptz;

comment on column public.precheck_runs.is_stale is
  'True when approved rule set has changed since last compliance evaluation.';
comment on column public.precheck_runs.rules_changed_at is
  'Timestamp of the most recent rule approval/unapproval that could affect this run.';
