"""
backend/app/services/rule_extraction_llm.py

OpenAI-backed structured rule extraction for Tool 1.

Responsibilities:
  1. Classify chunks into relevant / irrelevant categories
  2. Run structured JSON extraction on relevant chunks
  3. Map extracted output to ExtractedRule objects
  4. Normalise units to SI (metres / m²) when the source uses imperial
  5. Detect and group likely conflicts across rules in the same call

This module is called by RuleExtractionService in rule_extraction.py.
It is kept separate so the LLM path is isolated from the service
orchestration and easy to test or replace.

Architecture invariant:
  LLMs assist extraction and explanation ONLY.
  Pass/fail compliance decisions remain in compliance_engine.py.

LANGGRAPH AGENT ENTRYPOINT PLACEHOLDER
  Replace the single-call approach here with a LangGraph graph when
  multi-step agent reasoning (e.g. disambiguation, cross-document
  consolidation) is needed. The interface stays the same.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from app.core.schemas import (
    Applicability,
    DocumentChunk,
    ExtractedRule,
    MetricKey,
    RuleCitation,
    RuleOperator,
    RuleSourceKind,
    RuleStatus,
    UploadedDocument,
)

log = logging.getLogger(__name__)

# ── Document unit → SI conversion factors ─────────────────────────────────────
# Applied when a document states a value in imperial units.

_FT_TO_M: float = 0.3048
_FT2_TO_M2: float = _FT_TO_M ** 2

_DOC_UNIT_CONVERSION: dict[str, tuple[float, str]] = {
    # length: factor, canonical SI unit
    "ft":    (_FT_TO_M,   "m"),
    "feet":  (_FT_TO_M,   "m"),
    "foot":  (_FT_TO_M,   "m"),
    "in":    (0.0254,     "m"),
    "inch":  (0.0254,     "m"),
    "inches": (0.0254,    "m"),
    # area
    "ft2":   (_FT2_TO_M2, "m²"),
    "sf":    (_FT2_TO_M2, "m²"),
    "sqft":  (_FT2_TO_M2, "m²"),
}

# ── Supported metric categories for V1 extraction ─────────────────────────────

# Maps natural-language category names (used in the LLM prompt) to MetricKey.
# The LLM is instructed to use exactly these category strings.
_CATEGORY_TO_METRIC: dict[str, MetricKey] = {
    "max_height":       MetricKey.BUILDING_HEIGHT_M,
    "front_setback":    MetricKey.FRONT_SETBACK_M,
    "side_setback_left":  MetricKey.SIDE_SETBACK_LEFT_M,
    "side_setback_right": MetricKey.SIDE_SETBACK_RIGHT_M,
    "rear_setback":     MetricKey.REAR_SETBACK_M,
    "far":              MetricKey.FAR,
    "lot_coverage":     MetricKey.LOT_COVERAGE_PCT,
    "parking":          MetricKey.PARKING_SPACES_REQUIRED,
}

# ── Operator token → RuleOperator ─────────────────────────────────────────────

_OP_MAP: dict[str, RuleOperator] = {
    "<=": RuleOperator.LTE,
    ">=": RuleOperator.GTE,
    "<":  RuleOperator.LT,
    ">":  RuleOperator.GT,
    "=":  RuleOperator.EQ,
    "between": RuleOperator.BETWEEN,
}


# ── Extraction system prompt ───────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a specialist zoning and building code analyst. Your job is to extract \
structured compliance rules from zoning code text.

Extract ONLY these rule categories (use these exact keys):
  max_height        — maximum building height
  front_setback     — minimum front yard / setback
  side_setback_left — minimum interior/left side yard
  side_setback_right — minimum exterior/right side yard
  rear_setback      — minimum rear yard / setback
  far               — maximum Floor Area Ratio (FAR)
  lot_coverage      — maximum lot coverage percentage
  parking           — minimum required parking spaces or ratio

For each rule found, return a JSON object with these fields:
  category      : one of the keys above (string, required)
  operator      : one of <=, >=, <, >, =, between (string, required)
  value         : primary numeric threshold (number, required unless operator=between)
  value_min     : lower bound for between rules (number, optional)
  value_max     : upper bound for between rules (number, optional)
  units         : unit string exactly as it appears in the text (string, optional)
  rule_code     : section/article reference if visible, e.g. "§ 3.4(a)" (string, optional)
  title         : a short descriptive title for this rule (string, required)
  condition     : any "if" / "when" / "except" qualifier from the same clause (string, optional)
  exception     : any explicit exception or waiver language (string, optional)
  snippet       : the exact quoted text this rule was derived from, max 400 chars (string, required)
  confidence    : your confidence 0.0–1.0 that this is a real enforceable rule (number, required)
  effective_date: YYYY-MM-DD if a document date or adoption date is visible (string, optional)
  version_label : version string if visible, e.g. "v2.1" (string, optional)
  zoning_districts: list of zoning district codes this rule applies to, [] if universal (array)
  building_types: list of building type labels this applies to, [] if universal (array)
  occupancies   : list of occupancy classifications, [] if universal (array)

Return ONLY a JSON object with a single key "rules" whose value is an array of \
rule objects. If no relevant rules are found in the text, return {"rules": []}. \
Do not return a bare array — always wrap in {"rules": [...]}.

Important rules:
- Do NOT invent values not present in the text.
- A 'permitted use' clause that is purely textual (no numeric threshold) should \
  NOT be included — V1 only supports numeric/measurable rules.
- Set confidence < 0.6 for any clause that is ambiguous, conditional, or \
  references an external table you cannot see.
- If the same numeric value appears multiple times for the same category, emit \
  ONE rule with the most specific version (narrowest applicability).
"""


