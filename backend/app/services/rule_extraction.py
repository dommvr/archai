"""
backend/app/services/rule_extraction.py

RuleExtractionService — orchestrates document rule extraction.

Pipeline per run:
  1. Fetch documents (from run or explicit list)
  2. Delete existing draft rules (idempotency)
  3. For each document:
     a. Fetch chunks
     b. If OpenAI key is configured: call LLM per chunk (rule_extraction_llm)
     c. Else: fall back to V1 keyword regex extraction
  4. Detect and group conflicts across all extracted rules
  5. Apply auto-approval when project extraction options permit
  6. Bulk-store rules with full provenance

Architecture invariant:
  LLMs may locate and explain rules, but MUST NOT decide compliance.
  Pass/fail evaluation lives in compliance_engine.py.

LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from app.core.config import settings
from app.core.schemas import (
    Applicability,
    DocumentChunk,
    ExtractedRule,
    MetricKey,
    ProjectExtractionOptions,
    RuleCitation,
    RuleOperator,
    RuleSourceKind,
    RuleStatus,
    UploadedDocument,
)
from app.repositories.precheck_repository import PrecheckRepository
from app.services.rule_extraction_llm import (
    ChunkClassification,
    classify_chunk_heuristic,
    classify_chunk_llm,
    detect_conflicts,
    extract_rules_from_chunk_llm,
)

log = logging.getLogger(__name__)

# ── V1 fallback regex patterns ─────────────────────────────────────────────────
# Used when no OpenAI key is configured.

_METRIC_PATTERNS: list[tuple[MetricKey, list[str]]] = [
    (MetricKey.BUILDING_HEIGHT_M,    ["building height", "maximum height", "max height"]),
    (MetricKey.FRONT_SETBACK_M,      ["front setback", "front yard"]),
    (MetricKey.SIDE_SETBACK_LEFT_M,  ["side setback", "side yard", "interior side yard"]),
    (MetricKey.SIDE_SETBACK_RIGHT_M, ["side setback", "side yard"]),
    (MetricKey.REAR_SETBACK_M,       ["rear setback", "rear yard"]),
    (MetricKey.FAR,                  ["floor area ratio", "far", "f.a.r."]),
    (MetricKey.LOT_COVERAGE_PCT,     ["lot coverage", "maximum lot coverage"]),
    (MetricKey.PARKING_SPACES_REQUIRED, ["parking", "parking spaces required"]),
]

_VALUE_PATTERN = re.compile(
    r"(?:shall not exceed|maximum of?|no more than|"
    r"at least|minimum of?|not less than|limited to)"
    r"\s+([\d.]+)\s*([a-zA-Z%²]*)",
    re.IGNORECASE,
)


class RuleExtractionService:
    """
    Orchestrates rule extraction for precheck runs.
    Mirrors RuleExtractionServiceContract from lib/precheck/services.ts.
    """

    def __init__(self, repo: PrecheckRepository) -> None:
        self._repo = repo

    # ── extract_rules_from_chunks ─────────────────────────────

    async def extract_rules_from_chunks(
        self,
        run_id: UUID,
        document_ids: list[UUID] | None = None,
    ) -> list[ExtractedRule]:
        """
        Main extraction entry point called by the route handler.

        V1 strategy:
          - If OPENAI_API_KEY is set: LLM structured extraction (preferred)
          - Else: regex keyword fallback

        LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
        Replace the per-chunk loop with a LangGraph graph when multi-step
        agent reasoning is required.
        """
        # 1. Resolve documents
        if document_ids:
            docs = await self._repo.get_documents_by_ids(document_ids)
        else:
            docs = await self._repo.get_documents_for_run(run_id)

        if not docs:
            # Guard: no docs found means the run-document association was never persisted.
            # This is the most common cause of "No rules extracted" — the ingest-documents
            # step must stamp run_id on uploaded_documents rows before extraction runs.
            log.warning(
                "No documents associated with run=%s — extraction skipped. "
                "Ensure ingest_documents was called before extract_rules.",
                run_id,
            )
            return []

        # 2. Idempotency: delete stale draft rules
        doc_ids = [str(doc.id) for doc in docs]
        await self._repo.delete_draft_rules_for_documents(doc_ids)

        # 3. Determine extraction path
        use_llm = bool(settings.openai_api_key)
        log.info(
            "Rule extraction starting: run=%s, docs=%d, use_llm=%s",
            run_id, len(docs), use_llm,
        )

        # 4. Extract per document
        all_rules: list[ExtractedRule] = []
        for doc in docs:
            chunks = await self._repo.get_chunks_for_document(doc.id)
            if not chunks:
                log.warning(
                    "Doc=%s (%s) has no chunks — skipping. "
                    "Run ingest_documents first to populate document_chunks.",
                    doc.id, doc.file_name,
                )
                continue
            if use_llm:
                rules = await self._extract_llm(doc, chunks)
            else:
                rules = await self._extract_regex(doc, chunks)
            log.info("Extracted %d rules from doc=%s (%s)", len(rules), doc.id, doc.file_name)
            all_rules.extend(rules)

        if not all_rules:
            log.info(
                "No rules extracted for run=%s (%d docs examined, use_llm=%s)",
                run_id, len(docs), use_llm,
            )
            return []

        # 5. Conflict detection across all extracted rules
        all_rules = detect_conflicts(all_rules)

        # 6. Fetch project options for auto-approval
        # Resolve project_id from one of the docs (they all share the same project)
        project_id = docs[0].project_id if docs else None
        options: ProjectExtractionOptions | None = None
        if project_id:
            options = await self._repo.get_extraction_options(project_id)

        # 7. Apply auto-approval when configured
        if options and options.rule_auto_apply_enabled:
            threshold = options.rule_auto_apply_confidence_threshold
            for rule in all_rules:
                _maybe_auto_approve(rule, threshold)

        # 8. Bulk store
        rows = [_rule_to_row(r) for r in all_rules]
        stored = await self._repo.create_rules_bulk(rows)
        log.info(
            "Extracted and stored %d rules from %d documents for run=%s",
            len(stored), len(docs), run_id,
        )
        return stored

    # ── LLM path ─────────────────────────────────────────────

    async def _extract_llm(
        self,
        doc: UploadedDocument,
        chunks: list[DocumentChunk],
    ) -> list[ExtractedRule]:
        """
        Classify-then-extract pipeline.

        For each chunk:
          1. Run deterministic heuristic classifier (free).
          2. If uncertain, run LLM classifier (cheap model).
          3. Only send to structured extraction when label is in CHUNK_LABEL_RELEVANT.

        Emits a per-document classification summary at INFO level so
        the classification gate is inspectable without DB changes.
        """
        try:
            import openai  # type: ignore[import-untyped]
            client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
        except ImportError:
            log.warning(
                "openai package not installed — falling back to regex extraction"
            )
            return await self._extract_regex(doc, chunks)

        extraction_model    = settings.llm_model
        classification_model = settings.classification_model

        # ── Per-chunk counters for the diagnostics summary ────────────────────
        n_total         = len(chunks)
        n_heuristic_rel = 0
        n_heuristic_irr = 0
        n_llm_rel       = 0
        n_llm_irr       = 0
        n_extracted     = 0
        n_rules_found   = 0

        rules: list[ExtractedRule] = []

        for chunk in chunks:
            # ── Stage 1: heuristic prefilter ──────────────────────────────────
            classification: ChunkClassification | None = (
                await classify_chunk_heuristic(chunk)
            )

            if classification is not None:
                # Heuristic was confident.
                if classification.relevant:
                    n_heuristic_rel += 1
                else:
                    n_heuristic_irr += 1
                    log.debug(
                        "SKIP chunk=%s doc=%s label=%s source=heuristic reason=%r",
                        chunk.id, doc.id, classification.label, classification.reason,
                    )
                    continue  # skip extraction
            else:
                # ── Stage 2: LLM classifier for uncertain chunks ───────────────
                classification = await classify_chunk_llm(
                    chunk=chunk,
                    openai_client=client,
                    model=classification_model,
                )
                if classification.relevant:
                    n_llm_rel += 1
                else:
                    n_llm_irr += 1
                    log.debug(
                        "SKIP chunk=%s doc=%s label=%s source=llm reason=%r",
                        chunk.id, doc.id, classification.label, classification.reason,
                    )
                    continue  # skip extraction

            # ── Stage 3: structured extraction ───────────────────────────────
            n_extracted += 1
            log.debug(
                "EXTRACT chunk=%s doc=%s label=%s source=%s reason=%r",
                chunk.id, doc.id,
                classification.label, classification.source, classification.reason,
            )
            chunk_rules = await extract_rules_from_chunk_llm(
                doc=doc,
                chunk=chunk,
                openai_client=client,
                model=extraction_model,
            )
            n_rules_found += len(chunk_rules)
            rules.extend(chunk_rules)

        # ── Classification + extraction summary ───────────────────────────────
        n_skipped = n_heuristic_irr + n_llm_irr
        log.info(
            "Classification summary doc=%s (%s): "
            "total_chunks=%d  "
            "heuristic_relevant=%d  heuristic_skipped=%d  "
            "llm_relevant=%d  llm_skipped=%d  "
            "sent_to_extraction=%d  rules_found=%d  "
            "approx_extraction_calls_saved=%d",
            doc.id, doc.file_name,
            n_total,
            n_heuristic_rel, n_heuristic_irr,
            n_llm_rel, n_llm_irr,
            n_extracted, n_rules_found,
            n_skipped,
        )

        return rules

    # ── Regex fallback path ───────────────────────────────────

    async def _extract_regex(
        self,
        doc: UploadedDocument,
        chunks: list[DocumentChunk],
    ) -> list[ExtractedRule]:
        """
        V1 keyword/pattern-based extraction.
        Lower confidence than LLM; marks rules clearly as pattern-matched.
        Used when OPENAI_API_KEY is absent.
        """
        rules: list[ExtractedRule] = []
        now = datetime.now(timezone.utc)

        for chunk in chunks:
            text_lower = chunk.text.lower()

            for metric_key, keywords in _METRIC_PATTERNS:
                if not any(kw in text_lower for kw in keywords):
                    continue

                match = _VALUE_PATTERN.search(chunk.text)
                if not match:
                    continue

                raw_value = float(match.group(1))
                units = match.group(2).strip() or None
                operator = _infer_operator(chunk.text)

                rule = ExtractedRule(
                    id=uuid4(),
                    project_id=doc.project_id,
                    document_id=doc.id,
                    rule_code=f"{doc.file_name}:chunk-{chunk.chunk_index}",
                    title=_derive_title(metric_key, operator, raw_value, units),
                    description=chunk.text[:200],
                    metric_key=metric_key,
                    operator=operator,
                    value_number=(
                        raw_value if operator != RuleOperator.BETWEEN else None
                    ),
                    value_min=None,
                    value_max=None,
                    units=units,
                    applicability=Applicability(),
                    citation=RuleCitation(
                        document_id=doc.id,
                        chunk_id=chunk.id,
                        snippet=chunk.text[:300],
                        page=chunk.page,
                        section=chunk.section,
                    ),
                    # Regex confidence is intentionally lower than LLM
                    confidence=0.55,
                    status=RuleStatus.DRAFT,
                    source_kind=RuleSourceKind.EXTRACTED,
                    is_authoritative=False,
                    is_recommended=False,
                    source_chunk_id=chunk.id,
                    extraction_notes=(
                        "V1 keyword extraction — review before use. "
                        "Set OPENAI_API_KEY for higher-confidence LLM extraction."
                    ),
                    created_at=now,
                    updated_at=now,
                )
                rules.append(rule)
                break  # one rule per chunk per metric

        return rules

    # ── normalize_rule ────────────────────────────────────────

    async def normalize_rule(self, raw_rule: dict[str, Any]) -> ExtractedRule:
        """
        Validates and normalises a raw rule dict (e.g. from LLM output).
        Raises ValueError if the rule cannot be normalised.
        """
        now = datetime.now(timezone.utc)
        return ExtractedRule.model_validate(
            {**raw_rule, "created_at": now, "updated_at": now}
        )

    # ── store_rules ───────────────────────────────────────────

    async def store_rules(
        self, rules: list[ExtractedRule]
    ) -> list[ExtractedRule]:
        rows = [_rule_to_row(r) for r in rules]
        return await self._repo.create_rules_bulk(rows)

    # ── mark_rule_status ──────────────────────────────────────

    async def mark_rule_status(
        self, rule_id: UUID, status: RuleStatus
    ) -> ExtractedRule:
        """
        Updates a rule's lifecycle status.
        Also updates is_authoritative based on the new status:
          approved / auto_approved → is_authoritative = True
          rejected / superseded    → is_authoritative = False
          draft                    → is_authoritative = False
        """
        now = datetime.now(timezone.utc).isoformat()
        is_auth = status in {RuleStatus.APPROVED, RuleStatus.AUTO_APPROVED,
                              RuleStatus.REVIEWED}
        patch: dict[str, Any] = {
            "status": status.value,
            "is_authoritative": is_auth,
            "updated_at": now,
        }
        return await self._repo.update_rule(rule_id, patch)

    # ── _mark_project_stale ───────────────────────────────────

    async def _mark_project_stale(self, project_id: UUID) -> None:
        """
        Called after any rule approval-state change.  Sets is_stale=True on
        all evaluated runs in the project so the UI can surface a "rerun
        required" banner.  Best-effort: failures are logged, not raised.
        """
        try:
            now = datetime.now(timezone.utc).isoformat()
            await self._repo.mark_run_stale(project_id, now)
        except Exception:
            log.exception(
                "Failed to mark project=%s runs as stale after rule change", project_id
            )

    # ── approve_rule ──────────────────────────────────────────

    async def approve_rule(self, rule_id: UUID) -> ExtractedRule:
        """
        Marks a rule as approved (authoritative).
        If the rule is part of a conflict group, clears is_recommended
        on siblings so this rule becomes the sole recommended choice.
        Also marks all evaluated runs for the project as stale so the UI
        prompts the user to rerun compliance.
        """
        rule = await self._repo.get_rule_by_id(rule_id)
        if rule is None:
            raise ValueError(f"Rule {rule_id} not found")

        updated = await self.mark_rule_status(rule_id, RuleStatus.APPROVED)

        # When user approves one rule in a conflict group, update recommendations:
        # the approved rule becomes recommended; siblings remain visible but
        # are not auto-recommended (user resolved the conflict by approving).
        if rule.conflict_group_id:
            await self._repo.clear_conflict_group_recommendations(
                rule.conflict_group_id
            )
            await self._repo.update_rule(rule_id, {"is_recommended": True})

        await self._mark_project_stale(rule.project_id)
        return updated

    # ── unapprove_rule ────────────────────────────────────────

    async def unapprove_rule(self, rule_id: UUID) -> ExtractedRule:
        """
        Returns an approved/reviewed rule back to draft status (non-authoritative).

        This is the inverse of approve_rule.  The rule is NOT deleted — it
        remains visible in the rules panel in the "Draft / pending review"
        section where it can be re-approved or rejected.

        Manual rules (source_kind='manual') are always authoritative and
        cannot be unapproved; call delete instead if a manual rule is wrong.
        """
        rule = await self._repo.get_rule_by_id(rule_id)
        if rule is None:
            raise ValueError(f"Rule {rule_id} not found")
        if rule.source_kind == RuleSourceKind.MANUAL:
            raise ValueError(
                f"Rule {rule_id} is a manual rule — manual rules cannot be "
                "unapproved. Delete the rule if it should not be used."
            )
        updated = await self.mark_rule_status(rule_id, RuleStatus.DRAFT)
        await self._mark_project_stale(rule.project_id)
        return updated

    # ── reject_rule ───────────────────────────────────────────

    async def reject_rule(self, rule_id: UUID) -> ExtractedRule:
        """
        Marks a rule as rejected (non-authoritative, excluded from evaluation).
        Also marks evaluated runs for the project as stale.
        """
        rule = await self._repo.get_rule_by_id(rule_id)
        if rule is None:
            raise ValueError(f"Rule {rule_id} not found")
        updated = await self.mark_rule_status(rule_id, RuleStatus.REJECTED)
        await self._mark_project_stale(rule.project_id)
        return updated

    # ── create_manual_rule ────────────────────────────────────

    async def create_manual_rule(
        self,
        project_id: UUID,
        metric_key: MetricKey,
        operator: RuleOperator,
        title: str,
        value_number: float | None = None,
        value_min: float | None = None,
        value_max: float | None = None,
        units: str | None = None,
        condition_text: str | None = None,
        exception_text: str | None = None,
        citation_snippet: str | None = None,
        citation_section: str | None = None,
        citation_page: int | None = None,
        applicability: Applicability | None = None,
    ) -> ExtractedRule:
        """
        Creates a user-authored manual rule that is authoritative by default.
        Manual rules have no source document (document_id=None).
        """
        now = datetime.now(timezone.utc)
        rule_id = uuid4()
        rule_code = f"manual:{metric_key.value}:{rule_id}"

        citation: RuleCitation | None = None
        if citation_snippet:
            citation = RuleCitation(
                document_id=project_id,   # sentinel — no real document
                chunk_id=None,
                snippet=citation_snippet,
                page=citation_page,
                section=citation_section,
            )

        rule = ExtractedRule(
            id=rule_id,
            project_id=project_id,
            document_id=None,   # manual rules have no source document
            rule_code=rule_code,
            title=title,
            description=None,
            metric_key=metric_key,
            operator=operator,
            value_number=value_number,
            value_min=value_min,
            value_max=value_max,
            units=units,
            applicability=applicability or Applicability(),
            citation=citation,
            confidence=1.0,  # user-authored rules have full confidence
            status=RuleStatus.APPROVED,
            source_kind=RuleSourceKind.MANUAL,
            is_authoritative=True,   # manual rules are authoritative by creation
            is_recommended=False,
            conflict_group_id=None,
            condition_text=condition_text,
            exception_text=exception_text,
            normalization_note=None,
            effective_date=None,
            version_label=None,
            source_chunk_id=None,
            extraction_notes="Manually created by user",
            created_at=now,
            updated_at=now,
        )

        row = _rule_to_row(rule)
        stored = await self._repo.create_manual_rule(row)
        log.info("Created manual rule %s for project=%s", stored.id, project_id)
        return stored

    # ── update_manual_rule ────────────────────────────────────

    async def update_manual_rule(
        self,
        rule_id: UUID,
        updates: dict[str, Any],
    ) -> ExtractedRule:
        """
        Updates fields on an existing manual rule.
        Only manual rules may be edited this way — extracted rules are
        read-only (re-run extraction to update them).
        """
        rule = await self._repo.get_rule_by_id(rule_id)
        if rule is None:
            raise ValueError(f"Rule {rule_id} not found")
        if rule.source_kind != RuleSourceKind.MANUAL:
            raise ValueError(
                f"Rule {rule_id} is not a manual rule and cannot be edited"
            )

        now = datetime.now(timezone.utc).isoformat()
        patch = {k: v for k, v in updates.items() if v is not None}
        patch["updated_at"] = now
        return await self._repo.update_rule(rule_id, patch)


# ── Module-level helpers ───────────────────────────────────────────────────────

def _maybe_auto_approve(rule: ExtractedRule, threshold: float) -> None:
    """
    Mutates rule in place: auto-approves if confidence ≥ threshold.
    Only promotes DRAFT rules; does not override REJECTED or already-approved.
    """
    if rule.status != RuleStatus.DRAFT:
        return
    if rule.confidence >= threshold:
        rule.status = RuleStatus.AUTO_APPROVED
        rule.is_authoritative = True


def _infer_operator(text: str) -> RuleOperator:
    t = text.lower()
    if any(p in t for p in [
        "shall not exceed", "maximum", "no more than", "not to exceed"
    ]):
        return RuleOperator.LTE
    if any(p in t for p in [
        "at least", "minimum", "not less than", "no less than"
    ]):
        return RuleOperator.GTE
    return RuleOperator.LTE  # default: zoning limits are usually maxima


def _derive_title(
    key: MetricKey, op: RuleOperator, value: float, units: str | None
) -> str:
    unit_str = f" {units}" if units else ""
    op_str = "max" if op == RuleOperator.LTE else "min" if op == RuleOperator.GTE else ""
    label = key.value.replace("_", " ").title()
    return f"{label} ({op_str} {value}{unit_str})".strip()


def _rule_to_row(rule: ExtractedRule) -> dict[str, Any]:
    citation_dict: dict[str, Any] | None = None
    if rule.citation:
        citation_dict = {
            "documentId": str(rule.citation.document_id),
            "chunkId": str(rule.citation.chunk_id) if rule.citation.chunk_id else None,
            "snippet": rule.citation.snippet,
            "page": rule.citation.page,
            "section": rule.citation.section,
        }

    return {
        "id":                str(rule.id),
        "project_id":        str(rule.project_id),
        "document_id":       str(rule.document_id) if rule.document_id else None,
        "rule_code":         rule.rule_code,
        "title":             rule.title,
        "description":       rule.description,
        "metric_key":        rule.metric_key.value,
        "operator":          rule.operator.value,
        "value_number":      rule.value_number,
        "value_min":         rule.value_min,
        "value_max":         rule.value_max,
        "units":             rule.units,
        "applicability":     rule.applicability.model_dump(by_alias=True),
        "citation":          citation_dict,
        "confidence":        rule.confidence,
        "status":            rule.status.value,
        "extraction_notes":  rule.extraction_notes,
        # V2 fields
        "source_kind":       rule.source_kind.value,
        "is_authoritative":  rule.is_authoritative,
        "is_recommended":    rule.is_recommended,
        "conflict_group_id": str(rule.conflict_group_id) if rule.conflict_group_id else None,
        "condition_text":    rule.condition_text,
        "exception_text":    rule.exception_text,
        "normalization_note": rule.normalization_note,
        "effective_date":    rule.effective_date.date().isoformat() if rule.effective_date else None,
        "version_label":     rule.version_label,
        "source_chunk_id":   str(rule.source_chunk_id) if rule.source_chunk_id else None,
        "created_at":        rule.created_at.isoformat(),
        "updated_at":        rule.updated_at.isoformat(),
    }
