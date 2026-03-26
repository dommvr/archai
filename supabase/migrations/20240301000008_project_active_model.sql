-- ============================================================
-- Project: Add active_model_ref_id to projects table
-- Migration: 20240301000008_project_active_model.sql
--
-- Adds an optional FK so each project can designate one
-- SpeckleModelRef as its "active" model. This ref is used to
-- pre-fill SpeckleModelPicker when creating a new precheck run.
--
-- ON DELETE SET NULL: deleting a model ref gracefully clears the
-- project's active pointer without deleting the project itself.
--
-- Maps to: SetActiveProjectModelInputSchema (lib/precheck/schemas.ts)
--          POST /projects/{id}/active-model  (backend/app/api/routes/precheck.py)
-- ============================================================

alter table public.projects
  add column if not exists active_model_ref_id uuid
    references public.speckle_model_refs(id)
    on delete set null;
