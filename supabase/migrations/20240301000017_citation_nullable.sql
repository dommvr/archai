-- ============================================================
-- Migration: 20240301000017_citation_nullable.sql
--
-- Manual rules (source_kind = 'manual') have no source document
-- and therefore no citation. The original schema defined citation
-- as NOT NULL because all rules were extracted from documents.
-- Migration 000010 added manual rule support and made document_id
-- nullable, but forgot to relax the citation constraint.
--
-- Fix: drop NOT NULL from extracted_rules.citation.
-- The Python ExtractedRule model and TS ExtractedRuleSchema already
-- treat citation as nullable — no application code changes needed.
-- ============================================================

alter table public.extracted_rules
  alter column citation drop not null;
