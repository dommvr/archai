"""
backend/app/services/unit_normalizer.py

Unit detection, normalization, and plausibility checking for IFC/Speckle model metrics.

This module is pipeline stage 3.5, inserted between _normalize_elements() and
_derive_metrics_from_candidates() in the geometry snapshot derivation pipeline.

Design goals:
  - Single responsibility: all unit logic lives here, not scattered in extractors.
  - Transparent: every decision is recorded in UnitNormalizationReport, which is
    stored verbatim in raw_metrics.unit_normalization for traceability.
  - Non-destructive: only converts IFC/generic candidates. Revit candidates are
    already in metric (the Revit Speckle connector normalises to SI).
  - Conservative: auto-converts only when declared units clearly require it.
    Uses a storey-height heuristic only as a fallback when no units are declared
    and the implied value is unambiguously implausible for metric.
  - Traceable: records before/after values for every converted candidate.

Supported declared unit strings (case-insensitive):
  Length : m, meters, metres, ft, feet, foot, mm, millimeter, millimetre, in, inch, inches
  Area   : derived automatically from the detected length unit

Output in raw_metrics:
  raw_metrics["unit_normalization"] = {
    "declared_length_units": "ft" | "m" | "mm" | "in" | null,
    "declared_area_units": "ft2" | "m2" | "mm2" | null,
    "elements_with_units": <int>,
    "total_elements_sampled": <int>,
    "unit_sample": {"ft": 42, "m": 3},  # raw counts before normalisation
    "resolved_length_units": "m" | "ft" | "mm" | "in",
    "resolved_area_units": "m2" | "ft2" | "mm2",
    "length_conversion_applied": true | false,
    "length_conversion_factor": 0.3048,
    "area_conversion_applied": true | false,
    "area_conversion_factor": 0.09290304,
    "height_before_conversion": 41.33,
    "height_after_conversion": 12.60,
    "gfa_before_conversion": 1500.0,
    "gfa_after_conversion": 139.4,
    "plausibility_warnings": ["..."],
    "heuristic_applied": true | false,
    "heuristic_detail": "3 IfcBuildingStorey elements; implied storey height 13.78 → 4.20 m"
  }
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    # Import only for type hints — the actual classes live in speckle_service.py.
    # This avoids a circular import since speckle_service imports this module.
    from app.services.speckle_service import (
        AreaCandidate,
        HeightCandidate,
        NormalizedCandidates,
    )

log = logging.getLogger(__name__)

# ── Conversion factors ─────────────────────────────────────────────────────────

FT_TO_M: float   = 0.3048
FT2_TO_M2: float = FT_TO_M ** 2    # 0.09290304
MM_TO_M: float   = 0.001
MM2_TO_M2: float = MM_TO_M ** 2    # 1e-6
IN_TO_M: float   = 0.0254
IN2_TO_M2: float = IN_TO_M ** 2    # 6.4516e-4

# ── Canonical unit string mapping (input → canonical, all lowercase) ───────────

_UNIT_STRING_MAP: dict[str, str] = {
    # Metric — no conversion needed
    "m":            "m",
    "meters":       "m",
    "metres":       "m",
    "meter":        "m",
    "metre":        "m",
    "si":           "m",
    # Millimetres
    "mm":           "mm",
    "millimeter":   "mm",
    "millimetre":   "mm",
    "millimeters":  "mm",
    "millimetres":  "mm",
    # Imperial feet
    "ft":           "ft",
    "feet":         "ft",
    "foot":         "ft",
    "'":            "ft",
    "us survey foot": "ft",
    # Imperial inches
    "in":           "in",
    "inch":         "in",
    "inches":       "in",
    '"':            "in",
}

# ── Area unit derived from the length unit ─────────────────────────────────────

_LENGTH_TO_AREA_UNIT: dict[str, str] = {
    "m":  "m2",
    "mm": "mm2",
    "ft": "ft2",
    "in": "in2",
}

# ── Per-length-unit conversion pair (length_factor, area_factor) ──────────────

_CONVERSION_FACTORS: dict[str, tuple[float, float]] = {
    "ft": (FT_TO_M,  FT2_TO_M2),
    "mm": (MM_TO_M,  MM2_TO_M2),
    "in": (IN_TO_M,  IN2_TO_M2),
    "m":  (1.0,      1.0),
}

# ── Plausibility bounds ────────────────────────────────────────────────────────

# Absolute maximum/minimum for a plausible building height (metres)
_HEIGHT_MIN_M: float = 0.3
_HEIGHT_MAX_M: float = 800.0

# Absolute bounds for total GFA (metres²)
_GFA_MIN_M2: float   = 1.0
_GFA_MAX_M2: float   = 5_000_000.0

# Heuristic: implied storey height threshold (metres).
# If max_height / storey_count > this value AND the value would be plausible
# after ft→m conversion, the model is assumed to be in feet.
_STOREY_H_SUSPICIOUS_M: float = 6.0

# Plausible storey-height range after tentative ft→m conversion.
_STOREY_H_PLAUSIBLE_MIN_M: float = 1.5
_STOREY_H_PLAUSIBLE_MAX_M: float = 6.0


# ════════════════════════════════════════════════════════════
# REPORT DATACLASS
# ════════════════════════════════════════════════════════════

@dataclass
class UnitNormalizationReport:
    """
    Traceability record produced by the unit normalization layer.

    This is stored verbatim in raw_metrics["unit_normalization"] so that
    every unit decision can be understood after the fact — without needing
    to re-run the extraction.
    """

    # ── Detection ─────────────────────────────────────────────
    declared_length_units: str | None = None   # e.g. "ft", "m", "mm"; None = not found
    declared_area_units: str | None   = None   # derived from length unit
    elements_with_units: int          = 0      # how many elements had a `units` field
    total_elements_sampled: int       = 0
    unit_sample: dict[str, int]       = dc_field(default_factory=dict)  # canonical → count

    # ── Resolution & conversion ───────────────────────────────
    resolved_length_units: str  = "m"          # unit actually used after resolution
    resolved_area_units: str    = "m2"
    length_conversion_applied: bool  = False
    length_conversion_factor: float  = 1.0
    area_conversion_applied: bool    = False
    area_conversion_factor: float    = 1.0

    # ── Heuristic ─────────────────────────────────────────────
    heuristic_applied: bool   = False
    heuristic_detail: str     = ""
    # Storey heuristic diagnostics (populated whether heuristic fires or not)
    storey_heuristic_ran: bool          = False   # True once the storey-count loop completes
    storey_heuristic_valid_count: int   = 0       # IfcBuildingStorey elements successfully matched
    storey_heuristic_malformed_skipped: int = 0   # elements whose IFC type could not be parsed
    storey_heuristic_raw_count: int      = 0   # raw storey-like matches before dedup
    storey_heuristic_dedup_method: str   = ""  # e.g. "object_id", "name+elevation"
    storey_heuristic_skip_reason: str   = ""      # non-empty when heuristic was not attempted

    # ── Before / after snapshots ──────────────────────────────
    height_before_conversion: float | None = None
    height_after_conversion: float | None  = None
    gfa_before_conversion: float | None    = None
    gfa_after_conversion: float | None     = None

    # ── Plausibility warnings ─────────────────────────────────
    plausibility_warnings: list[str] = dc_field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a JSON-safe dict for storage in raw_metrics."""
        return {
            "declared_length_units":   self.declared_length_units,
            "declared_area_units":     self.declared_area_units,
            "elements_with_units":     self.elements_with_units,
            "total_elements_sampled":  self.total_elements_sampled,
            "unit_sample":             self.unit_sample,
            "resolved_length_units":   self.resolved_length_units,
            "resolved_area_units":     self.resolved_area_units,
            "length_conversion_applied":  self.length_conversion_applied,
            "length_conversion_factor":   self.length_conversion_factor,
            "area_conversion_applied":    self.area_conversion_applied,
            "area_conversion_factor":     self.area_conversion_factor,
            "heuristic_applied":          self.heuristic_applied,
            "heuristic_detail":           self.heuristic_detail,
            "storey_heuristic_ran":               self.storey_heuristic_ran,
            "storey_heuristic_valid_count":        self.storey_heuristic_valid_count,
            "storey_heuristic_malformed_skipped":  self.storey_heuristic_malformed_skipped,
            "storey_heuristic_raw_count":          self.storey_heuristic_raw_count,
            "storey_heuristic_dedup_method":       self.storey_heuristic_dedup_method,
            "storey_heuristic_skip_reason":        self.storey_heuristic_skip_reason,
            "height_before_conversion":   self.height_before_conversion,
            "height_after_conversion":    self.height_after_conversion,
            "gfa_before_conversion":      self.gfa_before_conversion,
            "gfa_after_conversion":       self.gfa_after_conversion,
            "plausibility_warnings":      self.plausibility_warnings,
        }


