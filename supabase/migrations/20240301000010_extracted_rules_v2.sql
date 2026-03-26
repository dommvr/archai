-- ============================================================
-- Migration: 20240301000010_extracted_rules_v2.sql
--
-- Extends extracted_rules with full normalized rule schema for
-- V1 AI rule extraction:
--   - source_kind: 'extracted' | 'manual'
--   - authority fields: is_authoritative, is_recommended
--   - status expansion: approved, auto_approved, superseded added
--   - conflict grouping: conflict_group_id
--   - normalization: normalization_note, effective_date, version_label
--   - rich text fields: condition_text, exception_text
--
-- Also adds: project_extraction_options table for per-project
-- extraction behavior options (auto-apply, threshold, etc.)
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1.  Extend rule_status enum
--     Add: approved, auto_approved, superseded
--
--     Existing: draft, reviewed, rejected
--     New full set: draft, approved, rejected, auto_approved, superseded
--
--     NOTE: 'reviewed' is kept for backward compatibility but treated
--           as equivalent to 'approved' in the authority model.
--           New code should use 'approved'; 'reviewed' will not be
--           emitted by new extraction but must remain valid for
--           existing rows.
-- ════════════════════════════════════════════════════════════

alter type public.rule_status add value if not exists 'approved';
alter type public.rule_status add value if not exists 'auto_approved';
alter type public.rule_status add value if not exists 'superseded';


-- ════════════════════════════════════════════════════════════
-- 2.  Add new columns to extracted_rules
-- ════════════════════════════════════════════════════════════

-- source_kind: 'extracted' (from document AI) | 'manual' (user-created)
-- Manual rules have no source document, so document_id will be nullable
-- after this migration for manual rows.
alter table public.extracted_rules
  add column if not exists source_kind text not null default 'extracted'
    check (source_kind in ('extracted', 'manual'));

-- Relax document_id FK to allow NULL for manual rules.
-- Manual rules have no source document; FK was NOT NULL in the original schema.
-- We use ALTER COLUMN to drop the NOT NULL constraint.
-- The ON DELETE RESTRICT FK itself stays — rows with a document must still
-- reference a valid document.
alter table public.extracted_rules
  alter column document_id drop not null;

-- Authority flags — drive compliance engine rule precedence.
--   is_authoritative: true if this rule is decision-driving
--   is_recommended:   true if conflict resolver chose this as the winner
alter table public.extracted_rules
  add column if not exists is_authoritative boolean not null default false,
  add column if not exists is_recommended   boolean not null default false;

-- Conflict group — UUID shared by all rules representing the same
-- constraint but with differing values across source documents.
-- NULL means no detected conflict for this rule.
alter table public.extracted_rules
  add column if not exists conflict_group_id uuid;

-- Rich provenance fields for the normalized rule schema
alter table public.extracted_rules
  add column if not exists condition_text    text,   -- when/if clause from source
  add column if not exists exception_text    text,   -- exception/waiver language
  add column if not exists normalization_note text,  -- unit conversion note or extraction caveat
  add column if not exists effective_date    date,   -- parsed document effective date if available
  add column if not exists version_label     text;   -- parsed document version if available (e.g. "v2.3")

-- source_chunk_id mirrors citation->chunkId but is a direct FK for query performance.
-- Nullable — populated only for extracted rules from chunked docs.
alter table public.extracted_rules
  add column if not exists source_chunk_id uuid
    references public.document_chunks(id) on delete set null;


-- ════════════════════════════════════════════════════════════
-- 3.  Indexes for new columns
-- ════════════════════════════════════════════════════════════

create index if not exists idx_extracted_rules_source_kind
  on public.extracted_rules(source_kind);

create index if not exists idx_extracted_rules_authoritative
  on public.extracted_rules(project_id, is_authoritative)
  where is_authoritative = true;

create index if not exists idx_extracted_rules_conflict_group
  on public.extracted_rules(conflict_group_id)
  where conflict_group_id is not null;

create index if not exists idx_extracted_rules_chunk_id
  on public.extracted_rules(source_chunk_id)
  where source_chunk_id is not null;


-- ════════════════════════════════════════════════════════════
-- 4.  project_extraction_options
--     Per-project configuration for AI rule extraction behavior.
--     One row per project (upsert on project_id).
-- ════════════════════════════════════════════════════════════

create table if not exists public.project_extraction_options (
  -- One row per project
  project_id                        uuid        primary key
                                    references public.projects(id) on delete cascade,

  -- When true, sufficiently confident extracted rules may be
  -- auto-approved and used directly in compliance without human review.
  -- Default false — manual verification is the safe default.
  rule_auto_apply_enabled           boolean     not null default false,

  -- Minimum confidence (0.0–1.0) an extracted rule must reach for
  -- auto-approval when rule_auto_apply_enabled = true.
  -- 0.82 is chosen as a safe default: high enough that systematic
  -- extraction patterns are trusted, low enough to be reachable by
  -- well-structured zoning code text.
  rule_auto_apply_confidence_threshold numeric   not null default 0.82
    check (rule_auto_apply_confidence_threshold between 0 and 1),

  -- When true, compliance requires manual verification of every rule
  -- before it is decision-driving (even if auto-apply is on).
  -- Default true — belt-and-suspenders for regulatory contexts.
  manual_verification_required      boolean     not null default true,

  -- When true, conflicting extracted rules are auto-resolved using
  -- recommendation logic (newer date / higher version / higher confidence).
  -- If false, conflicts always require human review.
  -- Only applies when rule_auto_apply_enabled = true.
  auto_resolve_conflicts            boolean     not null default false,

  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now()
);

create trigger trg_project_extraction_options_updated_at
  before update on public.project_extraction_options
  for each row execute function public.set_updated_at();

-- RLS: users can manage extraction options for their own projects
alter table public.project_extraction_options enable row level security;
