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
import re
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from supabase import AsyncClient

from app.core.config import settings
from app.core.schemas import DocumentChunk, UploadedDocument
from app.repositories.precheck_repository import PrecheckRepository

log = logging.getLogger(__name__)

# ── Chunking parameters ────────────────────────────────────────────────────────
# Target: roughly one legal section/subsection per chunk.
# ~250–500 tokens at 4 chars/token.
CHUNK_TARGET_CHARS = 1_200   # ideal chunk size
CHUNK_MAX_CHARS    = 2_500   # hard maximum before a forced sub-split
CHUNK_MIN_CHARS    = 80      # discard fragments smaller than this
CHUNK_OVERLAP_CHARS = 150    # overlap only when splitting within a large section

# Form-feed sentinel: injected between PDF pages during extraction so the
# chunker can track page numbers. Stripped from chunk text before storage.
_PAGE_BREAK = "\x0c"


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
        Section-aware chunker for legal/zoning documents.

        Split priority (highest to lowest):
          1. Legal section / subsection heading boundary
          2. Paragraph boundary (blank line)
          3. Sentence boundary (. / ! / ? followed by whitespace)
          4. Hard character cut (degenerate fallback only)

        Metadata stored per chunk:
          - page        : estimated page number (from _PAGE_BREAK sentinels)
          - section     : human-readable heading carried from last detected heading
          - metadata    : section_number, section_title, char_start, char_end,
                          split_strategy, page_start, page_end

        The text argument may contain _PAGE_BREAK (\\x0c) sentinels injected by
        _extract_pdf_text(). These are used to track page numbers and are stripped
        from the stored chunk text.
        """
        if not text.strip():
            return []

        segments = _split_into_sections(text)
        now = datetime.now(timezone.utc).isoformat()
        chunks: list[dict[str, Any]] = []
        chunk_index = 0

        section_with_counts: dict[str, int] = {}  # for diagnostics

        for seg in segments:
            seg_text = seg["text"]
            if not seg_text.strip():
                continue

            if len(seg_text) <= CHUNK_MAX_CHARS:
                # Section fits in one chunk — ideal case.
                clean_text = seg_text.strip()
                if len(clean_text) < CHUNK_MIN_CHARS:
                    continue
                chunks.append(_make_chunk(
                    document_id=document_id,
                    chunk_index=chunk_index,
                    text=clean_text,
                    page_start=seg["page_start"],
                    page_end=seg["page_end"],
                    section_number=seg.get("section_number"),
                    section_title=seg.get("section_title"),
                    split_strategy="section",
                    now=now,
                ))
                chunk_index += 1
                key = seg.get("section_title") or "unknown"
                section_with_counts[key] = section_with_counts.get(key, 0) + 1
            else:
                # Section is too large — sub-split by paragraph then sentence.
                sub_chunks = _sub_split(seg_text, seg)
                for sub in sub_chunks:
                    clean_text = sub["text"].strip()
                    if len(clean_text) < CHUNK_MIN_CHARS:
                        continue
                    chunks.append(_make_chunk(
                        document_id=document_id,
                        chunk_index=chunk_index,
                        text=clean_text,
                        page_start=sub["page_start"],
                        page_end=sub["page_end"],
                        section_number=seg.get("section_number"),
                        section_title=seg.get("section_title"),
                        split_strategy=sub["strategy"],
                        now=now,
                    ))
                    chunk_index += 1

        section_count = len([s for s in chunks if s.get("metadata", {}).get("split_strategy") == "section"])
        avg_len = int(sum(len(c["chunk_text"]) for c in chunks) / max(len(chunks), 1))
        log.info(
            "Chunked doc=%s: %d chunks, avg=%d chars, section-split=%d, targets=%d sections detected",
            document_id, len(chunks), avg_len, section_count, len(segments),
        )
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

    async def embed_chunks(self, chunks: list[DocumentChunk]) -> int:
        """
        Generates OpenAI embeddings for chunks and persists them to Supabase.

        Uses text-embedding-3-small (1536 dims) in batches of
        settings.embedding_batch_size to stay within API limits.

        Requires:
          - OPENAI_API_KEY set in .env
          - Migration 20240301000016 applied (embedding vector(1536) column)

        Returns the number of chunks successfully embedded.
        Degrades gracefully: if OpenAI is unavailable, logs a warning and
        returns 0. The rest of the ingestion pipeline is not affected.
        """
        if not settings.openai_api_key:
            log.info(
                "embed_chunks: OPENAI_API_KEY not set — skipping %d chunks",
                len(chunks),
            )
            return 0

        if not chunks:
            return 0

        try:
            from openai import AsyncOpenAI  # import here to avoid hard dep at startup
        except ImportError:
            log.warning("embed_chunks: openai package not installed — skipping")
            return 0

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        batch_size = settings.embedding_batch_size
        embedded_count = 0

        for batch_start in range(0, len(chunks), batch_size):
            batch = chunks[batch_start: batch_start + batch_size]
            texts = [c.text for c in batch]

            try:
                response = await client.embeddings.create(
                    model=settings.embedding_model,
                    input=texts,
                    dimensions=settings.embedding_dimensions,
                )
            except Exception as exc:
                log.error(
                    "embed_chunks: OpenAI batch %d–%d failed: %s",
                    batch_start, batch_start + len(batch), exc,
                )
                continue

            # Persist each embedding as a list-of-floats update
            updates = [
                {"id": str(chunk.id), "embedding": data.embedding}
                for chunk, data in zip(batch, response.data, strict=True)
            ]

            try:
                await self._repo.update_chunk_embeddings_bulk(updates)
                embedded_count += len(batch)
                log.debug(
                    "embed_chunks: embedded batch %d–%d (doc=%s)",
                    batch_start, batch_start + len(batch),
                    batch[0].document_id if batch else "?",
                )
            except Exception as exc:
                log.error(
                    "embed_chunks: failed to persist batch %d–%d: %s",
                    batch_start, batch_start + len(batch), exc,
                )

        log.info(
            "embed_chunks: %d/%d chunks embedded (model=%s dims=%d)",
            embedded_count, len(chunks),
            settings.embedding_model, settings.embedding_dimensions,
        )
        return embedded_count

    # ── re_embed_chunks ───────────────────────────────────────

    async def re_embed_chunks(
        self,
        chunks: list[DocumentChunk],
        *,
        force: bool = False,
        scope_label: str = "unknown",
    ) -> tuple[int, int, int]:
        """
        Regenerate embeddings for a pre-fetched list of DocumentChunk objects.

        Differences from embed_chunks():
          - embed_chunks() is called during normal ingestion and always
            overwrites because the chunks are brand-new rows.
          - re_embed_chunks() is called on EXISTING chunks during maintenance
            / targeted reprocessing.  When force=False it skips chunks that
            already have an embedding, making re-runs safe and idempotent.

        Parameters:
          chunks      — the target chunks (already fetched by the caller)
          force       — if True, re-embed every chunk even if embedding exists
          scope_label — human-readable label used only in log output
                        (e.g. "project=abc123" or "document=def456")

        Returns (embedded, skipped, failed) counts.

        Diagnostics logged at INFO level:
          - scope and total chunk count
          - batch size used
          - embedding model + dimensions
          - per-batch progress
          - final counts: embedded / skipped / failed
        """
        if not settings.openai_api_key:
            log.warning(
                "re_embed_chunks: OPENAI_API_KEY not set — "
                "cannot re-embed %d chunks for %s",
                len(chunks), scope_label,
            )
            return 0, 0, len(chunks)

        if not chunks:
            log.info("re_embed_chunks: no chunks to process for %s", scope_label)
            return 0, 0, 0

        try:
            from openai import AsyncOpenAI
        except ImportError:
            log.warning("re_embed_chunks: openai package not installed — skipping")
            return 0, 0, len(chunks)

        # Split into chunks-to-embed vs chunks-to-skip
        if force:
            targets = chunks
            skipped_count = 0
            log.info(
                "re_embed_chunks [%s]: force=True — re-embedding all %d chunks "
                "(model=%s dims=%d)",
                scope_label, len(chunks),
                settings.embedding_model, settings.embedding_dimensions,
            )
        else:
            targets = [c for c in chunks if c.embedding is None]
            skipped_count = len(chunks) - len(targets)
            log.info(
                "re_embed_chunks [%s]: %d chunks total, %d already embedded (skipping), "
                "%d to re-embed (model=%s dims=%d)",
                scope_label, len(chunks), skipped_count, len(targets),
                settings.embedding_model, settings.embedding_dimensions,
            )

        if not targets:
            log.info(
                "re_embed_chunks [%s]: nothing to do — all %d chunks already embedded",
                scope_label, len(chunks),
            )
            return 0, skipped_count, 0

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        batch_size = settings.embedding_batch_size
        embedded_count = 0
        failed_count = 0

        log.info(
            "re_embed_chunks [%s]: processing %d chunks in batches of %d",
            scope_label, len(targets), batch_size,
        )

        for batch_start in range(0, len(targets), batch_size):
            batch = targets[batch_start: batch_start + batch_size]
            texts = [c.text for c in batch]

            try:
                response = await client.embeddings.create(
                    model=settings.embedding_model,
                    input=texts,
                    dimensions=settings.embedding_dimensions,
                )
            except Exception as exc:
                log.error(
                    "re_embed_chunks [%s]: OpenAI batch %d–%d failed: %s",
                    scope_label, batch_start, batch_start + len(batch), exc,
                )
                failed_count += len(batch)
                continue

            updates = [
                {"id": str(chunk.id), "embedding": data.embedding}
                for chunk, data in zip(batch, response.data, strict=True)
            ]

            try:
                await self._repo.update_chunk_embeddings_bulk(updates)
                embedded_count += len(batch)
                log.info(
                    "re_embed_chunks [%s]: batch %d–%d embedded (%d/%d done)",
                    scope_label,
                    batch_start + 1, batch_start + len(batch),
                    embedded_count, len(targets),
                )
            except Exception as exc:
                log.error(
                    "re_embed_chunks [%s]: failed to persist batch %d–%d: %s",
                    scope_label, batch_start, batch_start + len(batch), exc,
                )
                failed_count += len(batch)

        log.info(
            "re_embed_chunks [%s]: COMPLETE — embedded=%d skipped=%d failed=%d "
            "(model=%s dims=%d)",
            scope_label, embedded_count, skipped_count, failed_count,
            settings.embedding_model, settings.embedding_dimensions,
        )
        return embedded_count, skipped_count, failed_count

    # ── delete_from_storage ───────────────────────────────────

    async def delete_from_storage(self, storage_path: str) -> None:
        """
        Removes a file from Supabase Storage.
        Best-effort — logs but does not raise on failure so that the DB delete proceeds.
        """
        try:
            await self._supabase.storage.from_(
                settings.documents_storage_bucket
            ).remove([storage_path])
            log.info("Deleted storage file: %r", storage_path)
        except Exception:
            log.warning("Storage delete failed for %r — skipping", storage_path, exc_info=True)

    # ── run the full pipeline ─────────────────────────────────

    async def process_document(self, doc: UploadedDocument) -> list[DocumentChunk]:
        """
        Full pipeline: extract → chunk → store → embed.

        embed_chunks() is called at the end so that newly stored chunks
        are immediately searchable via pgvector.  If OPENAI_API_KEY is not
        set, the embed step is a no-op and the pipeline still completes.
        """
        text    = await self.extract_text(doc.storage_path)
        rows    = await self.chunk_document(doc.id, text)
        stored  = await self.store_chunks(rows)
        if stored:
            await self.embed_chunks(stored)
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
        # Use form-feed sentinel so the chunker can track page numbers.
        return _PAGE_BREAK.join(pages)
    except Exception:
        log.exception("pypdf text extraction failed")
        return ""


# ── Section detection ──────────────────────────────────────────────────────────

# Patterns that match the *start* of a legal section heading.
# Order matters: more-specific patterns first.
_HEADING_RE = re.compile(
    r"""
    ^                                   # must be at the start of a line
    (?:
        (?:§\s*\d[\d\-\.]*\s)           # § 190-18, § 4.2.1
      | (?:Section\s+\d[\d\-\.]*\b)     # Section 4, Section 4.2
      | (?:SECTION\s+\d[\d\-\.]*\b)
      | (?:Article\s+[IVX\d]+\b)        # Article III, Article 5
      | (?:ARTICLE\s+[IVX\d]+\b)
      | (?:Division\s+\d[\d\-\.]*\b)    # Division 2
      | (?:DIVISION\s+\d[\d\-\.]*\b)
      | (?:Part\s+[IVX\d]+\b)           # Part I
      | (?:PART\s+[IVX\d]+\b)
      | (?:\d{1,3}\.\d{1,3}(?:\.\d{1,3})*\s)  # 4.2.1 (num-dotted at line start)
    )
    """,
    re.VERBOSE | re.MULTILINE,
)

# Captures the section/subsection number token at the beginning of a heading.
_SECTION_NUM_RE = re.compile(
    r"^(?:§\s*|Section\s+|SECTION\s+|Article\s+|ARTICLE\s+|"
    r"Division\s+|DIVISION\s+|Part\s+|PART\s+)?([\dIVX][\d\-\.IVX]*)",
    re.IGNORECASE,
)

# Sentence boundary: period/!/? followed by whitespace (or end-of-string),
# not preceded by a common abbreviation initial (Mr. Dr. etc.).
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _split_into_sections(text: str) -> list[dict]:
    """
    Splits *text* (which may contain _PAGE_BREAK sentinels) into segments, each
    corresponding to one legal section/subsection or a run of non-headed prose.

    Each returned segment dict has:
      page_start   : int  — 1-based page number where the segment begins
      page_end     : int  — 1-based page number where it ends
      section_number: str | None
      section_title : str | None  — full first line of the heading
      text         : str  — body text (may still contain _PAGE_BREAK sentinels;
                            these are stripped in chunk_document before storage)
    """
    lines = text.split("\n")
    segments: list[dict] = []

    current_lines: list[str] = []
    current_page_start = 1
    current_page_end   = 1
    current_page       = 1
    current_section_number: str | None = None
    current_section_title:  str | None = None

    def _flush() -> None:
        body = "\n".join(current_lines).strip()
        # Strip page-break sentinels from the stored text; page info is already captured.
        body = body.replace(_PAGE_BREAK, "\n")
        if body:
            segments.append({
                "text":           body,
                "page_start":     current_page_start,
                "page_end":       current_page_end,
                "section_number": current_section_number,
                "section_title":  current_section_title,
            })

    for line in lines:
        # Count page breaks inside the line (pypdf sometimes puts \x0c mid-line).
        page_breaks = line.count(_PAGE_BREAK)
        if page_breaks:
            current_page    += page_breaks
            current_page_end = current_page

        stripped = line.strip()
        if _HEADING_RE.match(stripped):
            # A new section heading — flush the previous segment first.
            _flush()
            # Extract the section number token.
            m = _SECTION_NUM_RE.match(stripped)
            current_section_number = m.group(1) if m else None
            current_section_title  = stripped[:120]  # cap heading length stored
            current_lines          = [line]
            current_page_start     = current_page
            current_page_end       = current_page
        else:
            current_lines.append(line)
            current_page_end = current_page

    _flush()
    return segments


# ── Sub-splitting oversized sections ──────────────────────────────────────────

def _sub_split(seg_text: str, seg: dict) -> list[dict]:
    """
    Splits a segment that exceeds CHUNK_MAX_CHARS into sub-chunks.

    Strategy (highest → lowest priority):
      1. Paragraph boundary (blank line / \\n\\n)
      2. Sentence boundary
      3. Hard character cut (last resort)

    A 150-char overlap is added between consecutive sub-chunks so that rule
    text split across a boundary can still be reconstructed by the LLM.
    """
    # 1. Split by paragraph.
    paragraphs = [p for p in re.split(r"\n{2,}", seg_text) if p.strip()]

    sub_chunks: list[dict] = []
    buf = ""
    buf_page_start = seg["page_start"]
    buf_page_end   = seg["page_end"]

    for para in paragraphs:
        # Count page advances inside this paragraph.
        para_pages = para.count(_PAGE_BREAK)

        if not buf:
            buf            = para
            buf_page_end   = buf_page_start + para_pages
        elif len(buf) + len(para) + 2 <= CHUNK_TARGET_CHARS:
            buf           += "\n\n" + para
            buf_page_end  += para_pages
        else:
            # buf is full — flush, then start a new buffer with overlap.
            if len(buf) <= CHUNK_MAX_CHARS:
                sub_chunks.append({
                    "text": buf, "page_start": buf_page_start,
                    "page_end": buf_page_end, "strategy": "paragraph",
                })
            else:
                # Single paragraph too large — sentence-split it.
                sub_chunks.extend(
                    _sentence_split(buf, buf_page_start, buf_page_end)
                )
            # Overlap: carry the tail of the previous buffer into the new one.
            overlap = buf[-CHUNK_OVERLAP_CHARS:] if len(buf) > CHUNK_OVERLAP_CHARS else ""
            buf            = (overlap + "\n\n" + para).strip() if overlap else para
            buf_page_start = buf_page_end
            buf_page_end  += para_pages

    if buf.strip():
        if len(buf) <= CHUNK_MAX_CHARS:
            sub_chunks.append({
                "text": buf, "page_start": buf_page_start,
                "page_end": buf_page_end, "strategy": "paragraph",
            })
        else:
            sub_chunks.extend(
                _sentence_split(buf, buf_page_start, buf_page_end)
            )

    return sub_chunks


def _sentence_split(text: str, page_start: int, page_end: int) -> list[dict]:
    """Splits *text* by sentence boundary, with overlap. Last-resort sub-splitter."""
    sentences = _SENTENCE_SPLIT_RE.split(text)
    results: list[dict] = []
    buf = ""

    for sent in sentences:
        if not buf:
            buf = sent
        elif len(buf) + len(sent) + 1 <= CHUNK_MAX_CHARS:
            buf += " " + sent
        else:
            if buf:
                results.append({"text": buf, "page_start": page_start,
                                 "page_end": page_end, "strategy": "sentence"})
            overlap = buf[-CHUNK_OVERLAP_CHARS:] if len(buf) > CHUNK_OVERLAP_CHARS else ""
            buf = (overlap + " " + sent).strip() if overlap else sent

    if buf.strip():
        # If still over max, hard-cut (degenerate fallback).
        while len(buf) > CHUNK_MAX_CHARS:
            results.append({"text": buf[:CHUNK_MAX_CHARS], "page_start": page_start,
                             "page_end": page_end, "strategy": "char_cut"})
            buf = buf[CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS:]
        if buf.strip():
            results.append({"text": buf, "page_start": page_start,
                             "page_end": page_end, "strategy": "sentence"})

    return results


# ── Chunk dict builder ─────────────────────────────────────────────────────────

def _make_chunk(
    *,
    document_id: UUID,
    chunk_index: int,
    text: str,
    page_start: int,
    page_end: int,
    section_number: str | None,
    section_title:  str | None,
    split_strategy: str,
    now: str,
) -> dict:
    """Builds the chunk row dict expected by create_chunks_bulk."""
    # Strip any residual page-break sentinels that slipped through.
    clean = text.replace(_PAGE_BREAK, "\n").strip()
    return {
        "id":           str(uuid4()),
        "document_id":  str(document_id),
        "chunk_index":  chunk_index,
        "chunk_text":   clean,
        "page":         page_start,
        "section":      section_title,
        "metadata": {
            "section_number": section_number,
            "section_title":  section_title,
            "char_start":     None,   # not tracked at this stage
            "char_end":       None,
            "split_strategy": split_strategy,
            "page_start":     page_start,
            "page_end":       page_end,
        },
        "created_at":   now,
    }
