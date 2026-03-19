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
# PUBLIC ENTRY POINTS
# ════════════════════════════════════════════════════════════

def collect_deduped_storeys(
    elements: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, str, int]:
    """
    Scans the flat element pool and returns the canonical set of
    IfcBuildingStorey element dicts, deduplicated by the best available
    identifier (id > globalId > name+elevation > python id).

    This is the same logic used by _apply_storey_height_heuristic to count
    distinct storeys, extracted here so the same deduped records can be used
    to create storey_elevation height candidates in _normalize_elements.

    Returns
    -------
    (deduped_elements, raw_count, dedup_method_str, malformed_skipped)
        deduped_elements  — one dict per unique storey, in first-seen order
        raw_count         — total storey-type matches before dedup
        dedup_method_str  — comma-joined dedup methods actually used
        malformed_skipped — elements whose IFC type could not be parsed
    """
    storey_ifc_classes = frozenset({
        "ifcbuildingstorey", "ifcstorey", "ifcbuildingstory",
    })
    seen_keys: set[str] = set()
    deduped: list[dict[str, Any]] = []
    raw_count = 0
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

        raw_count += 1

        obj_id    = str(e.get("id")       or "").strip()
        global_id = str(e.get("globalId") or e.get("applicationId") or "").strip()
        name      = str(e.get("name")     or "").strip()
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

        if dedup_key not in seen_keys:
            seen_keys.add(dedup_key)
            deduped.append(e)
        if method not in dedup_methods_used:
            dedup_methods_used.append(method)

    dedup_method_str = ", ".join(dedup_methods_used) if dedup_methods_used else "none"
    return deduped, raw_count, dedup_method_str, malformed_skipped


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