# ════════════════════════════════════════════════════════════
# HELPERS
# ════════════════════════════════════════════════════════════

def _normalize_ifc_type(raw: Any) -> str | None:
    """
    Safely extract a normalised (lowercase, no namespace prefix) IFC class token
    from any raw value that may be None, non-string, empty, or malformed.

    Examples
    --------
    "IfcBuildingStorey"          → "ifcbuildingstorey"
    "Ifc.BuildingStorey"         → "ifcbuildingstorey"   (strips namespace prefix)
    "Objects.IfcBuildingStorey"  → "ifcbuildingstorey"
    ""                           → None
    None                         → None
    42                           → None
    "   "                        → None

    Returns
    -------
    str | None
        Lowercase first whitespace-token of the first dot-segment, or None when
        the value is absent / empty / not parseable.
    """
    if raw is None:
        return None
    # Coerce to str only if it actually is a string-like scalar
    if not isinstance(raw, (str, bytes)):
        return None
    s = raw.strip() if isinstance(raw, str) else raw.decode("utf-8", errors="replace").strip()
    if not s:
        return None
    # Take the first dot-separated segment (strips namespace prefixes like "Objects.")
    first_segment = s.split(".")[0].strip()
    if not first_segment:
        return None
    # Take the first whitespace token (handles "IfcBuildingStorey[1]"-style noise)
    tokens = first_segment.split()
    if not tokens:
        return None
    return tokens[0].lower()


