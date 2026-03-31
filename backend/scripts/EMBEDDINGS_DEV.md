# Embedding maintenance — developer guide

## Two tools, two purposes

| Script | Purpose | Touches |
|--------|---------|---------|
| `backfill_embeddings` | Fill in chunks where `embedding IS NULL` | NULL-only rows |
| `re_embed` | Re-generate embeddings on demand (any scope, optionally overwrite) | Explicit target |

**Do not mix these up.**
`backfill_embeddings` is for the initial migration catch-up after column 20240301000016 is applied.
`re_embed` is for ongoing maintenance: regenerating after a model change, fixing bad embeddings, or re-processing a specific document.

---

## Required env vars

Set these in `backend/.env` before running either script:

```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

The embedding model and dimensions are read from config:

```
EMBEDDING_MODEL=text-embedding-3-small   # default
EMBEDDING_DIMENSIONS=1536                 # default
```

These must match what was used when the `match_document_chunks` RPC was defined
(vector dimension is fixed at the column level — changing model/dimensions requires
a new migration to drop and recreate the `embedding vector(N)` column and HNSW index).

---

## Running the re-embed script

All commands run from the `backend/` directory:

```bash
# Dry run — see scope and counts without calling OpenAI
python -m scripts.re_embed --project-id <uuid> --dry-run

# Re-embed all un-embedded chunks for a project (safe to re-run, skips existing)
python -m scripts.re_embed --project-id <uuid>

# Re-embed all chunks for a project, overwriting existing embeddings
python -m scripts.re_embed --project-id <uuid> --force

# Re-embed all chunks for a single document
python -m scripts.re_embed --document-id <uuid>

# Re-embed one specific chunk
python -m scripts.re_embed --chunk-id <uuid>

# Verbose output
python -m scripts.re_embed --project-id <uuid> --log-level DEBUG
```

### Supported scopes

| Flag | Scope | Chunks fetched via |
|------|-------|--------------------|
| `--project-id` | All chunks across all documents in the project | `get_chunks_for_project()` |
| `--document-id` | All chunks for one document | `get_chunks_for_document()` |
| `--chunk-id` | A single specific chunk | `get_chunk_by_id()` |

The three flags are mutually exclusive — exactly one must be provided.

### `--force` behaviour

Without `--force` (default / idempotent mode):
- Chunks with `embedding IS NOT NULL` are **skipped** — not re-embedded.
- Safe to re-run multiple times; only fills gaps.

With `--force`:
- Every chunk in scope is re-embedded, overwriting existing vectors.
- Use this after switching `EMBEDDING_MODEL` or `EMBEDDING_DIMENSIONS`.

---

## When to use re-embed vs backfill

**Use `backfill_embeddings`** when:
- You have just applied migration `20240301000016` to an existing database and need to embed all pre-existing chunks.
- You want to fill in any `NULL` embeddings across all projects in one pass.

**Use `re_embed`** when:
- A document was re-ingested and its chunks now have stale or wrong embeddings.
- You changed `EMBEDDING_MODEL` and need to regenerate vectors for a specific project.
- A single chunk failed during ingestion and needs to be retried.
- You want to verify retrieval behaviour for one document without touching anything else.

---

## Retrieval compatibility

Re-embedded chunks are immediately queryable by the Copilot retrieval flow
(`CopilotRetriever.retrieve_chunks()` → `match_document_chunks` RPC).

The RPC filters on `embedding IS NOT NULL`, so:
- Chunks with a stale/wrong embedding **will** still be returned (until re-embedded with `--force`).
- Chunks with `embedding IS NULL` are **never** returned (which is why backfilling matters).

---

## Safety notes

- `re_embed` never deletes or re-chunks documents — it only writes to the `embedding` column.
- The operation is safe to re-run; without `--force` it is fully idempotent.
- The default project-scope limit is 2 000 chunks per `get_chunks_for_project()` call.
  For very large projects (> 2 000 chunks), run per-document: iterate over document IDs
  with `--document-id` or increase the limit in `PrecheckRepository.get_chunks_for_project`.
- All operations use the Supabase service-role key — RLS is bypassed.
  These scripts must not be exposed as public API endpoints.
