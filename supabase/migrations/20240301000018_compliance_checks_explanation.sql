-- ============================================================
-- Migration: 20240301000018_compliance_checks_explanation.sql
--
-- ComplianceCheck rows now carry a deterministic explanation
-- produced by the Python evaluator (e.g. "Building height 38.2 ft
-- exceeds maximum allowed 35 ft.").  The column is nullable so
-- that existing rows and MISSING_INPUT / AMBIGUOUS checks that
-- have no numeric explanation remain valid.
-- ============================================================

alter table public.compliance_checks
  add column if not exists explanation text;