# ════════════════════════════════════════════════════════════
# PUBLIC ENTRY POINT
# ════════════════════════════════════════════════════════════

def detect_and_normalize_units(
    candidates: "NormalizedCandidates",
    elements: list[dict[str, Any]],
) -> tuple["NormalizedCandidates", UnitNormalizationReport]:
    """
    Stage 3.5 in the geometry snapshot pipeline.

    Inspects the raw element pool and the extracted candidates to:
      1. Detect the declared unit system from element `units` fields.
      2. Apply conversion (ft→m, mm→m, in→m / ft²→m², mm²→m², in²→m²) to
         IFC and generic candidates. Revit candidates are skipped — the Revit
         Speckle connector always outputs SI.
      3. Run a storey-height heuristic as a fallback when no units are declared
         but the extracted values appear implausible for metric.
      4. Flag any remaining plausibility concerns as warnings.

    Candidates are mutated in-place (value_m / value_m2 / units fields).
    The returned report is stored in raw_metrics["unit_normalization"].
    """
    report = UnitNormalizationReport()

    _detect_units_from_elements(elements, report)
    _apply_declared_unit_conversion(candidates, report)

    # Fallback: if no declared units AND no conversion applied, try heuristic
    if not report.length_conversion_applied:
        _apply_storey_height_heuristic(candidates, elements, report)

    _check_plausibility_bounds(candidates, report)

    if report.plausibility_warnings:
        log.warning(
            "unit_normalizer: %d plausibility warning(s): %s",
            len(report.plausibility_warnings),
            "; ".join(report.plausibility_warnings),
        )
    else:
        log.debug(
            "unit_normalizer: resolved_length=%s length_converted=%s area_converted=%s "
            "heuristic=%s",
            report.resolved_length_units,
            report.length_conversion_applied,
            report.area_conversion_applied,
            report.heuristic_applied,
        )

    return candidates, report