# ── Chunk classification ───────────────────────────────────────────────────────
#
# Goal: gate the expensive structured-extraction call so only chunks that are
# plausibly rule-bearing reach the LLM.
#
# Two-stage approach:
#   1. Deterministic heuristic prefilter — zero cost, runs first.
#      Confident RELEVANT → skip LLM classifier (go straight to extraction).
#      Confident IRRELEVANT → skip both classifier and extraction.
#      Uncertain → escalate to LLM classifier.
#
#   2. LLM classifier (cheap model, simple boolean prompt) — runs only for
#      chunks the heuristic could not confidently classify.
#
# Extraction runs only for labels:
#   dimensional_standards, use_or_occupancy, permit_or_procedure
# Extraction is skipped for:
#   definitions_or_context, irrelevant

CHUNK_LABEL_RELEVANT = frozenset({
    "dimensional_standards",
    "use_or_occupancy",
    "permit_or_procedure",
})

CHUNK_LABEL_SKIP = frozenset({
    "definitions_or_context",
    "irrelevant",
})

# ── Heuristic keyword sets ─────────────────────────────────────────────────────
#
# The classifier uses an AND gate: a chunk is heuristic-relevant only when
# it has BOTH a topic signal AND an operative-rule signal, OR when it contains
# an obvious numeric zoning standard pattern.
#
# This avoids false positives from broad words like "height", "yard", "parking",
# "approval" that appear incidentally in narrative, history, and admin text.

# ── Signal A: topic keywords ───────────────────────────────────────────────────
# Unambiguous multi-word phrases preferred; single words only when specific.
_TOPIC_DIMENSIONAL: frozenset[str] = frozenset({
    # Height — specific forms only
    "building height", "maximum height", "max height", "height limit",
    "stories", "story limit",
    # Setbacks / yards — combined/specific forms only
    "front setback", "rear setback", "side setback",
    "front yard", "rear yard", "side yard", "interior side yard",
    "exterior side yard", "minimum yard", "required yard",
    "setback requirement", "setback line",
    # Lot
    "lot area", "lot coverage", "lot width", "lot depth",
    "minimum lot", "maximum lot",
    # FAR / density
    "floor area ratio", "f.a.r", " far ", "gross floor area",
    "density", "dwelling units per acre", "units per acre",
    # Buffer — specific enough to signal a dimensional standard
    "buffer zone", "buffer area", "buffer strip",
    # Open space — combined form only
    "open space requirement", "required open space",
    # NOTE: "bulk table", "schedule of district", "dimensional table",
    # "district regulations" removed — appear in TOC/header lines with no rule content
})

_TOPIC_PARKING: frozenset[str] = frozenset({
    "parking space", "parking spaces", "parking ratio",
    "parking requirement", "minimum parking", "required parking",
    "off-street parking", "off street parking",
    "bicycle parking", "loading space", "loading berth",
    "parking per dwelling", "parking per unit",
})

