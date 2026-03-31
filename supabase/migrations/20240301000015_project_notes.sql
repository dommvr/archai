-- ============================================================
-- Project Notes
-- Migration: 20240301000015_project_notes.sql
--
-- Stores user-created and Copilot-generated notes scoped to a project.
-- Notes can be pinned, manually authored, or saved from a Copilot answer.
-- ============================================================

-- source_type: how the note was created
create type public.project_note_source as enum (
  'manual',
  'copilot'
);

create table public.project_notes (
  id                uuid        primary key default gen_random_uuid(),

  -- Ownership
  project_id        uuid        not null
                    references public.projects(id) on delete cascade,
  user_id           uuid        not null
                    references auth.users(id) on delete cascade,

  -- Content
  title             text        not null,
  content           text        not null,

  -- Pinned notes surface above regular notes in the list
  pinned            boolean     not null default false,

  -- How the note was created
  source_type       public.project_note_source not null default 'manual',

  -- If source_type = copilot: the copilot_messages.id that was saved as this note
  source_message_id uuid
                    references public.copilot_messages(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Primary query: notes for a project, pinned first, newest updated first
create index idx_project_notes_project_id
  on public.project_notes(project_id, pinned desc, updated_at desc);

create index idx_project_notes_user_id
  on public.project_notes(user_id);

-- Allow finding notes sourced from a specific Copilot message
create index idx_project_notes_source_message_id
  on public.project_notes(source_message_id)
  where source_message_id is not null;

create trigger trg_project_notes_updated_at
  before update on public.project_notes
  for each row execute function public.set_updated_at();

-- RLS: users can only see and manage their own notes
alter table public.project_notes enable row level security;

create policy "Users can manage their own project notes"
  on public.project_notes
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