# ════════════════════════════════════════════════════════════
# INTERNAL STAGES
# ════════════════════════════════════════════════════════════

def _detect_units_from_elements(
    elements: list[dict[str, Any]],
    report: UnitNormalizationReport,
) -> None:
    """
    Inspects up to 500 elements for their `units` field.
    Maps raw strings to canonical forms and picks the plurality winner.

    Only IFC and generic elements carry explicit unit metadata in practice.
    Revit elements processed by the Speckle connector are pre-normalised to SI
    and typically carry "m" or no unit string — both are safe to keep.
    """
    sample = elements[:500]
    report.total_elements_sampled = len(sample)

    unit_counts: dict[str, int] = {}

    for elem in sample:
        raw = str(elem.get("units") or "").strip().lower()
        if not raw:
            continue
        report.elements_with_units += 1
        canonical = _UNIT_STRING_MAP.get(raw, raw)  # unknown strings kept as-is
        unit_counts[canonical] = unit_counts.get(canonical, 0) + 1

    report.unit_sample = unit_counts

    if not unit_counts:
        # No unit metadata found — leave resolved_length_units = "m" (default).
        log.debug(
            "unit_normalizer: no `units` field found in %d sampled elements — "
            "assuming metric; will attempt storey heuristic if needed",
            len(sample),
        )
        return

    dominant = max(unit_counts, key=lambda k: unit_counts[k])
    report.declared_length_units = dominant
    report.declared_area_units   = _LENGTH_TO_AREA_UNIT.get(dominant)
    report.resolved_length_units = dominant
    report.resolved_area_units   = _LENGTH_TO_AREA_UNIT.get(dominant, "m2")

    log.info(
        "unit_normalizer: declared_length_units=%r (sample: %s, %d/%d elements had units)",
        dominant,
        ", ".join(f"{k}={v}" for k, v in sorted(unit_counts.items(), key=lambda x: -x[1])),
        report.elements_with_units,
        report.total_elements_sampled,
    )