_TOPIC_USE: frozenset[str] = frozenset({
    "permitted use", "permitted uses", "principal use", "accessory use",
    "prohibited use", "special use", "conditional use",
    "use group", "occupancy classification", "use classification",
    "use table", "permitted uses table", "schedule of uses",
    # NOTE: "certificate of occupancy" kept only in _TOPIC_PERMIT below
    # NOTE: "change of use" removed — procedural, not a V1 measurable rule
})

_TOPIC_PERMIT: frozenset[str] = frozenset({
    # Only permit topics that can embed a V1 rule (e.g. "special permit shall
    # require minimum lot area of X"). Pure procedural terms removed.
    "building permit", "special permit",
    "certificate of occupancy",
    "submission requirement", "permit requirement",
    # NOTE: "site plan approval", "site plan review" removed — procedural only,
    #       never yield dimensional/parking/use rules
    # NOTE: "variance", "area variance", "use variance" removed — appeals
    #       procedure, not a measurable standard
    # NOTE: "zoning board of appeals", "board of zoning appeals" removed — admin
    # NOTE: "certificate of compliance" removed — issuance procedure only
})

# Union of all topic sets — used for quick has_topic check.
_ALL_TOPIC_KWS: frozenset[str] = (
    _TOPIC_DIMENSIONAL | _TOPIC_PARKING | _TOPIC_USE | _TOPIC_PERMIT
)

# ── Signal B: operative-rule signals ──────────────────────────────────────────
# These indicate the chunk actually states a standard or requirement,
# not just mentions a topic in passing.
_OPERATIVE_KWS: frozenset[str] = frozenset({
    "minimum", "maximum", "shall not exceed", "shall not be less than",
    "at least", "no more than", "not less than", "not to exceed",
    "no less than", "maximum of", "minimum of",
    "shall be required", "is required", "are required",
    "shall", "must", "required", "prohibited",
    "permitted only", "subject to", "limited to",
    "per dwelling unit", "per unit", "per acre", "per bedroom",
    "per guest room", "per seat", "per employee",
    "for each dwelling", "for each unit", "for each guest room",
    "for each bedroom", "for each seat", "for each employee",
    "ratio of", "at a ratio",
    # "provide" + context = operative requirement in use/parking clauses
    "shall provide", "must provide", "is required to provide",
})

# ── Numeric zoning standard patterns ──────────────────────────────────────────
# Regex matching explicit numeric standards; these alone are enough to flag
# a chunk as relevant when combined with any topic keyword.
_NUMERIC_STANDARD_RE = re.compile(
    r"""
    \d+(?:\.\d+)?               # number (integer or decimal)
    \s*                         # optional space
    (?:
        feet|foot|ft            # length imperial
      | meters?|m\b             # length SI
      | acres?                  # area imperial
      | sq\.?\s*ft|square\s+feet  # area imperial
      | stories|story           # building height
      | percent|%               # coverage / FAR
      | dwelling\s+units?       # density
      | parking\s+spaces?       # parking
    )
    """,
    re.VERBOSE | re.IGNORECASE,
)

# ── Definite-skip section headings ────────────────────────────────────────────
# Chunk is irrelevant if section title matches AND body has no topic+operative.
_IRRELEVANT_SECTION_KEYWORDS: frozenset[str] = frozenset({
    "table of contents",
    "index",
    "amendment history",
    "revision history",
    "amendments",
    "preface",
    "foreword",
    "introduction",
    "acknowledgement",
    "acknowledgment",
    "effective date",
    "adoption date",
    "enactment",
    "in witness whereof",
    "signature page",
    "certificate of adoption",
    "legislative history",
    "editor",          # editor's notes
    "map",             # zoning map pages
    "general purpose",
    "environmental review",
    "seqr",           # state environmental quality review
    "environmental impact",
})

# ── Definite-skip body content markers ────────────────────────────────────────
# Applied to chunk body text regardless of section title.
_SKIP_BODY_MARKERS: frozenset[str] = frozenset({
    "table of contents",
    "this chapter shall be known",
    "short title",
    "in witness whereof",
    "mayor of the city",
    "enacted by the",
    "be it enacted",
    "be it resolved",
    "whereas,",              # recital preamble
    "now, therefore,",       # recital preamble
    "legislative findings",
    "editor's note",
    "cross reference",
    "see also §",            # pure cross-reference lines
})

# ── Classification result ──────────────────────────────────────────────────────