def _apply_heuristic_conversion(
    candidates: "NormalizedCandidates",
    ifc_gen_heights: "list",
    report: UnitNormalizationReport,
    *,
    length_factor: float,
    area_factor: float,
    resolved_length: str,
    resolved_area: str,
    unit_label_h: str,
    unit_label_a: str,
    detail: str,
    implied_storey_h_m: float,
    max_h: float,
    guard_area_plausibility: bool = False,
) -> None:
    """
    Shared conversion logic for both ft→m and mm→m storey-height heuristics.

    Mutates candidates in-place, records before/after snapshots and a
    plausibility warning in the report.

    Parameters
    ----------
    guard_area_plausibility : bool
        When True (mm→m case), area conversion is skipped if any IFC/generic
        area candidate already has a value in the plausible m² range (>= 1.0).
        This is necessary because IFC quantity set areas (BaseQuantities.GrossArea
        etc.) are stored in m² by IFC convention even when linear dimensions are
        in mm.  Blindly applying MM2_TO_M2 = 1e-6 to m²-scale values collapses
        them to near zero.

        When False (ft→m case), area conversion is always applied — Revit ft
        exports encode area values in ft² and require the ft²→m² factor.
    """
    report.heuristic_applied           = True
    report.heuristic_detail            = detail
    report.length_conversion_applied   = True
    report.length_conversion_factor    = length_factor
    report.resolved_length_units       = resolved_length
    report.height_before_conversion    = round(max_h, 4)

    ifc_gen_area_candidates = [
        c for c in candidates.area_candidates
        if c.connector_style in ("ifc", "generic")
    ]
    ifc_gen_areas_before = [c.value_m2 for c in ifc_gen_area_candidates]
    if ifc_gen_areas_before:
        report.gfa_before_conversion = round(sum(ifc_gen_areas_before), 4)

    # ── Determine whether area conversion should be applied ──────────────────
    # IFC property-set areas (GrossArea, NetArea, etc.) are stored in m² by
    # the IFC BaseQuantities convention, even when the exporter writes linear
    # dimensions in mm.  Applying MM2_TO_M2 (1e-6) to a 401 m² value yields
    # 0.0004 m² — wrong by 6 orders of magnitude.
    #
    # Guard: if guard_area_plausibility=True AND at least one area candidate
    # already has a value ≥ 1.0 m² (i.e. is plausible as m² already), skip
    # area conversion entirely and record the reason.
    _AREA_ALREADY_M2_THRESHOLD: float = 1.0  # m² — anything above this is suspicious to convert with 1e-6

    skip_area_conversion = False
    skip_area_reason = ""
    if guard_area_plausibility and ifc_gen_area_candidates:
        plausible_count = sum(1 for v in ifc_gen_areas_before if v >= _AREA_ALREADY_M2_THRESHOLD)
        if plausible_count > 0:
            skip_area_conversion = True
            skip_area_reason = (
                f"area conversion skipped for mm→m heuristic: "
                f"{plausible_count}/{len(ifc_gen_area_candidates)} IFC/generic area "
                f"candidate(s) are already ≥ {_AREA_ALREADY_M2_THRESHOLD} m² "
                f"(max={max(ifc_gen_areas_before):.4f} m²) — IFC quantity-set areas "
                f"are stored in m² by convention even when linear units are mm"
            )
            log.info("unit_normalizer: %s", skip_area_reason)

    if skip_area_conversion:
        report.area_conversion_applied = False
        report.area_conversion_factor  = 1.0
        report.resolved_area_units     = "m2"
    else:
        report.area_conversion_applied = True
        report.area_conversion_factor  = area_factor
        report.resolved_area_units     = resolved_area

    # ── Convert height candidates ─────────────────────────────────────────────
    for c in ifc_gen_heights:
        c.value_m = round(c.value_m * length_factor, 4)
        c.units   = unit_label_h

    # ── Convert area candidates (guarded) ────────────────────────────────────
    if not skip_area_conversion:
        for c in ifc_gen_area_candidates:
            c.value_m2 = round(c.value_m2 * area_factor, 4)
            c.units    = unit_label_a

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

    area_note = (
        "area conversion skipped (IFC quantities already in m²)"
        if skip_area_conversion
        else f"GFA: {report.gfa_before_conversion} → {report.gfa_after_conversion} m², factor={area_factor}"
    )
    report.plausibility_warnings.append(
        f"HEURISTIC CONVERSION APPLIED ({resolved_length}): {detail}. "
        f"Implied storey height of {implied_storey_h_m:.2f} m is implausible for metric. "
        f"Height converted to m "
        f"(height: {report.height_before_conversion} → {report.height_after_conversion} m, "
        f"factor={length_factor}); {area_note}. "
        f"Verify unit system in source IFC export."
    )
    if skip_area_reason:
        report.plausibility_warnings.append(f"AREA GUARD: {skip_area_reason}")
    log.warning(
        "unit_normalizer: storey-height heuristic fired (%s) — %s",
        resolved_length,
        detail,
    )