def _apply_declared_unit_conversion(
    candidates: "NormalizedCandidates",
    report: UnitNormalizationReport,
) -> None:
    """
    Converts IFC/generic candidates to metric using the declared unit system.
    Revit candidates (connector_style == "revit") are left unchanged.

    Sets report.length/area_conversion_applied and _factor, and records
    before/after snapshot values.
    """
    length_unit = report.resolved_length_units
    length_factor, area_factor = _CONVERSION_FACTORS.get(length_unit, (1.0, 1.0))

    if length_factor == 1.0 and area_factor == 1.0:
        # Already metric — no conversion needed
        return

    report.length_conversion_applied = True
    report.length_conversion_factor  = length_factor
    report.area_conversion_applied   = True
    report.area_conversion_factor    = area_factor

    # Snapshot pre-conversion peaks for traceability
    ifc_gen_heights = [
        c.value_m for c in candidates.height_candidates
        if c.connector_style in ("ifc", "generic")
    ]
    ifc_gen_areas = [
        c.value_m2 for c in candidates.area_candidates
        if c.connector_style in ("ifc", "generic")
    ]
    if ifc_gen_heights:
        report.height_before_conversion = round(max(ifc_gen_heights), 4)
    if ifc_gen_areas:
        report.gfa_before_conversion = round(sum(ifc_gen_areas), 4)

    # ── Convert height candidates (IFC / generic only) ────────
    for c in candidates.height_candidates:
        if c.connector_style not in ("ifc", "generic"):
            continue
        original = c.value_m
        c.value_m = round(original * length_factor, 4)
        c.units   = "m"

    # ── Convert area candidates (IFC / generic only) ──────────
    for c in candidates.area_candidates:
        if c.connector_style not in ("ifc", "generic"):
            continue
        original  = c.value_m2
        c.value_m2 = round(original * area_factor, 4)
        c.units    = "m²"

    # Snapshot post-conversion peaks
    post_heights = [
        c.value_m for c in candidates.height_candidates
        if c.connector_style in ("ifc", "generic")
    ]
    post_areas = [
        c.value_m2 for c in candidates.area_candidates
        if c.connector_style in ("ifc", "generic")
    ]
    if post_heights:
        report.height_after_conversion = round(max(post_heights), 4)
    if post_areas:
        report.gfa_after_conversion = round(sum(post_areas), 4)

    log.info(
        "unit_normalizer: converted %s → m (height: %s → %s m, GFA: %s → %s m²)",
        length_unit,
        report.height_before_conversion,
        report.height_after_conversion,
        report.gfa_before_conversion,
        report.gfa_after_conversion,
    )


