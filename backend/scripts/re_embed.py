"""
backend/scripts/re_embed.py

Targeted re-embedding CLI for document_chunks.

Use this when you need to regenerate vector embeddings for:
  - a single chunk     (--chunk-id)
  - one document       (--document-id)
  - all chunks in a project (--project-id)

This is different from the backfill script:
  backfill_embeddings  — fills in chunks where embedding IS NULL
  re_embed             — can also overwrite existing embeddings (--force)

Usage (from the backend/ directory):

  # Re-embed a whole project (skip already-embedded chunks):
  python -m scripts.re_embed --project-id <uuid>

  # Re-embed a whole project and overwrite existing embeddings:
  python -m scripts.re_embed --project-id <uuid> --force

  # Re-embed a single document:
  python -m scripts.re_embed --document-id <uuid>

  # Re-embed one specific chunk:
  python -m scripts.re_embed --chunk-id <uuid>

  # Dry run (count targets, do not call OpenAI):
  python -m scripts.re_embed --project-id <uuid> --dry-run

Prerequisites:
  1. Migration 20240301000016 must be applied (embedding vector(1536) column)
  2. OPENAI_API_KEY must be set in backend/.env
  3. Run from the backend/ directory so pydantic-settings finds .env

Exit codes:
  0 — completed (even if 0 chunks were processed)
  1 — fatal error (bad args, Supabase unreachable, etc.)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from uuid import UUID

log = logging.getLogger("re_embed")


async def _run(
    project_id: UUID | None,
    document_id: UUID | None,
    chunk_id: UUID | None,
    force: bool,
    dry_run: bool,
) -> None:
    # Late imports so .env is loaded before settings is parsed
    from app.core.config import settings
    from app.repositories.precheck_repository import PrecheckRepository
    from app.services.document_ingestion import DocumentIngestionService
    from supabase import acreate_client  # type: ignore[import-untyped]

    if not settings.openai_api_key and not dry_run:
        log.error(
            "OPENAI_API_KEY is not set. "
            "Set it in backend/.env and re-run."
        )
        sys.exit(1)

    log.info("Connecting to Supabase at %s", settings.supabase_url)
    supabase = await acreate_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
    )
    repo = PrecheckRepository(client=supabase)
    svc  = DocumentIngestionService(repo=repo, supabase=supabase)

    # ── Resolve target scope ──────────────────────────────────

    if chunk_id:
        # Single-chunk scope
        chunk = await repo.get_chunk_by_id(chunk_id)
        if chunk is None:
            log.error("Chunk not found: %s", chunk_id)
            sys.exit(1)
        chunks = [chunk]
        scope_label = f"chunk={chunk_id}"

    elif document_id:
        # Document scope
        doc = await repo.get_document_by_id(document_id)
        if doc is None:
            log.error("Document not found: %s", document_id)
            sys.exit(1)
        chunks = await repo.get_chunks_for_document(document_id)
        scope_label = f"document={document_id} ({doc.file_name!r})"

    elif project_id:
        # Project scope
        chunks = await repo.get_chunks_for_project(project_id)
        scope_label = f"project={project_id}"

    else:
        # Unreachable — argparse ensures at least one is set
        log.error("No target specified.")
        sys.exit(1)

    total = len(chunks)
    already_embedded = sum(1 for c in chunks if c.embedding is not None)
    needs_embed = total - already_embedded

    log.info(
        "Scope: %s | total_chunks=%d already_embedded=%d needs_embed=%d force=%s",
        scope_label, total, already_embedded, needs_embed, force,
    )

    if dry_run:
        effective_targets = total if force else needs_embed
        log.info(
            "Dry run — would re-embed %d chunk(s) for %s",
            effective_targets, scope_label,
        )
        return

    if total == 0:
        log.info("No chunks found for %s — nothing to do", scope_label)
        return

    # ── Run re-embedding ──────────────────────────────────────

    embedded, skipped, failed = await svc.re_embed_chunks(
        chunks,
        force=force,
        scope_label=scope_label,
    )

    if failed:
        log.warning(
            "Re-embed finished with failures — "
            "embedded=%d skipped=%d failed=%d for %s",
            embedded, skipped, failed, scope_label,
        )
    else:
        log.info(
            "Re-embed complete — embedded=%d skipped=%d failed=%d for %s",
            embedded, skipped, failed, scope_label,
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Re-embed document_chunks (targeted maintenance tool)"
    )

    # Mutually exclusive target scope
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument(
        "--project-id",
        metavar="UUID",
        help="Re-embed all chunks for a project",
    )
    scope.add_argument(
        "--document-id",
        metavar="UUID",
        help="Re-embed all chunks for a single document",
    )
    scope.add_argument(
        "--chunk-id",
        metavar="UUID",
        help="Re-embed a single specific chunk",
    )

    parser.add_argument(
        "--force",
        action="store_true",
        help=(
            "Overwrite existing embeddings. "
            "Without this flag, already-embedded chunks are skipped."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count targets and log scope without calling OpenAI",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )

    def _parse_uuid(val: str | None, flag: str) -> UUID | None:
        if val is None:
            return None
        try:
            return UUID(val)
        except ValueError:
            log.error("Invalid UUID for %s: %r", flag, val)
            sys.exit(1)

    asyncio.run(
        _run(
            project_id=_parse_uuid(args.project_id, "--project-id"),
            document_id=_parse_uuid(args.document_id, "--document-id"),
            chunk_id=_parse_uuid(args.chunk_id, "--chunk-id"),
            force=args.force,
            dry_run=args.dry_run,
        )
    )


if __name__ == "__main__":
    main()
