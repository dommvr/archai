"""
backend/app/services/rule_extraction.py

RuleExtractionService — extracts structured compliance rules from document chunks.

V1 approach: Keyword/pattern-based extraction as a scaffold.
             The LLM path (LangGraph) is the real implementation — see TODO.

Architecture principle:
  LLMs may assist in locating and explaining rules,
  but MUST NOT decide compliance outcomes.
  Rule evaluation is always deterministic (see compliance_engine.py).

Mirrors: RuleExtractionServiceContract in lib/precheck/services.ts
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
    RuleCitation,
    RuleOperator,
    RuleStatus,
    UploadedDocument,
)
from app.repositories.precheck_repository import PrecheckRepository

log = logging.getLogger(__name__)

# ── V1 rule patterns ──────────────────────────────────────────
# Regex patterns that recognise common zoning code clause formats.
# These are intentionally conservative: false negatives are safer than
# false positives for compliance checks.
# TODO: Replace with LangGraph agent that uses structured output extraction.

_METRIC_PATTERNS: list[tuple[MetricKey, list[str]]] = [
    (MetricKey.BUILDING_HEIGHT_M,    ["building height", "maximum height", "max height"]),
    (MetricKey.FRONT_SETBACK_M,      ["front setback", "front yard", "front yard setback"]),
    (MetricKey.SIDE_SETBACK_LEFT_M,  ["side setback", "side yard", "interior side yard"]),
    (MetricKey.SIDE_SETBACK_RIGHT_M, ["side setback", "side yard"]),
    (MetricKey.REAR_SETBACK_M,       ["rear setback", "rear yard"]),
    (MetricKey.FAR,                  ["floor area ratio", "far", "f.a.r."]),
    (MetricKey.LOT_COVERAGE_PCT,     ["lot coverage", "maximum lot coverage"]),
    (MetricKey.PARKING_SPACES_REQUIRED, ["parking", "off-street parking", "parking spaces required"]),
]

# Matches patterns like: "shall not exceed 15 m", "maximum of 0.5", "at least 3 spaces"
_VALUE_PATTERN = re.compile(
    r"(?:shall not exceed|maximum of?|no more than|at least|minimum of?|not less than|limited to)"
    r"\s+([\d.]+)\s*([a-zA-Z%²]*)",
    re.IGNORECASE,
)


class RuleExtractionService:
    """
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
        Main extraction entry point.

        V1: Uses keyword pattern matching.
        TODO: Replace inner loop with a LangGraph structured extraction agent:
          1. Batch chunks through an LLM with a structured JSON output schema.
          2. LLM returns: {metric_key, operator, value_number, value_min, value_max,
                           units, rule_code, title, snippet, confidence}
          3. Each LLM output is validated with Pydantic before storage.
          4. Confidence < settings.rule_extraction_confidence_threshold → skip or flag.
          5. Always use reviewed=False (draft) until human confirms.

        LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
        """
        # Fetch chunks for this run (or specific documents)
        if document_ids:
            docs = await self._repo.get_documents_by_ids(document_ids)
        else:
            docs = await self._repo.get_documents_for_run(run_id)

        all_rules: list[ExtractedRule] = []

        for doc in docs:
            chunks = await self._repo.get_chunks_for_document(doc.id)
            rules  = await self._extract_from_document(doc, chunks)
            all_rules.extend(rules)

        if all_rules:
            rows = [_rule_to_row(r) for r in all_rules]
            stored = await self._repo.create_rules_bulk(rows)
            log.info("Extracted and stored %d rules from %d documents", len(stored), len(docs))
            return stored

        log.info("No rules extracted for run=%s", run_id)
        return []

    async def _extract_from_document(
        self,
        doc: UploadedDocument,
        chunks: list[DocumentChunk],
    ) -> list[ExtractedRule]:
        """
        Runs V1 pattern-based extraction over all chunks of a document.
        Returns un-persisted ExtractedRule objects.
        """
        rules: list[ExtractedRule] = []
        now = datetime.now(timezone.utc)

        for chunk in chunks:
            text_lower = chunk.text.lower()

            for metric_key, keywords in _METRIC_PATTERNS:
                if not any(kw in text_lower for kw in keywords):
                    continue

                # Try to find a numeric threshold
                match = _VALUE_PATTERN.search(chunk.text)
                if not match:
                    continue

                raw_value = float(match.group(1))
                units     = match.group(2).strip() or None

                # Infer operator from surrounding language
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
                    value_number=raw_value if operator != RuleOperator.BETWEEN else None,
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
                    # V1 pattern-match confidence is lower than LLM extraction
                    confidence=0.55,
                    status=RuleStatus.DRAFT,
                    extraction_notes="V1 keyword extraction — review before use",
                    created_at=now,
                    updated_at=now,
                )
                rules.append(rule)
                # Only emit one rule per chunk per metric to avoid duplicates
                break

        return rules

    # ── normalize_rule ────────────────────────────────────────

    async def normalize_rule(self, raw_rule: dict[str, Any]) -> ExtractedRule:
        """
        Validates and normalises a raw rule dict (e.g. from LLM output).
        Raises ValueError if the rule cannot be normalised.

        TODO: Wire LangGraph agent output through this normaliser.
        """
        now = datetime.now(timezone.utc)
        return ExtractedRule.model_validate({**raw_rule, "created_at": now, "updated_at": now})

    # ── store_rules ───────────────────────────────────────────

    async def store_rules(self, rules: list[ExtractedRule]) -> list[ExtractedRule]:
        rows = [_rule_to_row(r) for r in rules]
        return await self._repo.create_rules_bulk(rows)

    # ── mark_rule_status ──────────────────────────────────────

    async def mark_rule_status(self, rule_id: UUID, status: RuleStatus) -> ExtractedRule:
        """
        Updates a rule's lifecycle status.
        Human reviewers use this to mark rules as reviewed or rejected before evaluation.
        """
        return await self._repo.update_rule_status(rule_id, status)


# ── Helpers ───────────────────────────────────────────────────

def _infer_operator(text: str) -> RuleOperator:
    t = text.lower()
    if any(p in t for p in ["shall not exceed", "maximum", "no more than", "not to exceed"]):
        return RuleOperator.LTE
    if any(p in t for p in ["at least", "minimum", "not less than", "no less than"]):
        return RuleOperator.GTE
    return RuleOperator.LTE  # default assumption for zoning constraints


def _derive_title(key: MetricKey, op: RuleOperator, value: float, units: str | None) -> str:
    unit_str = f" {units}" if units else ""
    op_str   = "max" if op == RuleOperator.LTE else "min" if op == RuleOperator.GTE else ""
    label    = key.value.replace("_", " ").title()
    return f"{label} ({op_str} {value}{unit_str})".strip()


def _rule_to_row(rule: ExtractedRule) -> dict[str, Any]:
    return {
        "id":               str(rule.id),
        "project_id":       str(rule.project_id),
        "document_id":      str(rule.document_id),
        "rule_code":        rule.rule_code,
        "title":            rule.title,
        "description":      rule.description,
        "metric_key":       rule.metric_key.value,
        "operator":         rule.operator.value,
        "value_number":     rule.value_number,
        "value_min":        rule.value_min,
        "value_max":        rule.value_max,
        "units":            rule.units,
        "applicability":    rule.applicability.model_dump(),
        "citation":         rule.citation.model_dump(),
        "confidence":       rule.confidence,
        "status":           rule.status.value,
        "extraction_notes": rule.extraction_notes,
        "created_at":       rule.created_at.isoformat(),
        "updated_at":       rule.updated_at.isoformat(),
    }
