"""
backend/app/copilot/retriever.py

Retrieval layer for the Copilot — semantic search over project document
chunks using pgvector.

Architecture:
  retriever.py       — embeds queries, orchestrates top-k selection
  repositories.py    — owns the Supabase RPC call (match_document_chunks)
  document_ingestion — generates and persists chunk embeddings at ingest time

Fallback behaviour:
  If OPENAI_API_KEY is not set, or pgvector/migration is not applied,
  the retriever returns an empty list.  The Copilot continues to work —
  it just can't use document-grounded snippets.

Logging:
  DEBUG — embedding generated, RPC matched N chunks
  INFO  — final snippet count returned to caller
  WARNING — API failure / no embeddings found
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from app.copilot.repositories import CopilotRepository
from app.core.config import settings

log = logging.getLogger(__name__)


class RetrievedChunk:
    """Structured result from a single matched document chunk."""

    __slots__ = (
        "chunk_id", "document_id", "file_name",
        "document_type", "chunk_text", "page",
        "section", "similarity",
    )

    def __init__(self, row: dict[str, Any]) -> None:
        self.chunk_id:      str        = row["id"]
        self.document_id:   str        = row["document_id"]
        self.file_name:     str        = row.get("file_name") or "unknown"
        self.document_type: str        = row.get("document_type") or "other"
        self.chunk_text:    str        = row.get("chunk_text") or ""
        self.page:          int | None = row.get("page")
        self.section:       str | None = row.get("section")
        self.similarity:    float      = float(row.get("similarity") or 0.0)

    def as_prompt_snippet(self) -> str:
        """
        Formats the chunk as a concise context block for injection into
        the Copilot system prompt.

        Format example:
          [Document: zoning_code.pdf | Section: § 190-18 | Page 4 | sim=0.84]
          Maximum building height shall not exceed 12 metres...
        """
        meta_parts = [f"Document: {self.file_name}"]
        if self.section:
            meta_parts.append(f"Section: {self.section}")
        if self.page is not None:
            meta_parts.append(f"Page {self.page}")
        meta_parts.append(f"sim={self.similarity:.2f}")
        header = " | ".join(meta_parts)
        return f"[{header}]\n{self.chunk_text}"

    def as_tool_result(self) -> dict[str, Any]:
        """
        Tool-friendly dict returned by the search_project_docs tool.
        """
        return {
            "chunk_id":     self.chunk_id,
            "document_id":  self.document_id,
            "file_name":    self.file_name,
            "document_type": self.document_type,
            "snippet":      self.chunk_text,
            "page":         self.page,
            "section":      self.section,
            "similarity":   round(self.similarity, 3),
        }


class CopilotRetriever:
    def __init__(self, repo: CopilotRepository) -> None:
        self._repo = repo
        # Lazy-init OpenAI client to avoid import cost at startup
        self._openai_client: Any | None = None

    # ── Public API ────────────────────────────────────────────

    async def retrieve(
        self,
        project_id: UUID,
        query: str,
        top_k: int | None = None,
    ) -> list[str]:
        """
        Return top-k document snippets as plain strings for prompt injection.

        Used by context_builder.py to inject grounding context.
        Returns an empty list when retrieval is unavailable.
        """
        chunks = await self.retrieve_chunks(
            project_id=project_id,
            query=query,
            top_k=top_k or settings.retrieval_top_k,
        )
        return [c.as_prompt_snippet() for c in chunks]

    async def retrieve_chunks(
        self,
        project_id: UUID,
        query: str,
        top_k: int | None = None,
        similarity_threshold: float | None = None,
    ) -> list[RetrievedChunk]:
        """
        Full retrieval: embed query → pgvector search → ranked chunks.

        Returns structured RetrievedChunk objects.
        Used by the search_project_docs Copilot tool for richer responses.

        Fallback chain:
          1. No OpenAI key → log info, return []
          2. Embedding API fails → log warning, return []
          3. pgvector RPC fails → log warning, return []
          4. No chunks matched → return []
        """
        k = top_k or settings.retrieval_top_k
        threshold = (
            similarity_threshold
            if similarity_threshold is not None
            else settings.retrieval_similarity_threshold
        )

        embedding = await self._embed_query(query)
        if embedding is None:
            return []

        raw_rows = await self._repo.search_document_chunks(
            project_id=project_id,
            query_embedding=embedding,
            top_k=k,
            similarity_threshold=threshold,
        )

        if not raw_rows:
            log.debug(
                "retrieve_chunks: no matches above threshold=%.2f "
                "for project=%s query=%r",
                threshold, project_id, query[:60],
            )
            return []

        chunks = [RetrievedChunk(r) for r in raw_rows]
        log.info(
            "retrieve_chunks: project=%s query=%r matched=%d "
            "top_sim=%.3f bottom_sim=%.3f",
            project_id,
            query[:60],
            len(chunks),
            chunks[0].similarity,
            chunks[-1].similarity,
        )
        return chunks

    # ── Embedding ─────────────────────────────────────────────

    async def _embed_query(self, query: str) -> list[float] | None:
        """
        Generate a query embedding using OpenAI text-embedding-3-small.

        Returns None (with a debug/warning log) on any failure so the
        retriever degrades gracefully instead of raising.
        """
        if not settings.openai_api_key:
            log.debug(
                "_embed_query: OPENAI_API_KEY not set — "
                "retrieval disabled"
            )
            return None

        try:
            client = self._get_openai_client()
            response = await client.embeddings.create(
                model=settings.embedding_model,
                input=query,
                dimensions=settings.embedding_dimensions,
            )
            embedding = response.data[0].embedding
            log.debug(
                "_embed_query: embedded %d chars → %d dims",
                len(query), len(embedding),
            )
            return embedding
        except Exception as exc:
            log.warning("_embed_query failed: %s", exc)
            return None

    def _get_openai_client(self) -> Any:
        """Lazy-init and cache the AsyncOpenAI client."""
        if self._openai_client is None:
            from openai import AsyncOpenAI  # noqa: PLC0415
            self._openai_client = AsyncOpenAI(
                api_key=settings.openai_api_key or ""
            )
        return self._openai_client