@dataclass
class ChunkClassification:
    label: str          # one of: dimensional_standards | use_or_occupancy |
                        #         permit_or_procedure | definitions_or_context | irrelevant
    relevant: bool      # True → send to extraction
    source: str         # "heuristic" | "llm"
    reason: str         # short human-readable explanation, for logging / audit


# ── LLM classification prompt ──────────────────────────────────────────────────

_CLASSIFY_SYSTEM_PROMPT = """\
You are a zoning-code analyst. Classify the following chunk of text from a \
zoning or building code document into exactly ONE of these categories:

  dimensional_standards  — contains numeric limits for height, setbacks, FAR,
                           lot coverage, parking ratios, or other measurable
                           dimensional / bulk requirements
  use_or_occupancy       — describes permitted, conditional, or prohibited uses;
                           occupancy classifications; or use-group rules
  permit_or_procedure    — describes permit types, application requirements,
                           submission checklists, approval procedures, or
                           enforcement actions
  definitions_or_context — definitions section, purpose statement, legislative
                           findings, general interpretation rules, or preamble
  irrelevant             — table of contents, signature pages, amendment history,
                           boilerplate, or content with no operative rule language

Return ONLY a JSON object with these exact fields and no other text:
  {
    "label":  "<one of the five categories above>",
    "reason": "<one sentence explaining why>"
  }
"""


