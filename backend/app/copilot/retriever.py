"""
backend/app/copilot/retriever.py

Retrieval layer for the Copilot — fetches relevant document chunks from the
project knowledge base.

V1 status:
  - The pgvector similarity search path is stubbed with a clear TODO.
  - When OpenAI embeddings + pgvector are active, swap the stub for the
    real RPC call in CopilotRepository.search_document_chunks().
  - The fallback path returns an empty list so the Copilot keeps working
    without retrieval.

Why separate from repositories.py:
  The retriever owns the embedding call (OpenAI API) and the top-k selection
  logic. The repository owns the Supabase query. Keeping them separate means
  the embedding model can be swapped without touching the DB layer.
"""

from __future__ import annotations

import logging
from uuid import UUID

from app.copilot.repositories import CopilotRepository
from app.core.config import settings

log = logging.getLogger(__name__)


class CopilotRetriever:
    def __init__(self, repo: CopilotRepository) -> None:
        self._repo = repo

    async def retrieve(
        self,
        project_id: UUID,
        query: str,
        top_k: int = 5,
    ) -> list[str]:
        """
        Retrieve the top-k relevant document snippets for the given query.

        Returns a list of text strings ready to be injected into the system
        prompt as grounding context.

        Current state: pgvector + embedding pipeline not active.
        When ready:
          1. Generate embedding for `query` via OpenAI
          2. Call repo.search_document_chunks() with the embedding
          3. Return chunk texts

        TODO: Activate once pgvector extension is enabled in Supabase and
        OPENAI_API_KEY is set. See repositories.py search_document_chunks().
        """
        embedding = await self._embed_query(query)

        chunks = await self._repo.search_document_chunks(
            project_id=project_id,
            query_embedding=embedding,
            top_k=top_k,
        )

        if not chunks:
            return []

        return [
            f"[Document: {c.get('document_id', 'unknown')}]\n{c.get('text', '')}"
            for c in chunks
            if c.get("text")
        ]

    async def _embed_query(self, query: str) -> list[float] | None:
        """
        Generate an embedding for the query using OpenAI.

        Returns None (and logs a debug message) if the OpenAI API key is
        not configured — the retriever falls back to empty results gracefully.

        TODO: Activate once OPENAI_API_KEY is set in .env.
        """
        if not settings.openai_api_key:
            log.debug("_embed_query: OPENAI_API_KEY not set, skipping embedding")
            return None

        try:
            # TODO: Replace with actual OpenAI embedding call when ready.
            # from openai import AsyncOpenAI
            # client = AsyncOpenAI(api_key=settings.openai_api_key)
            # response = await client.embeddings.create(
            #     model=settings.embedding_model,
            #     input=query,
            # )
            # return response.data[0].embedding
            log.debug("_embed_query: embedding pipeline stub — returning None")
            return None
        except Exception as exc:  # noqa: BLE001
            log.warning("_embed_query failed: %s", exc)
            return None
