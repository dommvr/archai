"""
backend/scripts/backfill_embeddings.py

Backfill OpenAI embeddings for existing document_chunks that were
stored before migration 20240301000016 added the embedding vector(1536) column.

Usage (from the backend/ directory):
    python -m scripts.backfill_embeddings

    # Limit to a specific project:
    python -m scripts.backfill_embeddings --project-id <uuid>

    # Dry run (count chunks, don't embed):
    python -m scripts.backfill_embeddings --dry-run

Prerequisites:
    1. Migration 20240301000016 must be applied (adds embedding vector(1536))
    2. OPENAI_API_KEY must be set in .env
    3. Run from the backend/ directory so pydantic-settings finds .env

Exit codes:
    0 — completed (even if 0 chunks needed embedding)
    1 — fatal error (bad config, Supabase unreachable, etc.)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from uuid import UUID

log = logging.getLogger("backfill_embeddings")


async def _run(project_id: UUID | None, dry_run: bool) -> None:
    # Import here so .env is loaded before settings is imported
    from app.core.config import settings
    from app.repositories.precheck_repository import PrecheckRepository
    from app.services.document_ingestion import DocumentIngestionService
    from supabase import acreate_client  # type: ignore[import-untyped]

    if not settings.openai_api_key:
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

    # Resolve projects to backfill
    if project_id:
        project_ids = [project_id]
        log.info("Scoped to project %s", project_id)
    else:
        result = await supabase.table("projects").select("id").execute()
        project_ids = [UUID(r["id"]) for r in (result.data or [])]
        log.info("Found %d projects to scan", len(project_ids))

    total_found = 0
    total_embedded = 0

    for pid in project_ids:
        chunks = await repo.get_chunks_without_embeddings(pid, limit=500)
        if not chunks:
            log.debug("Project %s: no un-embedded chunks", pid)
            continue

        total_found += len(chunks)
        log.info(
            "Project %s: %d chunks need embedding",
            pid, len(chunks),
        )

        if dry_run:
            log.info("  (dry-run: skipping)")
            continue

        n = await svc.embed_chunks(chunks)
        total_embedded += n
        log.info(
            "Project %s: embedded %d/%d chunks",
            pid, n, len(chunks),
        )

    if dry_run:
        log.info(
            "Dry run complete — %d chunks across %d project(s) need embedding",
            total_found, len(project_ids),
        )
    else:
        log.info(
            "Backfill complete — embedded %d/%d chunks across %d project(s)",
            total_embedded, total_found, len(project_ids),
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill pgvector embeddings for document_chunks"
    )
    parser.add_argument(
        "--project-id",
        metavar="UUID",
        help="Limit backfill to a specific project UUID",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count chunks that need embedding without calling OpenAI",
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

    project_id: UUID | None = None
    if args.project_id:
        try:
            project_id = UUID(args.project_id)
        except ValueError:
            log.error("Invalid project UUID: %r", args.project_id)
            sys.exit(1)

    asyncio.run(_run(project_id=project_id, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
