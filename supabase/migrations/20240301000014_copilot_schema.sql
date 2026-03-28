-- ============================================================
-- Copilot: Project-scoped threaded chat with persistence
-- Migration: 20240301000014_copilot_schema.sql
--
-- Tables:
--   copilot_threads        — one conversation per project (many per project)
--   copilot_messages       — messages within a thread
--   copilot_attachments    — files/images attached to messages
--   copilot_thread_summaries — optional compressed summaries for long threads
--
-- Design decisions:
--   • threads are project-scoped (project_id FK)
--   • messages support role = user | assistant | tool | system
--   • attachments store metadata only; binaries live in Supabase Storage
--   • thread_summaries let the context builder compress old history
--   • pgvector column on messages left as a TODO seam (commented out)
--     — enable once pgvector extension + embedding pipeline are active
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- ENUM TYPES
-- ════════════════════════════════════════════════════════════

create type public.copilot_message_role as enum (
  'user',
  'assistant',
  'tool',
  'system'
);

create type public.copilot_attachment_type as enum (
  'image',
  'document',
  'screenshot'
);


-- ════════════════════════════════════════════════════════════
-- copilot_threads
-- ════════════════════════════════════════════════════════════

create table public.copilot_threads (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- Human-readable title, generated from the first user message or set manually
  title           text,

  -- Snapshot of the active run when the thread was created.
  -- Helps the context builder understand which run the thread relates to.
  active_run_id   uuid references public.precheck_runs(id) on delete set null,

  -- The page/route the user was on when they opened the copilot.
  -- Gives the context builder a hint about what the user is looking at.
  -- Example: "viewer", "precheck", "documents"
  page_context    text,

  -- Soft-delete: archived threads are hidden from the list but not destroyed.
  archived        boolean not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Fast lookup: all threads for a project, newest first
create index copilot_threads_project_id_created_at_idx
  on public.copilot_threads (project_id, created_at desc);

-- Fast lookup: all non-archived threads for a user
create index copilot_threads_user_id_archived_idx
  on public.copilot_threads (user_id, archived);


-- ════════════════════════════════════════════════════════════
-- copilot_messages
-- ════════════════════════════════════════════════════════════

create table public.copilot_messages (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references public.copilot_threads(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,

  role            public.copilot_message_role not null,

  -- Primary content of the message (markdown-safe text or tool result JSON string)
  content         text not null,

  -- For tool messages: the name of the tool that was called.
  -- For assistant messages that triggered a tool call: the tool name is in tool_name.
  tool_name       text,

  -- For tool result messages: the call ID that links back to the assistant's tool_call.
  tool_call_id    text,

  -- Structured tool result / tool call payload stored as JSONB for queryability.
  -- For role=tool: the raw tool result object.
  -- For role=assistant with tool calls: the array of tool_calls requested.
  tool_payload    jsonb,

  -- UI context snapshot captured at send time.
  -- Lets us reconstruct what the user was looking at when they sent this message.
  ui_context      jsonb,

  -- TODO: pgvector embedding for semantic search over message history
  -- Uncomment once pgvector extension is active and embedding pipeline ready.
  -- embedding      vector(1536),

  created_at      timestamptz not null default now()
);

-- Fast ordered message retrieval for a thread
create index copilot_messages_thread_id_created_at_idx
  on public.copilot_messages (thread_id, created_at asc);

-- Needed for context builder to filter messages by project
create index copilot_messages_project_id_idx
  on public.copilot_messages (project_id);


-- ════════════════════════════════════════════════════════════
-- copilot_attachments
-- ════════════════════════════════════════════════════════════

create table public.copilot_attachments (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references public.copilot_threads(id) on delete cascade,

  -- Null until the attachment is linked to a specific message
  message_id      uuid references public.copilot_messages(id) on delete set null,

  project_id      uuid not null references public.projects(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,

  attachment_type public.copilot_attachment_type not null,

  -- Original filename shown to the user
  filename        text not null,

  -- MIME type (e.g. "image/png", "application/pdf")
  mime_type       text,

  -- Storage path in Supabase Storage bucket "copilot-attachments"
  storage_path    text not null,

  -- File size in bytes
  file_size_bytes bigint,

  -- Optional metadata: page context, active run, selected objects, etc.
  -- Used to enrich the message context when this attachment is referenced.
  context_metadata jsonb,

  created_at      timestamptz not null default now()
);

create index copilot_attachments_thread_id_idx
  on public.copilot_attachments (thread_id);

create index copilot_attachments_message_id_idx
  on public.copilot_attachments (message_id);


-- ════════════════════════════════════════════════════════════
-- copilot_thread_summaries
-- Optional: compressed summaries for long threads.
-- The context builder uses these to stay within token limits
-- without discarding history — it injects the summary instead
-- of the raw messages when the thread is long.
-- ════════════════════════════════════════════════════════════

create table public.copilot_thread_summaries (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references public.copilot_threads(id) on delete cascade,

  -- The LLM-generated summary covering messages up to summarized_through_message_id
  summary         text not null,

  -- The ID of the last message covered by this summary.
  -- Messages after this point are appended verbatim.
  summarized_through_message_id uuid references public.copilot_messages(id) on delete set null,

  -- How many tokens the summary represents (approximate)
  token_count     int,

  created_at      timestamptz not null default now()
);

create unique index copilot_thread_summaries_thread_id_idx
  on public.copilot_thread_summaries (thread_id);


-- ════════════════════════════════════════════════════════════
-- UPDATED_AT TRIGGERS
-- Keeps copilot_threads.updated_at current on any message insert.
-- ════════════════════════════════════════════════════════════

create or replace function public.copilot_touch_thread_updated_at()
returns trigger language plpgsql as $$
begin
  update public.copilot_threads
  set updated_at = now()
  where id = NEW.thread_id;
  return NEW;
end;
$$;

create trigger copilot_messages_touch_thread
  after insert on public.copilot_messages
  for each row execute procedure public.copilot_touch_thread_updated_at();

create trigger copilot_attachments_touch_thread
  after insert on public.copilot_attachments
  for each row execute procedure public.copilot_touch_thread_updated_at();


-- ════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Users can only see their own threads/messages/attachments.
-- Service-role key (backend) bypasses RLS entirely.
-- ════════════════════════════════════════════════════════════

alter table public.copilot_threads          enable row level security;
alter table public.copilot_messages         enable row level security;
alter table public.copilot_attachments      enable row level security;
alter table public.copilot_thread_summaries enable row level security;

-- Threads
create policy "Users can manage their own threads"
  on public.copilot_threads
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Messages (scoped through thread ownership)
create policy "Users can manage messages in their threads"
  on public.copilot_messages
  for all
  using (
    exists (
      select 1 from public.copilot_threads t
      where t.id = thread_id
        and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.copilot_threads t
      where t.id = thread_id
        and t.user_id = auth.uid()
    )
  );

-- Attachments
create policy "Users can manage their own attachments"
  on public.copilot_attachments
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Thread summaries (read-only via client; written by service-role only)
create policy "Users can read summaries of their threads"
  on public.copilot_thread_summaries
  for select
  using (
    exists (
      select 1 from public.copilot_threads t
      where t.id = thread_id
        and t.user_id = auth.uid()
    )
  );