async def classify_chunk_heuristic(chunk: "DocumentChunk") -> ChunkClassification | None:
    """
    Fast deterministic prefilter using a two-signal AND gate.

    A chunk is heuristic-relevant when it has:
      (A) a specific zoning topic keyword  AND
      (B) an operative-rule signal (minimum/maximum/shall/required/etc.)
    OR
      a numeric zoning standard pattern (35 feet, 10 acres, 40%, etc.)
      combined with any topic keyword.

    Returns a ChunkClassification when confident, or None when uncertain
    (caller escalates to LLM). Bias remains toward recall: uncertain chunks
    go to LLM rather than being silently dropped.
    """
    text_lower   = chunk.text.lower()
    section_lower = (chunk.section or "").lower()

    # ── 1. Definite-skip: body contains admin boilerplate ────────────────────
    for marker in _SKIP_BODY_MARKERS:
        if marker in text_lower:
            return ChunkClassification(
                label="irrelevant",
                relevant=False,
                source="heuristic",
                reason=f"admin_context_skip: body marker '{marker}'",
            )

    # ── 2. Definite-skip: section title is an irrelevant admin section ────────
    # Only fires when the body also lacks topic+operative (checked below).
    matched_irr_section = next(
        (kw for kw in _IRRELEVANT_SECTION_KEYWORDS if kw in section_lower), None
    )

    # ── 3. Definition-only body ───────────────────────────────────────────────
    definition_markers = {
        "means ", "means:", "is defined as", "shall mean", "defined as",
        "shall be construed", "for the purposes of this",
        "the term ", "as used in this",
    }
    is_definitions = any(m in text_lower for m in definition_markers)

    # ── 4. Topic signal (Signal A) ────────────────────────────────────────────
    topic_dim    = next((kw for kw in _TOPIC_DIMENSIONAL if kw in text_lower), None)
    topic_use    = next((kw for kw in _TOPIC_USE         if kw in text_lower), None)
    topic_permit = next((kw for kw in _TOPIC_PERMIT      if kw in text_lower), None)
    topic_park   = next((kw for kw in _TOPIC_PARKING     if kw in text_lower), None)
    has_topic    = bool(topic_dim or topic_use or topic_permit or topic_park)

    # ── 5. Operative signal (Signal B) ────────────────────────────────────────
    operative = next((kw for kw in _OPERATIVE_KWS if kw in text_lower), None)

    # ── 6. Numeric standard pattern ───────────────────────────────────────────
    numeric_match = _NUMERIC_STANDARD_RE.search(chunk.text)

    # ── Decision logic ────────────────────────────────────────────────────────

    # 6a. Definite skip: irrelevant section with no topic+operative override.
    if matched_irr_section and not (has_topic and operative):
        return ChunkClassification(
            label="irrelevant",
            relevant=False,
            source="heuristic",
            reason=f"admin_context_skip: section '{matched_irr_section}' with no operative rule signals",
        )

    # 6b. Definite skip: definitions-only with no numeric standard.
    if is_definitions and not (has_topic and (operative or numeric_match)):
        return ChunkClassification(
            label="definitions_or_context",
            relevant=False,
            source="heuristic",
            reason="definitions_only_skip: definition markers present with no operative rule signal",
        )

    # 6c. Strong positive: topic + operative — label by best topic category.
    if has_topic and operative:
        if topic_dim:
            label  = "dimensional_standards"
            signal = topic_dim
        elif topic_park:
            label  = "dimensional_standards"
            signal = topic_park
        elif topic_use:
            label  = "use_or_occupancy"
            signal = topic_use
        else:
            label  = "permit_or_procedure"
            signal = topic_permit
        return ChunkClassification(
            label=label,
            relevant=True,
            source="heuristic",
            reason=f"topic+operative: topic='{signal}' operative='{operative}'",
        )

    # 6d. Strong positive: numeric zoning standard + topic.
    if numeric_match and has_topic:
        if topic_dim or topic_park:
            label = "dimensional_standards"
        elif topic_use:
            label = "use_or_occupancy"
        else:
            label = "permit_or_procedure"
        return ChunkClassification(
            label=label,
            relevant=True,
            source="heuristic",
            reason=f"numeric_standard: '{numeric_match.group(0).strip()}' + topic='{topic_dim or topic_park or topic_use or topic_permit}'",
        )

    # 6e. Has topic but no operative and no numeric.
    if has_topic:
        # Use/permit topics that are themselves operative (a permitted-uses table
        # or special-permit requirement clause is inherently a rule statement).
        if topic_use and any(
            topic_use.startswith(p)
            for p in ("permitted use", "prohibited use", "conditional use",
                      "special use", "accessory use", "principal use")
        ):
            return ChunkClassification(
                label="use_or_occupancy",
                relevant=True,
                source="heuristic",
                reason=f"topic+operative: use topic '{topic_use}' is self-operative",
            )
        if topic_permit and any(
            topic_permit.startswith(p)
            for p in ("special permit", "building permit", "certificate of")
        ):
            return ChunkClassification(
                label="permit_or_procedure",
                relevant=True,
                source="heuristic",
                reason=f"topic+operative: permit topic '{topic_permit}' is self-operative",
            )
        # For other topics without operative, escalate permit/use to LLM;
        # dimensional-only without operative or numeric is likely narrative.
        if topic_permit or topic_use:
            return None  # escalate to LLM
        return ChunkClassification(
            label="definitions_or_context",
            relevant=False,
            source="heuristic",
            reason=f"admin_context_skip: topic '{topic_dim or topic_park}' present but no operative or numeric signal",
        )

    # 6f. Operative present but no topic — generic procedural/narrative text.
    # Don't escalate: generic "shall" or "minimum" language without a zoning
    # topic is almost always non-extractable boilerplate.
    if operative and not has_topic:
        return ChunkClassification(
            label="definitions_or_context",
            relevant=False,
            source="heuristic",
            reason=f"admin_context_skip: operative '{operative}' with no zoning topic signal",
        )

    # 6g. Nothing matched — skip rather than escalating (low recall cost here:
    # chunks with no topic and no operative cannot produce V1 rules).
    return ChunkClassification(
        label="irrelevant",
        relevant=False,
        source="heuristic",
        reason="admin_context_skip: no topic signal and no operative signal",
    )


