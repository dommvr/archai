"""
backend/app/services/document_ingestion.py

DocumentIngestionService — text extraction, chunking, and chunk storage.

Pipeline per document:
  1. extract_text   → download from Supabase Storage, extract raw text
  2. chunk_document → split into overlapping chunks
  3. store_chunks   → persist to document_chunks table
  4. embed_chunks   → generate embeddings (TODO: requires OpenAI key + pgvector)

Mirrors: DocumentIngestionServiceContract in lib/precheck/services.ts
"""

from __future__ import annotations

import io
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from supabase import AsyncClient

from app.core.config import settings
from app.core.schemas import DocumentChunk, UploadedDocument
from app.repositories.precheck_repository import PrecheckRepository

log = logging.getLogger(__name__)

# V1 chunking parameters — tune when embedding pipeline is active
CHUNK_SIZE_CHARS   = 1_500   # ~375 tokens at ~4 chars/token
CHUNK_OVERLAP_CHARS = 200


class DocumentIngestionService:
    """
    Mirrors DocumentIngestionServiceContract from lib/precheck/services.ts.
    """

    def __init__(self, repo: PrecheckRepository, supabase: AsyncClient) -> None:
        self._repo = repo
        self._supabase = supabase

    # ── create_uploaded_document ──────────────────────────────

    async def create_uploaded_document(
        self,
        project_id: UUID,
        run_id: UUID | None,
        file_name: str,
        mime_type: str,
        document_type: str,
        storage_path: str,
        jurisdiction_code: str | None = None,
    ) -> UploadedDocument:
        """Records document metadata in uploaded_documents table."""
        row: dict[str, Any] = {
            "id":               str(uuid4()),
            "project_id":       str(project_id),
            "run_id":           str(run_id) if run_id else None,
            "storage_path":     storage_path,
            "file_name":        file_name,
            "mime_type":        mime_type,
            "document_type":    document_type,
            "jurisdiction_code": jurisdiction_code,
            "uploaded_at":      datetime.now(timezone.utc).isoformat(),
        }
        doc = await self._repo.create_uploaded_document(row)
        log.info("Recorded document: id=%s name=%r", doc.id, doc.file_name)
        return doc

    # ── extract_text ──────────────────────────────────────────

    async def extract_text(self, storage_path: str) -> str:
        """
        Downloads the document from Supabase Storage and extracts plain text.

        Supported formats:
          - PDF  → pypdf (V1 implementation)
          - TXT  → UTF-8 direct read
          - DOCX → TODO: requires python-docx

        TODO: For production accuracy, replace pypdf with a PDF processing
              pipeline (e.g. AWS Textract, Azure Document Intelligence, or
              Unstructured.io) — especially for scanned/image PDFs.
        """
        # Download bytes from Supabase Storage
        try:
            response = await self._supabase.storage.from_(
                settings.documents_storage_bucket
            ).download(storage_path)
            file_bytes: bytes = response
        except Exception:
            log.exception("Failed to download %r from storage", storage_path)
            raise

        # Detect format and extract
        if storage_path.lower().endswith(".pdf"):
            return _extract_pdf_text(file_bytes)
        elif storage_path.lower().endswith(".txt"):
            return file_bytes.decode("utf-8", errors="replace")
        else:
            # TODO: add DOCX support via python-docx
            log.warning("Unsupported format for %r — treating as UTF-8 text", storage_path)
            return file_bytes.decode("utf-8", errors="replace")

    # ── chunk_document ────────────────────────────────────────

    async def chunk_document(
        self,
        document_id: UUID,
        text: str,
    ) -> list[dict[str, Any]]:
        """
        Splits document text into overlapping chunks for embedding.

        V1: Character-based chunker with fixed overlap.
        TODO: Replace with token-aware chunking (tiktoken) once embeddings are active.
              Consider section-aware splitting using heading detection for zoning codes.
        """
        if not text.strip():
            return []

        chunks: list[dict[str, Any]] = []
        start = 0
        chunk_index = 0
        now = datetime.now(timezone.utc).isoformat()

        while start < len(text):
            end = min(start + CHUNK_SIZE_CHARS, len(text))
            chunk_text = text[start:end].strip()

            if chunk_text:
                chunks.append({
                    "id":           str(uuid4()),
                    "document_id":  str(document_id),
                    "chunk_index":  chunk_index,
                    "chunk_text":   chunk_text,
                    # page/section are None in V1 — populate with structure-aware parser later
                    "page":         None,
                    "section":      None,
                    "embedding_raw": None,   # populated by embed_chunks()
                    "metadata":     {"char_start": start, "char_end": end},
                    "created_at":   now,
                })
                chunk_index += 1

            # Slide forward with overlap
            start += CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS

        log.info("Chunked document %s into %d chunks", document_id, len(chunks))
        return chunks

    # ── store_chunks ──────────────────────────────────────────

    async def store_chunks(self, chunks: list[dict[str, Any]]) -> list[DocumentChunk]:
        """Bulk-inserts chunk rows into document_chunks."""
        if not chunks:
            return []
        stored = await self._repo.create_chunks_bulk(chunks)
        log.info("Stored %d chunks", len(stored))
        return stored

    # ── embed_chunks ──────────────────────────────────────────

    async def embed_chunks(self, chunks: list[DocumentChunk]) -> None:
        """
        Generates and stores vector embeddings for the given chunks.

        TODO: Implement when OpenAI key + pgvector migration are ready:
          1. Batch text through OpenAI text-embedding-3-small
          2. ALTER TABLE document_chunks ADD COLUMN embedding vector(1536)
          3. UPDATE document_chunks SET embedding = $1 WHERE id = $2
          4. Create HNSW index: CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)

        Once embeddings exist, the rule extraction service can use semantic
        similarity search to locate relevant clauses in large zoning codes.
        """
        # TODO: OpenAI + pgvector integration
        log.info("embed_chunks: TODO — %d chunks not yet embedded", len(chunks))

    # ── run the full pipeline ─────────────────────────────────

    async def process_document(self, doc: UploadedDocument) -> list[DocumentChunk]:
        """
        Convenience method: extract → chunk → store for a single document.
        embed_chunks is called separately since it is a network-heavy step.
        """
        text   = await self.extract_text(doc.storage_path)
        rows   = await self.chunk_document(doc.id, text)
        stored = await self.store_chunks(rows)
        return stored


# ── Helpers ───────────────────────────────────────────────────

def _extract_pdf_text(file_bytes: bytes) -> str:
    """
    V1 PDF text extractor using pypdf.

    Limitations:
      - Does not handle scanned PDFs (no OCR).
      - Column layout in complex zoning code PDFs may produce garbled text.
    TODO: Replace with a production PDF pipeline for complex documents.
    """
    try:
        import pypdf  # type: ignore[import-untyped]

        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        pages: list[str] = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            pages.append(page_text)
        return "\n\n".join(pages)
    except Exception:
        log.exception("pypdf text extraction failed")
        return ""