def _apply_storey_height_heuristic(
    candidates: "NormalizedCandidates",
    elements: list[dict[str, Any]],
    report: UnitNormalizationReport,
) -> None:
    """
    Fallback heuristic: detects likely ft→m mismatch when no units are declared.

    Trigger condition (all must be true):
      1. No length conversion was applied (declared units == "m" or absent).
      2. At least one IfcBuildingStorey element is present in the element pool.
      3. The maximum IFC/generic height candidate divided by storey count
         exceeds _STOREY_H_SUSPICIOUS_M (default 6.0 m per storey).
      4. The same value × FT_TO_M / storey_count falls within the plausible
         storey-height range [_STOREY_H_PLAUSIBLE_MIN_M, _STOREY_H_PLAUSIBLE_MAX_M].

    When the heuristic fires, it converts IFC/generic height candidates from ft→m
    AND converts area candidates from ft²→m² (both share the same source unit).

    Why storey count?
      A 3-storey building with a top elevation of ~41 ft (12.6 m) is perfectly
      normal. Interpreted as metres, 41 m for 3 storeys → 13.7 m/storey is
      immediately implausible. The storey count disambiguates the scale.

    Conservative behaviour:
      - If the heuristic trigger is ambiguous (storey count == 0 or implied
        storey height in a plausible metric range), no conversion is applied.
      - The decision and evidence are always recorded in the report.
    """
    # ── Step 1: Count distinct IfcBuildingStorey elements (deduplicated) ──────
    # The element pool produced by _collect_elements_from_base may contain the
    # same IfcBuildingStorey node more than once because the Speckle object graph
    # includes it as both a typed entity and as a parent reference on every
    # element that belongs to that storey. Counting raw occurrences inflates the
    # storey count (80 observed for a 4-storey building in testing), which makes
    # the implied-storey-height heuristic trigger threshold unreachable.
    #
    # Deduplication priority:
    #   1. element `id`               — most reliable (Speckle object ID)
    #   2. element `globalId`         — IFC GlobalId, stable across exports
    #   3. element `applicationId`    — connector-assigned application ID
    #   4. name + elevation tuple     — if all IDs absent
    #   5. Python object identity     — last resort (same object reference)
    storey_ifc_classes = frozenset({
        "ifcbuildingstorey", "ifcstorey", "ifcbuildingstory",
    })
    storey_ids: set[str] = set()
    storey_raw_count = 0
    malformed_skipped = 0
    dedup_methods_used: list[str] = []

    for e in elements:
        raw_type = e.get("ifcType") or e.get("type")
        normalised = _normalize_ifc_type(raw_type)
        if normalised is None:
            malformed_skipped += 1
            continue
        if normalised not in storey_ifc_classes:
            continue

        storey_raw_count += 1

        # Build a stable dedup key using the best available identifier
        obj_id    = str(e.get("id")            or "").strip()
        global_id = str(e.get("globalId")      or e.get("applicationId") or "").strip()
        name      = str(e.get("name")          or "").strip()
        elevation = e.get("elevation")

        if obj_id:
            dedup_key = f"id:{obj_id}"
            method = "object_id"
        elif global_id:
            dedup_key = f"gid:{global_id}"
            method = "global_id"
        elif name:
            dedup_key = f"name:{name}:elev:{elevation}"
            method = "name+elevation"
        else:
            dedup_key = f"pyid:{id(e)}"
            method = "python_id_fallback"

        storey_ids.add(dedup_key)
        if method not in dedup_methods_used:
            dedup_methods_used.append(method)

    storey_count = len(storey_ids)
    dedup_method_str = ", ".join(dedup_methods_used) if dedup_methods_used else "none"

    report.storey_heuristic_ran             = True
    report.storey_heuristic_raw_count       = storey_raw_count
    report.storey_heuristic_valid_count     = storey_count
    report.storey_heuristic_malformed_skipped = malformed_skipped
    report.storey_heuristic_dedup_method    = dedup_method_str

    if malformed_skipped:
        log.debug(
            "unit_normalizer: storey heuristic — skipped %d element(s) with "
            "absent/empty/non-string IFC type values",
            malformed_skipped,
        )
    log.debug(
        "unit_normalizer: storey dedup — raw=%d distinct=%d method=%r",
        storey_raw_count, storey_count, dedup_method_str,
    )

    ifc_gen_heights = [
        c for c in candidates.height_candidates
        if c.connector_style in ("ifc", "generic")
    ]

    if not ifc_gen_heights:
        report.storey_heuristic_skip_reason = "no ifc/generic height candidates available"
        log.debug(
            "unit_normalizer: heuristic skipped — no ifc/generic height candidates "
            "(storey_count=%d, malformed_skipped=%d)",
            storey_count,
            malformed_skipped,
        )
        return

    if storey_count == 0:
        report.storey_heuristic_skip_reason = (
            f"no IfcBuildingStorey elements found "
            f"({malformed_skipped} element(s) had unparseable IFC type values)"
        )
        log.debug(
            "unit_normalizer: heuristic skipped — storey_count=0 "
            "(ifc_gen_height_candidates=%d, malformed_skipped=%d)",
            len(ifc_gen_heights),
            malformed_skipped,
        )
        return

    max_h = max(c.value_m for c in ifc_gen_heights)
    implied_storey_h_m = max_h / storey_count
    implied_storey_h_if_ft = implied_storey_h_m * FT_TO_M  # what it would be if input was ft

    detail = (
        f"{storey_count} distinct IfcBuildingStorey (raw={storey_raw_count}, dedup_method={dedup_method_str!r}); "
        f"max height candidate = {max_h:.2f}; "
        f"implied storey height = {implied_storey_h_m:.2f} m; "
        f"if interpreted as ft: {implied_storey_h_if_ft:.2f} m/storey"
    )

    if (
        implied_storey_h_m > _STOREY_H_SUSPICIOUS_M
        and _STOREY_H_PLAUSIBLE_MIN_M <= implied_storey_h_if_ft <= _STOREY_H_PLAUSIBLE_MAX_M
    ):
        # Heuristic fires — convert both height and area from ft → metric
        report.heuristic_applied           = True
        report.heuristic_detail            = detail
        report.length_conversion_applied   = True
        report.length_conversion_factor    = FT_TO_M
        report.area_conversion_applied     = True
        report.area_conversion_factor      = FT2_TO_M2
        report.resolved_length_units       = "ft (heuristic)"
        report.resolved_area_units         = "ft2 (heuristic)"
        report.height_before_conversion    = round(max_h, 4)

        ifc_gen_areas = [
            c.value_m2 for c in candidates.area_candidates
            if c.connector_style in ("ifc", "generic")
        ]
        if ifc_gen_areas:
            report.gfa_before_conversion = round(sum(ifc_gen_areas), 4)

        # Apply ft → m to height candidates
        for c in ifc_gen_heights:
            c.value_m = round(c.value_m * FT_TO_M, 4)
            c.units   = "m (ft→m heuristic)"

        # Apply ft² → m² to area candidates
        for c in candidates.area_candidates:
            if c.connector_style in ("ifc", "generic"):
                c.value_m2 = round(c.value_m2 * FT2_TO_M2, 4)
                c.units    = "m² (ft²→m² heuristic)"

        post_heights = [
            c.value_m for c in candidates.height_candidates
            if c.connector_style in ("ifc", "generic")
        ]
        post_areas = [
            c.value_m2 for c in candidates.area_candidates
            if c.connector_style in ("ifc", "generic")
        ]
        if post_heights:
            report.height_after_conversion = round(max(post_heights), 4)
        if post_areas:
            report.gfa_after_conversion = round(sum(post_areas), 4)

        report.plausibility_warnings.append(
            f"HEURISTIC CONVERSION APPLIED: {detail}. "
            f"Implied storey height of {implied_storey_h_m:.2f} m is implausible for metric. "
            f"Height and area candidates converted ft → m (height: "
            f"{report.height_before_conversion} → {report.height_after_conversion} m). "
            f"Verify unit system in source IFC export."
        )
        log.warning(
            "unit_normalizer: storey-height heuristic fired — %s",
            detail,
        )
    else:
        log.debug(
            "unit_normalizer: heuristic did not fire — %s "
            "(trigger requires implied_storey_h > %.1f m AND converted in [%.1f, %.1f] m)",
            detail,
            _STOREY_H_SUSPICIOUS_M,
            _STOREY_H_PLAUSIBLE_MIN_M,
            _STOREY_H_PLAUSIBLE_MAX_M,
        )