async def classify_chunk_llm(
    chunk: "DocumentChunk",
    openai_client: Any,
    model: str,
) -> ChunkClassification:
    """
    LLM-backed chunk classifier. Called only for chunks that the heuristic
    could not classify. Uses a cheap/fast model (classification_model from
    settings, which may differ from the extraction model).

    Returns a ChunkClassification. On any error, returns a safe fallback
    that marks the chunk as relevant (bias toward recall).
    """
    safe_fallback = ChunkClassification(
        label="dimensional_standards",   # safe: sends to extraction on error
        relevant=True,
        source="llm",
        reason="LLM classification failed — defaulting to relevant (safe fallback)",
    )

    # Truncate chunk text for classification prompt — we only need enough to
    # make a category decision; 800 chars is sufficient.
    preview = chunk.text[:800]

    try:
        response = await openai_client.responses.create(
            model=model,
            instructions=_CLASSIFY_SYSTEM_PROMPT,
            input=[{
                "role": "user",
                "content": (
                    f"Classify this zoning code chunk and return a json object "
                    f"with 'label' and 'reason' fields:\n\n{preview}"
                ),
            }],
            text={"format": {"type": "json_object"}},
        )
    except Exception as exc:
        log.warning("LLM classification API call failed for chunk=%s — %s", chunk.id, exc)
        return safe_fallback

    raw = (response.output_text or "").strip()
    if not raw:
        log.warning("Empty LLM classification response for chunk=%s", chunk.id)
        return safe_fallback

    try:
        parsed = json.loads(raw)
        label  = str(parsed.get("label", "")).strip()
        reason = str(parsed.get("reason", "")).strip() or "LLM provided no reason"
        if label not in (CHUNK_LABEL_RELEVANT | CHUNK_LABEL_SKIP):
            log.warning(
                "LLM returned unknown classification label %r for chunk=%s — defaulting to relevant",
                label, chunk.id,
            )
            return safe_fallback
        return ChunkClassification(
            label=label,
            relevant=(label in CHUNK_LABEL_RELEVANT),
            source="llm",
            reason=reason,
        )
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        log.warning("Could not parse LLM classification for chunk=%s (%s): %r", chunk.id, exc, raw[:200])
        return safe_fallback


async def extract_rules_from_chunk_llm(
    doc: UploadedDocument,
    chunk: DocumentChunk,
    openai_client: Any,
    model: str,
) -> list[ExtractedRule]:
    """
    Calls OpenAI with the chunk text and parses structured rule output.

    Returns un-persisted ExtractedRule objects. Caller is responsible for
    bulk-inserting them. Returns [] if the chunk yields no valid rules.

    Args:
        doc:            The parent UploadedDocument (for project_id, doc id).
        chunk:          The DocumentChunk to extract from.
        openai_client:  An initialised openai.AsyncOpenAI client.
        model:          Model name, e.g. "gpt-4o-mini".
    """
    now = datetime.now(timezone.utc)

    try:
        response = await openai_client.responses.create(
            model=model,
            instructions=_SYSTEM_PROMPT,
            input=[
                {
                    "role": "user",
                    # The Responses API with text.format=json_object requires the word
                    # "json" to appear in the input messages (not just instructions).
                    # The trailing sentence satisfies this requirement while being
                    # consistent with the extraction task already described in instructions.
                    "content": (
                        f"Extract all compliance rules from the following "
                        f'zoning code text and return them as a json object '
                        f'with a "rules" key containing an array of rule objects:\n\n{chunk.text}'
                    ),
                },
            ],
            text={"format": {"type": "json_object"}},
        )
        log.debug(
            "OpenAI Responses API call completed: model=%s format=json_object doc=%s chunk=%s",
            model, doc.id, chunk.id,
        )
    except Exception as exc:
        log.error(
            "OpenAI Responses API call failed: model=%s format=json_object doc=%s chunk=%s — %s",
            model, doc.id, chunk.id, exc,
        )
        return []

    raw_text = response.output_text or ""
    if not raw_text.strip():
        log.warning(
            "Empty output from LLM for model=%s doc=%s chunk=%s",
            model, doc.id, chunk.id,
        )
        return []

    # Model always returns {"rules": [...]} per the prompt.
    # Guard against bare arrays or single-rule objects as fallback.
    try:
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict):
            items = parsed.get("rules") or parsed.get("results") or []
            # Single rule object returned directly (no wrapper) — treat as one-item list
            if not isinstance(items, list):
                items = [parsed]
        elif isinstance(parsed, list):
            items = parsed
        else:
            log.warning(
                "Unexpected JSON structure from LLM for chunk=%s (type=%s): %r",
                chunk.id, type(parsed).__name__, raw_text[:200],
            )
            return []
    except json.JSONDecodeError as exc:
        log.warning(
            "Non-JSON response from LLM for model=%s chunk=%s (%s): %r",
            model, chunk.id, exc, raw_text[:200],
        )
        return []

    rules: list[ExtractedRule] = []
    for item in items:
        rule = _parse_llm_item(item, doc, chunk, now)
        if rule is not None:
            rules.append(rule)

    log.debug(
        "LLM extracted %d rules from doc=%s chunk=%s",
        len(rules), doc.id, chunk.id,
    )
    return rules


