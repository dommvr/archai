"""
backend/app/services/report_generator.py

Deterministic PDF report generator for precheck compliance runs.

Design constraints:
  - No LLM calls — all content comes from RunReportData (backend truth).
  - Uses reportlab for server-side PDF generation (no browser/headless Chrome).
  - Same RunReportData struct drives both on-screen summary and this PDF,
    so the two representations can never drift apart.
  - Handles all edge cases gracefully: no checks, no issues, stale run,
    missing site/model metadata, long result lists (page breaks).
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.core.schemas import (
    CheckResultStatus,
    IssueSeverity,
    RunReportData,
)

# ── Colour palette (dark → PDF safe equivalents) ─────────────────────────────
_BLACK       = colors.HexColor("#0A0A0A")
_CHARCOAL    = colors.HexColor("#1F1F1F")
_GRAPHITE    = colors.HexColor("#2E2E2E")
_SMOKE       = colors.HexColor("#4A4A4A")
_WHITE       = colors.white
_ORANGE      = colors.HexColor("#C15D2E")
_AMBER       = colors.HexColor("#E8A24F")
_GREEN       = colors.HexColor("#34D399")
_RED         = colors.HexColor("#F87171")
_YELLOW      = colors.HexColor("#FBBF24")
_MUTED       = colors.HexColor("#6B7280")
_LIGHT_GRAY  = colors.HexColor("#F3F4F6")
_MID_GRAY    = colors.HexColor("#E5E7EB")
_BORDER_GRAY = colors.HexColor("#D1D5DB")

_PAGE_W, _PAGE_H = A4
_MARGIN = 18 * mm

# ── Status display config ─────────────────────────────────────────────────────
_STATUS_LABELS: dict[CheckResultStatus, str] = {
    CheckResultStatus.PASS:          "Pass",
    CheckResultStatus.FAIL:          "Fail",
    CheckResultStatus.AMBIGUOUS:     "Warning",
    CheckResultStatus.MISSING_INPUT: "Not evaluable",
    CheckResultStatus.NOT_APPLICABLE:"N/A",
}

_STATUS_COLORS: dict[CheckResultStatus, Any] = {
    CheckResultStatus.PASS:          _GREEN,
    CheckResultStatus.FAIL:          _RED,
    CheckResultStatus.AMBIGUOUS:     _YELLOW,
    CheckResultStatus.MISSING_INPUT: _MUTED,
    CheckResultStatus.NOT_APPLICABLE:_MUTED,
}

_SEVERITY_LABELS: dict[IssueSeverity, str] = {
    IssueSeverity.CRITICAL: "Critical",
    IssueSeverity.ERROR:    "Error",
    IssueSeverity.WARNING:  "Warning",
    IssueSeverity.INFO:     "Info",
}

_SEVERITY_COLORS: dict[IssueSeverity, Any] = {
    IssueSeverity.CRITICAL: _RED,
    IssueSeverity.ERROR:    _RED,
    IssueSeverity.WARNING:  _YELLOW,
    IssueSeverity.INFO:     _MUTED,
}

_READINESS_COLORS: dict[str, Any] = {
    "permit_ready":      _GREEN,
    "issues_to_resolve": _AMBER,
    "incomplete_input":  _RED,
    "not_yet_evaluated": _MUTED,
}

_READINESS_LABELS: dict[str, str] = {
    "permit_ready":      "Permit Ready",
    "issues_to_resolve": "Issues to Resolve",
    "incomplete_input":  "Incomplete Input",
    "not_yet_evaluated": "Not Yet Evaluated",
}


# ── Style registry ────────────────────────────────────────────────────────────

def _build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title",
            parent=base["Normal"],
            fontSize=22,
            leading=28,
            textColor=_BLACK,
            fontName="Helvetica-Bold",
            spaceAfter=2 * mm,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["Normal"],
            fontSize=11,
            leading=15,
            textColor=_SMOKE,
            fontName="Helvetica",
            spaceAfter=1 * mm,
        ),
        "section_header": ParagraphStyle(
            "section_header",
            parent=base["Normal"],
            fontSize=12,
            leading=16,
            textColor=_BLACK,
            fontName="Helvetica-Bold",
            spaceBefore=6 * mm,
            spaceAfter=2 * mm,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontSize=9,
            leading=13,
            textColor=_BLACK,
            fontName="Helvetica",
        ),
        "body_small": ParagraphStyle(
            "body_small",
            parent=base["Normal"],
            fontSize=8,
            leading=11,
            textColor=_SMOKE,
            fontName="Helvetica",
        ),
        "cell": ParagraphStyle(
            "cell",
            parent=base["Normal"],
            fontSize=8,
            leading=11,
            textColor=_BLACK,
            fontName="Helvetica",
            wordWrap="LTR",
        ),
        "cell_muted": ParagraphStyle(
            "cell_muted",
            parent=base["Normal"],
            fontSize=8,
            leading=11,
            textColor=_SMOKE,
            fontName="Helvetica",
            wordWrap="LTR",
        ),
        "disclaimer": ParagraphStyle(
            "disclaimer",
            parent=base["Normal"],
            fontSize=7.5,
            leading=11,
            textColor=_SMOKE,
            fontName="Helvetica",
            spaceAfter=1.5 * mm,
        ),
        "stale_warning": ParagraphStyle(
            "stale_warning",
            parent=base["Normal"],
            fontSize=9,
            leading=13,
            textColor=_AMBER,
            fontName="Helvetica-Bold",
        ),
    }


def _hr(styles: dict[str, ParagraphStyle]) -> list[Any]:
    return [
        Spacer(1, 2 * mm),
        HRFlowable(width="100%", thickness=0.5, color=_BORDER_GRAY),
        Spacer(1, 3 * mm),
    ]


def _fmt_value(value: float | None, units: str | None) -> str:
    if value is None:
        return "—"
    s = f"{value:g}"
    if units:
        s += f" {units}"
    return s


def _fmt_required(row_data: Any) -> str:
    """Format the 'required' column from a ComplianceResultRow."""
    if row_data.expected_min is not None and row_data.expected_max is not None:
        s = f"{row_data.expected_min:g} – {row_data.expected_max:g}"
    elif row_data.expected_value is not None:
        s = f"{row_data.expected_value:g}"
    else:
        return "—"
    if row_data.units:
        s += f" {row_data.units}"
    return s


# ── Section builders ──────────────────────────────────────────────────────────

def _build_header_section(data: RunReportData, styles: dict[str, ParagraphStyle]) -> list[Any]:
    elems: list[Any] = []

    title = data.run_name or f"Compliance Report — Run {str(data.run_id)[:8]}"
    elems.append(Paragraph(title, styles["title"]))

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    elems.append(Paragraph(f"Generated: {generated_at}", styles["subtitle"]))

    if data.address:
        elems.append(Paragraph(f"Site: {data.address}", styles["subtitle"]))
    if data.municipality or data.jurisdiction_code:
        loc = ", ".join(filter(None, [data.municipality, data.jurisdiction_code]))
        elems.append(Paragraph(f"Jurisdiction: {loc}", styles["subtitle"]))
    if data.zoning_district:
        elems.append(Paragraph(f"Zoning: {data.zoning_district}", styles["subtitle"]))
    if data.model_name:
        model_text = f"Model: {data.model_name}"
        if data.model_synced_at:
            model_text += f" (synced {data.model_synced_at.strftime('%Y-%m-%d')})"
        elems.append(Paragraph(model_text, styles["subtitle"]))

    run_ts = data.run_created_at.strftime("%Y-%m-%d %H:%M UTC")
    elems.append(Paragraph(f"Run created: {run_ts}  |  Status: {data.run_status.value}", styles["subtitle"]))

    if data.is_stale:
        elems.append(Spacer(1, 2 * mm))
        stale_text = "⚠  This report is based on an outdated compliance run. Rule approvals have changed since this run was completed. Results may not reflect the current rule set."
        elems.append(Paragraph(stale_text, styles["stale_warning"]))

    elems += _hr(styles)
    return elems


def _build_readiness_section(data: RunReportData, styles: dict[str, ParagraphStyle]) -> list[Any]:
    elems: list[Any] = []
    elems.append(Paragraph("Permit Readiness", styles["section_header"]))

    label_key = data.readiness.label.value if hasattr(data.readiness.label, "value") else str(data.readiness.label)
    label_text = _READINESS_LABELS.get(label_key, label_key)
    label_color = _READINESS_COLORS.get(label_key, _MUTED)

    score_style = ParagraphStyle(
        "score_inline",
        fontSize=28,
        leading=34,
        textColor=label_color,
        fontName="Helvetica-Bold",
    )
    label_style = ParagraphStyle(
        "label_inline",
        fontSize=11,
        leading=15,
        textColor=label_color,
        fontName="Helvetica-Bold",
    )

    elems.append(Paragraph(str(data.readiness.score), score_style))
    elems.append(Paragraph(label_text, label_style))
    elems.append(Spacer(1, 2 * mm))

    if data.readiness.reasons:
        for reason in data.readiness.reasons:
            prefix = "● " if reason.is_blocking else "· "
            color = _RED if reason.is_blocking else _SMOKE
            delta_str = f" ({reason.delta:+d})" if reason.delta != 0 else ""
            style = ParagraphStyle(
                f"reason_{reason.key}",
                fontSize=8.5,
                leading=12,
                textColor=color,
                fontName="Helvetica-Bold" if reason.is_blocking else "Helvetica",
            )
            elems.append(Paragraph(f"{prefix}{reason.label}{delta_str}", style))

    elems += _hr(styles)
    return elems


def _build_compliance_summary_section(data: RunReportData, styles: dict[str, ParagraphStyle]) -> list[Any]:
    elems: list[Any] = []
    elems.append(Paragraph("Compliance Summary", styles["section_header"]))

    cs = data.compliance_summary
    summary_data = [
        ["Metric", "Count"],
        ["Total evaluated rules", str(cs.total)],
        ["Passed",               str(cs.passed)],
        ["Failed",               str(cs.failed)],
        ["Warnings (ambiguous)", str(cs.warning)],
        ["Not evaluable",        str(cs.not_evaluable)],
    ]

    col_w = (_PAGE_W - 2 * _MARGIN) / 2
    tbl = Table(summary_data, colWidths=[col_w * 1.6, col_w * 0.4])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, 0),  _GRAPHITE),
        ("TEXTCOLOR",   (0, 0), (-1, 0),  _WHITE),
        ("FONTNAME",    (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",    (0, 0), (-1, 0),  8.5),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
        ("TOPPADDING",  (0, 0), (-1, 0),  4),
        ("FONTNAME",    (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",    (0, 1), (-1, -1), 8.5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
        ("TOPPADDING",  (0, 1), (-1, -1), 3),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [_LIGHT_GRAY, _WHITE]),
        ("GRID",        (0, 0), (-1, -1), 0.4, _BORDER_GRAY),
        ("ALIGN",       (1, 0), (1, -1),  "RIGHT"),
        # Colour the count cells by status
        ("TEXTCOLOR",   (1, 2), (1, 2),   _GREEN),   # passed
        ("TEXTCOLOR",   (1, 3), (1, 3),   _RED),     # failed
        ("TEXTCOLOR",   (1, 4), (1, 4),   _YELLOW),  # warning
        ("TEXTCOLOR",   (1, 5), (1, 5),   _MUTED),   # not evaluable
        ("FONTNAME",    (1, 2), (1, -1),  "Helvetica-Bold"),
    ]))
    elems.append(tbl)
    elems += _hr(styles)
    return elems


def _build_detailed_results_section(data: RunReportData, styles: dict[str, ParagraphStyle]) -> list[Any]:
    elems: list[Any] = []
    elems.append(Paragraph("Detailed Compliance Results", styles["section_header"]))

    if not data.compliance_results:
        elems.append(Paragraph("No compliance results available for this run.", styles["body"]))
        elems += _hr(styles)
        return elems

    full_width = _PAGE_W - 2 * _MARGIN
    col_widths = [
        full_width * 0.22,   # Rule / metric
        full_width * 0.10,   # Status
        full_width * 0.11,   # Measured
        full_width * 0.11,   # Required
        full_width * 0.46,   # Explanation
    ]

    headers = [
        Paragraph("Rule / Metric", styles["cell"]),
        Paragraph("Status",        styles["cell"]),
        Paragraph("Measured",      styles["cell"]),
        Paragraph("Required",      styles["cell"]),
        Paragraph("Explanation",   styles["cell"]),
    ]
    table_data: list[list[Any]] = [headers]

    for row in data.compliance_results:
        title = row.rule_title or (row.metric_label or (row.metric_key.value if row.metric_key else "—"))
        if row.rule_code:
            title = f"{title}\n[{row.rule_code}]"
        status_label = _STATUS_LABELS.get(row.status, row.status.value)
        status_color = _STATUS_COLORS.get(row.status, _MUTED)

        status_style = ParagraphStyle(
            f"status_{row.check_id}",
            fontSize=8,
            leading=11,
            textColor=status_color,
            fontName="Helvetica-Bold",
            wordWrap="LTR",
        )

        measured = _fmt_value(row.actual_value, row.units)
        required = _fmt_required(row)

        # Build explanation cell: main explanation + citation ref if available
        explanation_parts = []
        if row.explanation:
            explanation_parts.append(row.explanation)
        if row.citation_section or row.citation_page is not None:
            ref = "§" + row.citation_section if row.citation_section else ""
            if row.citation_page is not None:
                ref += (" · " if ref else "") + f"p.{row.citation_page}"
            explanation_parts.append(f"({ref})")
        explanation = "  ".join(explanation_parts) if explanation_parts else ""

        table_data.append([
            Paragraph(title, styles["cell"]),
            Paragraph(status_label, status_style),
            Paragraph(measured, styles["cell"]),
            Paragraph(required, styles["cell"]),
            Paragraph(explanation, styles["cell"]),
        ])

    tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  _GRAPHITE),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  _WHITE),
        ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0),  8.5),
        ("BOTTOMPADDING", (0, 0), (-1, 0),  4),
        ("TOPPADDING",    (0, 0), (-1, 0),  4),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 1), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
        ("TOPPADDING",    (0, 1), (-1, -1), 3),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [_LIGHT_GRAY, _WHITE]),
        ("GRID",          (0, 0), (-1, -1), 0.4, _BORDER_GRAY),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    elems.append(tbl)
    elems += _hr(styles)
    return elems


def _build_rules_appendix_section(data: RunReportData, styles: dict[str, ParagraphStyle]) -> list[Any]:
    """
    Appendix: full provenance detail for every authoritative rule in the run.
    Shown after a page break so the main report remains scannable.
    """
    elems: list[Any] = []
    elems.append(Paragraph("Appendix — Authoritative Rule Details", styles["section_header"]))
    elems.append(Paragraph(
        f"This appendix lists the {data.authoritative_rule_count} authoritative rule(s) that drove "
        "the compliance evaluation above, together with their source citations and applicability metadata.",
        styles["body"],
    ))
    elems.append(Spacer(1, 3 * mm))

    if not data.compliance_results:
        elems.append(Paragraph("No authoritative rules were recorded for this run.", styles["body"]))
        return elems

    for i, row in enumerate(data.compliance_results):
        title = row.rule_title or (row.metric_label or (row.metric_key.value if row.metric_key else "—"))
        status_label = _STATUS_LABELS.get(row.status, row.status.value)
        status_color = _STATUS_COLORS.get(row.status, _MUTED)

        # Rule heading
        heading_style = ParagraphStyle(
            f"app_h_{i}",
            fontSize=9,
            leading=13,
            textColor=_BLACK,
            fontName="Helvetica-Bold",
            spaceBefore=3 * mm,
        )
        elems.append(Paragraph(title, heading_style))

        # Two-column detail grid
        def _row(label: str, value: str | None, muted: bool = False) -> list[Any]:
            if not value:
                return []
            lbl_style = ParagraphStyle(
                f"app_lbl_{i}_{label}",
                fontSize=7.5, leading=11, textColor=_SMOKE, fontName="Helvetica",
            )
            val_style = ParagraphStyle(
                f"app_val_{i}_{label}",
                fontSize=7.5, leading=11,
                textColor=_SMOKE if muted else _BLACK,
                fontName="Helvetica",
                wordWrap="LTR",
            )
            return [[Paragraph(label, lbl_style), Paragraph(value, val_style)]]

        inner_rows: list[list[Any]] = []

        status_val_style = ParagraphStyle(
            f"app_sv_{i}",
            fontSize=7.5, leading=11, textColor=status_color, fontName="Helvetica-Bold",
        )
        inner_rows.append([
            Paragraph("Status", ParagraphStyle(f"app_sl_{i}", fontSize=7.5, leading=11, textColor=_SMOKE, fontName="Helvetica")),
            Paragraph(status_label, status_val_style),
        ])

        inner_rows += _row("Measured", _fmt_value(row.actual_value, row.units))
        inner_rows += _row("Required", _fmt_required(row))
        if row.rule_code:
            inner_rows += _row("Rule code", row.rule_code)
        if row.metric_label:
            inner_rows += _row("Metric", row.metric_label)
        source_str = "Manual entry" if row.source_kind and row.source_kind.value == "manual" else "Extracted"
        inner_rows += _row("Origin", source_str)
        if row.description:
            inner_rows += _row("Description", row.description)
        if row.condition_text:
            inner_rows += _row("Condition", row.condition_text)
        if row.exception_text:
            inner_rows += _row("Exception", row.exception_text)
        if row.normalization_note:
            inner_rows += _row("Normalisation", row.normalization_note)
        if row.explanation:
            inner_rows += _row("Explanation", row.explanation)

        # Citation block
        citation_parts = []
        if row.citation_section:
            citation_parts.append(f"§{row.citation_section}")
        if row.citation_page is not None:
            citation_parts.append(f"p.{row.citation_page}")
        if citation_parts:
            inner_rows += _row("Citation", "  ".join(citation_parts))
        if row.citation_snippet:
            inner_rows += _row("Source text", f'"{row.citation_snippet}"', muted=True)

        if inner_rows:
            lw = _PAGE_W - 2 * _MARGIN
            tbl = Table(inner_rows, colWidths=[lw * 0.22, lw * 0.78])
            tbl.setStyle(TableStyle([
                ("FONTSIZE",      (0, 0), (-1, -1), 7.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING",    (0, 0), (-1, -1), 2),
                ("LEFTPADDING",   (0, 0), (0, -1),  0),
                ("LEFTPADDING",   (1, 0), (1, -1),  4),
                ("VALIGN",        (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 0), (-1, -1), [_LIGHT_GRAY, _WHITE]),
            ]))
            elems.append(tbl)

    return elems


def _build_issues_section(data: RunReportData, styles: dict[str, ParagraphStyle]) -> list[Any]:
    elems: list[Any] = []
    elems.append(Paragraph("Open Issues", styles["section_header"]))

    iso = data.issue_summary
    elems.append(Paragraph(
        f"Total issues: {iso.total}   |   Critical: {iso.critical}   "
        f"Error: {iso.error}   Warning: {iso.warning}   Info: {iso.info}",
        styles["body"],
    ))
    elems.append(Spacer(1, 2 * mm))

    if not data.top_issues:
        elems.append(Paragraph("No issues recorded for this run.", styles["body"]))
        elems += _hr(styles)
        return elems

    full_width = _PAGE_W - 2 * _MARGIN
    col_widths = [
        full_width * 0.10,   # Severity
        full_width * 0.28,   # Title
        full_width * 0.62,   # Summary / action
    ]

    headers = [
        Paragraph("Severity",  styles["cell"]),
        Paragraph("Issue",     styles["cell"]),
        Paragraph("Summary",   styles["cell"]),
    ]
    table_data: list[list[Any]] = [headers]

    for issue in data.top_issues:
        sev_label = _SEVERITY_LABELS.get(issue.severity, issue.severity.value)
        sev_color = _SEVERITY_COLORS.get(issue.severity, _MUTED)
        sev_style = ParagraphStyle(
            f"sev_{issue.id}",
            fontSize=8,
            leading=11,
            textColor=sev_color,
            fontName="Helvetica-Bold",
            wordWrap="LTR",
        )
        body = issue.summary
        if issue.recommended_action:
            body += f"  →  {issue.recommended_action}"
        table_data.append([
            Paragraph(sev_label, sev_style),
            Paragraph(issue.title, styles["cell"]),
            Paragraph(body, styles["cell"]),
        ])

    tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  _GRAPHITE),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  _WHITE),
        ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0),  8.5),
        ("BOTTOMPADDING", (0, 0), (-1, 0),  4),
        ("TOPPADDING",    (0, 0), (-1, 0),  4),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 1), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
        ("TOPPADDING",    (0, 1), (-1, -1), 3),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [_LIGHT_GRAY, _WHITE]),
        ("GRID",          (0, 0), (-1, -1), 0.4, _BORDER_GRAY),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    elems.append(tbl)
    elems += _hr(styles)
    return elems


def _build_checklist_section(data: RunReportData, styles: dict[str, ParagraphStyle]) -> list[Any]:
    elems: list[Any] = []
    elems.append(Paragraph("Permit Readiness Checklist", styles["section_header"]))

    cs = data.checklist_summary
    elems.append(Paragraph(
        f"Total items: {cs.total}   |   Resolved: {cs.resolved}   "
        f"Outstanding: {cs.unresolved}",
        styles["body"],
    ))
    elems.append(Spacer(1, 2 * mm))

    if not data.checklist_items:
        elems.append(Paragraph("No checklist items recorded for this run.", styles["body"]))
        elems += _hr(styles)
        return elems

    for item in data.checklist_items:
        resolved_marker = "✓" if item.resolved else "○"
        color = _GREEN if item.resolved else (_RED if item.required else _AMBER)
        req_tag = "" if not item.required else " (required)"
        style = ParagraphStyle(
            f"chk_{item.id}",
            fontSize=8.5,
            leading=12,
            textColor=color,
            fontName="Helvetica",
        )
        label = f"{resolved_marker}  [{item.category.value}]  {item.title}{req_tag}"
        elems.append(Paragraph(label, style))
        if item.description:
            elems.append(Paragraph(f"    {item.description}", styles["body_small"]))

    elems += _hr(styles)
    return elems


def _build_disclaimer_section(data: RunReportData, styles: dict[str, ParagraphStyle]) -> list[Any]:
    elems: list[Any] = []
    elems.append(Paragraph("Notes & Disclaimer", styles["section_header"]))

    disclaimers = [
        "This report was generated automatically by ArchAI based on the compliance run completed on "
        + data.run_created_at.strftime("%Y-%m-%d") + ".",

        "Only approved, reviewed, or manually entered rules are used as authoritative inputs for this "
        "compliance evaluation. Draft, rejected, or suspended rules are excluded.",

        "Rule values are extracted from regulatory documents using pattern matching. All extracted rules "
        "should be independently verified against the original source documents before submission.",

        "Compliance checks are deterministic evaluations of measurable building metrics (height, setbacks, "
        "FAR, lot coverage, parking). Qualitative, conditional, or non-numeric requirements are not covered "
        "and must be reviewed separately by a qualified professional.",

        "Some checks may show 'Not evaluable' if the required geometry data was not available in the "
        "model snapshot at the time of this run. These items require manual review.",

        "This report does not constitute legal or professional advice. It is a pre-check tool to assist "
        "architects and designers in identifying potential issues before formal submission. Final permit "
        "approval is determined solely by the relevant authority having jurisdiction (AHJ).",
    ]

    if data.is_stale:
        disclaimers.insert(0,
            "⚠  IMPORTANT: Rule approvals have changed since this compliance run was completed. "
            "The results in this report may not reflect the current authoritative rule set. "
            "Rerun compliance to generate an up-to-date report."
        )

    for text in disclaimers:
        elems.append(Paragraph(text, styles["disclaimer"]))
        elems.append(Spacer(1, 1 * mm))

    return elems


# ── Public API ────────────────────────────────────────────────────────────────

def generate_report_pdf(data: RunReportData) -> bytes:
    """
    Generate a PDF report from a RunReportData payload.

    Returns raw PDF bytes suitable for streaming as a FastAPI response.
    All content is derived deterministically from RunReportData — no LLM,
    no network calls, no filesystem writes.
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=_MARGIN,
        rightMargin=_MARGIN,
        topMargin=_MARGIN,
        bottomMargin=_MARGIN,
        title=data.run_name or "Compliance Report",
        author="ArchAI",
        subject="Permit Pre-Check Compliance Report",
    )

    styles = _build_styles()
    story: list[Any] = []

    story += _build_header_section(data, styles)
    story += _build_readiness_section(data, styles)
    story += _build_compliance_summary_section(data, styles)
    story += _build_detailed_results_section(data, styles)
    story += _build_issues_section(data, styles)
    story += _build_checklist_section(data, styles)
    story.append(PageBreak())
    story += _build_disclaimer_section(data, styles)
    if data.compliance_results:
        story.append(PageBreak())
        story += _build_rules_appendix_section(data, styles)

    doc.build(story)
    return buf.getvalue()