def _check_plausibility_bounds(
    candidates: "NormalizedCandidates",
    report: UnitNormalizationReport,
) -> None:
    """
    Final pass: checks that post-conversion values fall within plausible ranges.
    Appends warnings to report for any value that looks wrong even after conversion.
    Does NOT apply further conversion — only warns.
    """
    # Height bounds
    if candidates.height_candidates:
        max_h = max(c.value_m for c in candidates.height_candidates)
        if max_h > _HEIGHT_MAX_M:
            report.plausibility_warnings.append(
                f"building_height_m={max_h:.1f} exceeds plausible maximum "
                f"({_HEIGHT_MAX_M} m). Possible residual unit error — "
                f"check source model units."
            )
        elif max_h < _HEIGHT_MIN_M:
            report.plausibility_warnings.append(
                f"building_height_m={max_h:.3f} is below plausible minimum "
                f"({_HEIGHT_MIN_M} m). Model may be missing height data."
            )

    # Area bounds
    if candidates.area_candidates:
        total_m2 = sum(c.value_m2 for c in candidates.area_candidates)
        if total_m2 > _GFA_MAX_M2:
            report.plausibility_warnings.append(
                f"total_area={total_m2:.0f} m² exceeds plausible maximum "
                f"({_GFA_MAX_M2:.0f} m²). Possible residual unit error."
            )
        elif total_m2 < _GFA_MIN_M2:
            report.plausibility_warnings.append(
                f"total_area={total_m2:.4f} m² is below plausible minimum "
                f"({_GFA_MIN_M2} m²). Model may be missing floor/area data."
            )