def _parse_llm_item(
    item: dict[str, Any],
    doc: UploadedDocument,
    chunk: DocumentChunk,
    now: datetime,
) -> ExtractedRule | None:
    """
    Converts one LLM output item dict into an ExtractedRule.
    Returns None if required fields are missing or invalid.
    """
    try:
        category = str(item.get("category", "")).strip()
        metric_key = _CATEGORY_TO_METRIC.get(category)
        if metric_key is None:
            log.debug("Unknown category %r — skipping", category)
            return None

        op_raw = str(item.get("operator", "<=")).strip()
        operator = _OP_MAP.get(op_raw, RuleOperator.LTE)

        raw_value: float | None = _safe_float(item.get("value"))
        value_min: float | None = _safe_float(item.get("value_min"))
        value_max: float | None = _safe_float(item.get("value_max"))
        units_raw: str | None = (item.get("units") or "").strip() or None
        confidence: float = min(1.0, max(0.0, float(item.get("confidence", 0.5))))

        # Unit normalisation: convert imperial to SI when needed
        normalization_note: str | None = None
        units_out = units_raw
        if units_raw and units_raw.lower() in _DOC_UNIT_CONVERSION:
            factor, canonical = _DOC_UNIT_CONVERSION[units_raw.lower()]
            if raw_value is not None:
                orig = raw_value
                raw_value = round(raw_value * factor, 4)
                normalization_note = (
                    f"Converted from {orig} {units_raw} → {raw_value} {canonical}"
                )
            if value_min is not None:
                orig_min = value_min
                value_min = round(value_min * factor, 4)
                value_max = round(value_max * factor, 4) if value_max else None
                normalization_note = (
                    f"Converted range from {orig_min}–{value_max} {units_raw} → "
                    f"{value_min}–{value_max} {canonical}"
                )
            units_out = canonical

        # Validate value presence
        if operator == RuleOperator.BETWEEN:
            if value_min is None or value_max is None:
                log.debug("between rule missing bounds — skipping")
                return None
        else:
            if raw_value is None:
                log.debug("rule missing value — skipping")
                return None

        snippet = str(item.get("snippet") or chunk.text[:400])
        rule_code = str(item.get("rule_code") or f"{doc.file_name}:chunk-{chunk.chunk_index}")
        title = str(item.get("title") or _auto_title(metric_key, operator, raw_value, units_out))
        condition_text = item.get("condition") or None
        exception_text = item.get("exception") or None

        # Applicability
        applicability = Applicability(
            zoning_districts=list(item.get("zoning_districts") or []),
            building_types=list(item.get("building_types") or []),
            occupancies=list(item.get("occupancies") or []),
        )

        # Effective date
        eff_date: datetime | None = None
        if item.get("effective_date"):
            try:
                eff_date = datetime.combine(
                    date.fromisoformat(item["effective_date"]),
                    datetime.min.time(),
                    tzinfo=timezone.utc,
                )
            except (ValueError, TypeError):
                pass

        version_label: str | None = item.get("version_label") or None

        citation = RuleCitation(
            document_id=doc.id,
            chunk_id=chunk.id,
            snippet=snippet[:400],
            page=chunk.page,
            section=chunk.section,
        )

        return ExtractedRule(
            id=uuid4(),
            project_id=doc.project_id,
            document_id=doc.id,
            rule_code=rule_code,
            title=title,
            description=snippet[:200],
            metric_key=metric_key,
            operator=operator,
            value_number=raw_value if operator != RuleOperator.BETWEEN else None,
            value_min=value_min,
            value_max=value_max,
            units=units_out,
            applicability=applicability,
            citation=citation,
            confidence=confidence,
            status=RuleStatus.DRAFT,
            source_kind=RuleSourceKind.EXTRACTED,
            is_authoritative=False,
            is_recommended=False,
            conflict_group_id=None,
            condition_text=str(condition_text) if condition_text else None,
            exception_text=str(exception_text) if exception_text else None,
            normalization_note=normalization_note,
            effective_date=eff_date,
            version_label=version_label,
            source_chunk_id=chunk.id,
            extraction_notes="LLM extraction (V1 OpenAI structured output)",
            created_at=now,
            updated_at=now,
        )

    except Exception:
        log.warning("Failed to parse LLM item: %r", item, exc_info=True)
        return None