def _apply_storey_height_heuristic(
    candidates: "NormalizedCandidates",
    elements: list[dict[str, Any]],
    report: UnitNormalizationReport,
) -> None:
    """
    Fallback heuristic: detects likely ft→m or mm→m mismatch when no units are declared.

    Trigger condition (all must be true):
      1. No length conversion was applied (declared units == "m" or absent).
      2. At least one IfcBuildingStorey element is present in the element pool.
      3. The maximum IFC/generic height candidate divided by storey count
         exceeds _STOREY_H_SUSPICIOUS_M (default 6.0 m per storey).
      4a. (ft→m) The same value × FT_TO_M / storey_count falls within the plausible
          storey-height range [_STOREY_H_PLAUSIBLE_MIN_M, _STOREY_H_PLAUSIBLE_MAX_M].
      4b. (mm→m) The same value × MM_TO_M / storey_count falls within the plausible
          storey-height range. Checked only when the ft→m branch does not fire.

    Metric-scale mismatch (mm→m):
      Some IFC exporters (e.g. Autodesk Revit with default IFC export settings)
      write length values in millimetres with no explicit `units` field. The
      values are accepted by the pipeline as metres, yielding absurd results
      (e.g. building_height_m = 9886.95 for a 3-storey building of ~10 m).
      The mm→m branch catches this by checking whether ×0.001 produces a
      plausible per-storey height.

    Conservative behaviour:
      - ft→m is checked first. Only if it does not fire is mm→m attempted.
        This prevents mis-identifying genuinely imperial models as mm-scale.
      - If neither branch fires, no conversion is applied.
      - The decision and evidence are always recorded in the report.
    """
    # ── Step 1: Count distinct IfcBuildingStorey elements (deduplicated) ──────
    # Delegated to collect_deduped_storeys() — the same helper used by
    # _normalize_elements to create storey_elevation height candidates.
    # Using one shared source of truth avoids drift between the two paths.
    _deduped, storey_raw_count, dedup_method_str, malformed_skipped = (
        collect_deduped_storeys(elements)
    )
    storey_count = len(_deduped)

    report.storey_heuristic_ran               = True
    report.storey_heuristic_raw_count         = storey_raw_count
    report.storey_heuristic_valid_count       = storey_count
    report.storey_heuristic_malformed_skipped = malformed_skipped
    report.storey_heuristic_dedup_method      = dedup_method_str

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
    implied_storey_h_if_mm = implied_storey_h_m * MM_TO_M  # what it would be if input was mm

    detail = (
        f"{storey_count} distinct IfcBuildingStorey (raw={storey_raw_count}, dedup_method={dedup_method_str!r}); "
        f"max height candidate = {max_h:.2f}; "
        f"implied storey height = {implied_storey_h_m:.2f} m; "
        f"if interpreted as ft: {implied_storey_h_if_ft:.2f} m/storey; "
        f"if interpreted as mm: {implied_storey_h_if_mm:.4f} m/storey"
    )

    if (
        implied_storey_h_m > _STOREY_H_SUSPICIOUS_M
        and _STOREY_H_PLAUSIBLE_MIN_M <= implied_storey_h_if_ft <= _STOREY_H_PLAUSIBLE_MAX_M
    ):
        # Heuristic fires — convert both height and area from ft → metric
        _apply_heuristic_conversion(
            candidates, ifc_gen_heights, report,
            length_factor=FT_TO_M,
            area_factor=FT2_TO_M2,
            resolved_length="ft (heuristic)",
            resolved_area="ft2 (heuristic)",
            unit_label_h="m (ft→m heuristic)",
            unit_label_a="m² (ft²→m² heuristic)",
            detail=detail,
            implied_storey_h_m=implied_storey_h_m,
            max_h=max_h,
        )

    elif (
        implied_storey_h_m > _STOREY_H_SUSPICIOUS_M
        and _STOREY_H_PLAUSIBLE_MIN_M <= implied_storey_h_if_mm <= _STOREY_H_PLAUSIBLE_MAX_M
    ):
        # Metric-scale mismatch detected: values appear to be in millimetres,
        # not metres.  Convert mm → m for height candidates only.
        # Area is NOT blindly converted: IFC quantity-set areas
        # (BaseQuantities.GrossArea etc.) are stored in m² by IFC convention
        # even when the exporter writes linear dimensions in mm.  Applying
        # MM2_TO_M2 (1e-6) to a 400 m² value would yield 0.0004 m².
        # guard_area_plausibility=True causes _apply_heuristic_conversion to
        # skip area conversion when candidates are already plausible in m².
        _apply_heuristic_conversion(
            candidates, ifc_gen_heights, report,
            length_factor=MM_TO_M,
            area_factor=MM2_TO_M2,
            resolved_length="mm (heuristic)",
            resolved_area="mm2 (heuristic)",
            unit_label_h="m (mm→m heuristic)",
            unit_label_a="m² (mm²→m² heuristic)",
            detail=detail,
            implied_storey_h_m=implied_storey_h_m,
            max_h=max_h,
            guard_area_plausibility=True,
        )

    else:
        log.debug(
            "unit_normalizer: heuristic did not fire — %s "
            "(trigger requires implied_storey_h > %.1f m AND converted in [%.1f, %.1f] m "
            "for either ft or mm interpretation)",
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
