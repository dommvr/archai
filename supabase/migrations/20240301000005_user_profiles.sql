-- ============================================================
-- User Profiles — signup metadata and workspace defaults
-- Migration: 20240301000005_user_profiles.sql
--
-- One row per auth.users entry.
-- Created on signup by lib/actions/auth.ts → signUpWithProfile().
-- Extended at first login for future onboarding flow.
-- ============================================================

create type public.user_role as enum (
  'architect',
  'interior_designer',
  'structural_engineer',
  'mep_engineer',
  'project_manager',
  'developer',
  'student',
  'other'
);

create type public.default_units as enum (
  'metric',
  'imperial'
);

create type public.plan_intent as enum (
  'free',
  'premium'
);

create table public.user_profiles (
  -- Primary key mirrors auth.users.id — no surrogate key needed.
  id                  uuid        primary key
                      references auth.users(id) on delete cascade,

  full_name           text        not null,

  -- Optional profile fields — null when user skipped them during signup.
  company_or_studio   text,
  role                public.user_role,

  -- Workspace defaults — always set during signup (have safe fallback defaults).
  timezone            text        not null default 'UTC',
  default_units       public.default_units not null default 'metric',

  -- Plan intent captured during signup.
  -- Billing is NOT wired yet — this stores intent only.
  -- TODO: replace with actual subscription status once billing is integrated.
  plan_intent         public.plan_intent not null default 'free',

  -- TODO (post-verification onboarding): add onboarding_completed_at timestamptz
  -- to track whether the user has finished first-login onboarding.

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Reuse the trigger helper defined in migration 20240301000001.
-- If this migration runs standalone, define it first.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- ── Row-level security ──────────────────────────────────────
alter table public.user_profiles enable row level security;

-- Users can read and update their own profile only.
create policy "users_own_profile_read" on public.user_profiles
  for select
  using (id = auth.uid());

create policy "users_own_profile_write" on public.user_profiles
  for all
  using (id = auth.uid())
  with check (id = auth.uid());