def detect_conflicts(rules: list[ExtractedRule]) -> list[ExtractedRule]:
    """
    Groups rules that represent the same constraint with conflicting values.

    Conflict criteria:
      - Same metric_key
      - Same or overlapping applicability scope (or both empty)
      - Differing value_number / value_min / value_max OR differing operator

    When conflicts are detected, assigns a shared conflict_group_id UUID and
    flags the recommended winner using _pick_conflict_winner().

    Returns the same list with conflict fields mutated in place.

    NOTE: This operates on in-memory ExtractedRule objects before DB insertion.
    For rules added later (e.g. manual rules), re-run conflict detection
    by calling this on the full project rule set and persisting the results.
    """
    # Group candidates by metric_key for O(n log n) comparison
    by_metric: dict[MetricKey, list[ExtractedRule]] = {}
    for rule in rules:
        by_metric.setdefault(rule.metric_key, []).append(rule)

    for metric_key, candidates in by_metric.items():
        if len(candidates) < 2:
            continue

        # Compare all pairs — O(n²) acceptable for V1 (dozens of rules max)
        for i, r1 in enumerate(candidates):
            for r2 in candidates[i + 1:]:
                if not _scopes_compatible(r1.applicability, r2.applicability):
                    continue
                if not _values_conflict(r1, r2):
                    continue
                # Conflict detected — assign shared group ID
                group_id = r1.conflict_group_id or r2.conflict_group_id or uuid4()
                r1.conflict_group_id = group_id
                r2.conflict_group_id = group_id

    # For each conflict group, pick the recommended winner
    groups: dict[UUID, list[ExtractedRule]] = {}
    for rule in rules:
        if rule.conflict_group_id is not None:
            groups.setdefault(rule.conflict_group_id, []).append(rule)

    for group_rules in groups.values():
        winner = _pick_conflict_winner(group_rules)
        for rule in group_rules:
            rule.is_recommended = (rule.id == winner.id)

    return rules


def _scopes_compatible(a: Applicability, b: Applicability) -> bool:
    """
    True if two rules could plausibly be in conflict (same or overlapping scope).
    Empty scope = applies everywhere = overlaps with any scope.
    """
    def overlaps(lst_a: list[str], lst_b: list[str]) -> bool:
        if not lst_a or not lst_b:
            return True  # at least one is universal
        return bool(set(lst_a) & set(lst_b))

    return (
        overlaps(a.zoning_districts, b.zoning_districts)
        and overlaps(a.building_types, b.building_types)
        and overlaps(a.occupancies, b.occupancies)
    )


def _values_conflict(r1: ExtractedRule, r2: ExtractedRule) -> bool:
    """True if the two rules have materially different thresholds."""
    # Different operators always counts as a conflict
    if r1.operator != r2.operator:
        return True
    # Same scalar operator: different value
    if r1.value_number is not None and r2.value_number is not None:
        return abs(r1.value_number - r2.value_number) > 1e-9
    # Between: different range
    if r1.value_min is not None and r2.value_min is not None:
        return (
            abs(r1.value_min - r2.value_min) > 1e-9
            or abs((r1.value_max or 0) - (r2.value_max or 0)) > 1e-9
        )
    return False


def _pick_conflict_winner(rules: list[ExtractedRule]) -> ExtractedRule:
    """
    Recommendation logic for conflict resolution:
      1. Prefer newer effective_date
      2. Prefer higher semantic version (version_label)
      3. Prefer higher confidence
      4. Fallback: most recently created (created_at)

    Returns the recommended rule. Does NOT mutate the list.
    """
    def sort_key(r: ExtractedRule) -> tuple[int, tuple[int, ...], float, datetime]:
        eff = r.effective_date or datetime.min.replace(tzinfo=timezone.utc)
        ver = _parse_semver(r.version_label or "")
        conf = r.confidence
        ctime = r.created_at
        return (
            eff.toordinal(),
            ver,
            conf,
            ctime,
        )

    return max(rules, key=sort_key)


def _parse_semver(label: str) -> tuple[int, ...]:
    """Extracts numeric version components from a version label string."""
    parts = re.findall(r"\d+", label)
    return tuple(int(p) for p in parts) if parts else (0,)


def _safe_float(val: Any) -> float | None:
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _auto_title(
    key: MetricKey, op: RuleOperator, value: float | None, units: str | None
) -> str:
    label = key.value.replace("_", " ").title()
    op_str = "max" if op in {RuleOperator.LTE, RuleOperator.LT} else "min"
    val_str = f" {value} {units}" if value is not None else ""
    return f"{label} ({op_str}{val_str})".strip()
