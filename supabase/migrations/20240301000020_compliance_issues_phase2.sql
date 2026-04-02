-- ============================================================
-- Migration: 20240301000020_compliance_issues_phase2.sql
--
-- Extends compliance_issues for Phase 2 issue generation:
--
-- New columns:
--   project_id          — denormalised for query/RLS convenience
--   issue_type          — controlled vocab: violation/warning/missing_data/
--                         ambiguous_rule/unsupported_basis
--   recommended_action  — deterministic remediation text
--   source_document_id  — FK back to uploaded_documents (copied from rule citation)
--   source_page_start   — page number where rule appears
--   source_page_end     — end page (for multi-page rules)
--   source_section_number — section number string (e.g. "4.2.1")
--   source_section_title  — section title text
--   updated_at          — enable update-tracking (e.g. when status changes)
--
-- Existing columns (unchanged):
--   id, run_id, rule_id, check_id, severity, title, summary, explanation,
--   status, metric_key, actual_value, expected_value, expected_min,
--   expected_max, units, citation, affected_object_ids, affected_geometry,
--   created_at
-- ============================================================

-- ── Issue type enum ───────────────────────────────────────────
-- Controlled vocab for the nature of the issue.
-- violation       = deterministic fail (rule threshold exceeded)
-- warning         = ambiguous result or soft concern
-- missing_data    = metric or basis unavailable; cannot evaluate
-- ambiguous_rule  = rule not authoritative or not fully defined
-- unsupported_basis = rule depends on input we don't yet support (e.g. dwelling units)

create type public.issue_type as enum (
  'violation',
  'warning',
  'missing_data',
  'ambiguous_rule',
  'unsupported_basis'
);

-- ── Extend the table ─────────────────────────────────────────

alter table public.compliance_issues
  add column if not exists project_id          uuid
      references public.projects(id) on delete cascade,

  add column if not exists issue_type          public.issue_type,

  add column if not exists recommended_action  text,

  add column if not exists source_document_id  uuid
      references public.uploaded_documents(id) on delete set null,

  add column if not exists source_page_start   integer,

  add column if not exists source_page_end     integer,

  add column if not exists source_section_number text,

  add column if not exists source_section_title  text,

  add column if not exists updated_at          timestamptz not null default now();

-- ── Indexes ───────────────────────────────────────────────────

create index if not exists idx_compliance_issues_project_id
  on public.compliance_issues(project_id)
  where project_id is not null;

create index if not exists idx_compliance_issues_issue_type
  on public.compliance_issues(run_id, issue_type)
  where issue_type is not null;

create index if not exists idx_compliance_issues_source_doc
  on public.compliance_issues(source_document_id)
  where source_document_id is not null;
