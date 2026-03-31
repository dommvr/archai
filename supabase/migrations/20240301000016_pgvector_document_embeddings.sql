-- ============================================================
-- pgvector: Document Chunk Embeddings
-- Migration: 20240301000016_pgvector_document_embeddings.sql
--
-- Adds vector(1536) embedding column to document_chunks and
-- exposes a match_document_chunks() RPC function for cosine
-- similarity search.
--
-- Prerequisites (run once per Supabase project, requires Supabase
-- Postgres >= 15 with the vector extension available):
--
--   create extension if not exists vector;
--
-- This migration assumes the extension is already enabled.
-- If not, enable it in: Supabase dashboard → Database → Extensions → vector
-- Or run the line above in the SQL editor first.
--
-- Embedding model: text-embedding-3-small (1536 dimensions)
-- Set EMBEDDING_MODEL env var to change the model; update dimensions if needed.
--
-- The old embedding_raw real[] column is kept for now and will be
-- dropped in a future migration once the pipeline fully migrates.
-- ============================================================

-- 1. Enable pgvector extension
--    No-op if already enabled.
create extension if not exists vector;

-- 2. Add the embedding column
--    vector(1536) = text-embedding-3-small output dimension.
--    Nullable: existing chunks without embeddings get NULL.
--    The ingestion pipeline populates this after text extraction.
alter table public.document_chunks
  add column if not exists embedding vector(1536);

-- 3. HNSW index for cosine similarity search
--    HNSW is preferred over IVFFlat for recall on small-medium datasets.
--    ef_construction=128 / m=16 are good defaults for zoning docs.
--    This index is only used when at least one row has a non-null embedding.
create index if not exists idx_document_chunks_embedding
  on public.document_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 128);

-- 4. Partial index for fast "needs embedding" backfill queries
create index if not exists idx_document_chunks_no_embedding
  on public.document_chunks (document_id, chunk_index)
  where embedding is null;

-- 5. match_document_chunks RPC
--    Called from CopilotRepository.search_document_chunks().
--    Returns top-k chunks from a project by cosine similarity.
--
--    Parameters:
--      query_embedding  vector(1536)  — embedded user query
--      match_project_id uuid          — scope to this project's documents
--      match_count      int           — top-k results (typically 5–10)
--      match_threshold  float         — minimum similarity (0–1, default 0.5)
--
--    Returns rows containing:
--      id, document_id, chunk_index, chunk_text, page, section,
--      metadata, file_name, document_type, similarity
--
--    Joins uploaded_documents so callers get file_name without
--    a second round-trip.

create or replace function public.match_document_chunks(
  query_embedding  vector(1536),
  match_project_id uuid,
  match_count      int     default 5,
  match_threshold  float   default 0.5
)
returns table (
  id            uuid,
  document_id   uuid,
  chunk_index   int,
  chunk_text    text,
  page          int,
  section       text,
  metadata      jsonb,
  file_name     text,
  document_type text,
  similarity    float
)
language sql
stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.chunk_text,
    dc.page,
    dc.section,
    dc.metadata,
    ud.file_name,
    ud.document_type::text,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.uploaded_documents ud
    on ud.id = dc.document_id
  where
    ud.project_id = match_project_id
    and dc.embedding is not null
    and 1 - (dc.embedding <=> query_embedding) >= match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- 6. Grant execute to authenticated and service roles
grant execute on function public.match_document_chunks(vector, uuid, int, float)
  to authenticated, service_role;

-- ============================================================
-- Manual steps required after running this migration:
--
--   1. Confirm the vector extension is enabled in Supabase:
--      Dashboard → Database → Extensions → look for "vector"
--
--   2. Set OPENAI_API_KEY in backend/.env
--
--   3. Backfill embeddings for existing chunks:
--      cd backend && python -m scripts.backfill_embeddings
--
--   4. New documents will be embedded automatically via embed_chunks()
--      called at the end of DocumentIngestionService.process_document().
-- ============================================================
