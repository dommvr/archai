-- ============================================================
-- Migration: Add district and province to site_contexts
-- 20240301000019_site_context_province_district.sql
--
-- Adds two optional administrative hierarchy columns to
-- site_contexts to support Polish administrative divisions:
--   district  → powiat  (county-level)
--   province  → województwo (region-level)
--
-- Both columns are nullable text — no existing rows are affected.
-- Named in English per project conventions (English naming convention).
--
-- Maps to: SiteContextSchema.district / SiteContextSchema.province
-- Used by: SiteContextMapModal (GUGIK WFS jurisdiction layer)
-- ============================================================

alter table public.site_contexts
  add column if not exists district text,   -- powiat (county)
  add column if not exists province text;   -- województwo (region)
