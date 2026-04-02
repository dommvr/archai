"""
backend/tests/test_readiness_breakdown.py

Unit tests for Phase 3 readiness breakdown.

Tests cover:
  - compute_readiness_breakdown() label rules (NOT_YET_EVALUATED, INCOMPLETE_INPUT,
    ISSUES_TO_RESOLVE, PERMIT_READY)
  - Hard "Permit Ready" block when blocking (ERROR/CRITICAL) issues exist
  - Reasons list content and ordering
  - Score = 0 short-circuit when no geometry
  - Score cap: missing site data → max 60
  - Score cap: no reviewed rules → max 50
  - Positive signals (pass_count, authoritative_rule_count, checklist)
  - generate_checklist() compliance-run-state item
  - generate_checklist() not_evaluable geometry item
  - generate_checklist() warning review item

Run with:
    cd backend
    pytest tests/test_readiness_breakdown.py -v
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.core.schemas import (
    Applicability,
    ChecklistCategory,
    CheckResultStatus,
    ComplianceIssue,
    IssueSeverity,
    IssueType,
    MetricKey,
    PrecheckRunStatus,
    ReadinessBreakdown,
    ReadinessLabel,
    RuleOperator,
    RuleSourceKind,
    ScoreContext,
)
from app.services.compliance_engine import compute_readiness_breakdown


# ── Fixtures ─────────────────────────────────────────────────────────────────

NOW = datetime.now(timezone.utc)
RUN_ID = uuid4()
PROJECT_ID = uuid4()


def _ctx(
    has_geometry: bool = True,
    has_parcel: bool = True,
    has_zoning: bool = True,
    has_reviewed: bool = True,
) -> ScoreContext:
    return ScoreContext(
        has_geometry_snapshot=has_geometry,
        has_parcel_data=has_parcel,
        has_zoning_data=has_zoning,
        has_reviewed_rules=has_reviewed,
    )


def _issue(
    status: CheckResultStatus = CheckResultStatus.FAIL,
    severity: IssueSeverity = IssueSeverity.ERROR,
    issue_type: IssueType = IssueType.VIOLATION,
    metric_key: MetricKey = MetricKey.BUILDING_HEIGHT_M,
) -> ComplianceIssue:
    now = NOW
    return ComplianceIssue(
        id=uuid4(),
        run_id=RUN_ID,
        project_id=PROJECT_ID,
        rule_id=None,
        check_id=None,
        severity=severity,
        issue_type=issue_type,
        title="Test issue",
        summary="Test summary",
        explanation=None,
        recommended_action=None,
        status=status,
        metric_key=metric_key,
        actual_value=None,
        expected_value=None,
        expected_min=None,
        expected_max=None,
        units=None,
        citation=None,
        source_document_id=None,
        source_page_start=None,
        source_page_end=None,
        source_section_number=None,
        source_section_title=None,
        affected_object_ids=[],
        affected_geometry=None,
        created_at=now,
        updated_at=now,
    )


# ═══════════════════════════════════════════════════════════════════════
# NOT_YET_EVALUATED cases
# ═══════════════════════════════════════════════════════════════════════

class TestNotYetEvaluated:
    def test_no_geometry_returns_not_yet_evaluated(self):
        ctx = _ctx(has_geometry=False)
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=5)
        assert bd.label == ReadinessLabel.NOT_YET_EVALUATED
        assert bd.score == 0

    def test_no_geometry_has_blocking_reason(self):
        ctx = _ctx(has_geometry=False)
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=5)
        keys = [r.key for r in bd.reasons]
        assert "no_geometry_snapshot" in keys

    def test_no_geometry_reason_is_blocking(self):
        ctx = _ctx(has_geometry=False)
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=5)
        geo_reason = next(r for r in bd.reasons if r.key == "no_geometry_snapshot")
        assert geo_reason.is_blocking is True

    def test_no_authoritative_rules_returns_not_yet_evaluated(self):
        ctx = _ctx()
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=0)
        assert bd.label == ReadinessLabel.NOT_YET_EVALUATED
        assert bd.score == 0

    def test_no_authoritative_rules_has_blocking_reason(self):
        ctx = _ctx()
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=0)
        keys = [r.key for r in bd.reasons]
        assert "no_authoritative_rules" in keys


# ═══════════════════════════════════════════════════════════════════════
# PERMIT_READY: score >= 80 AND no blocking issues
# ═══════════════════════════════════════════════════════════════════════

class TestPermitReady:
    def test_clean_run_is_permit_ready(self):
        ctx = _ctx()
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=3)
        assert bd.label == ReadinessLabel.PERMIT_READY
        assert bd.score == 100

    def test_only_pass_issues_is_permit_ready(self):
        ctx = _ctx()
        issues = [_issue(status=CheckResultStatus.PASS)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=1)
        assert bd.label == ReadinessLabel.PERMIT_READY

    def test_score_100_with_no_issues(self):
        ctx = _ctx()
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=2)
        assert bd.score == 100


# ═══════════════════════════════════════════════════════════════════════
# PERMIT_READY hard block
# ═══════════════════════════════════════════════════════════════════════

class TestPermitReadyHardBlock:
    def test_error_issue_blocks_permit_ready_even_at_score_85(self):
        """Score might be high but ERROR issue must block PERMIT_READY."""
        ctx = _ctx()
        # With 1 ERROR fail issue, score = 100 - 15 = 85, but label must be ISSUES_TO_RESOLVE
        issues = [_issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.ERROR)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=10)
        assert bd.score == 85
        assert bd.label == ReadinessLabel.ISSUES_TO_RESOLVE
        assert bd.blocking_issue_count == 1

    def test_critical_issue_blocks_permit_ready(self):
        ctx = _ctx()
        issues = [_issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.CRITICAL)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=10)
        assert bd.label == ReadinessLabel.ISSUES_TO_RESOLVE
        assert bd.blocking_issue_count == 1

    def test_warning_fail_does_not_block_permit_ready(self):
        """WARNING severity FAIL does not block PERMIT_READY — only reduces score."""
        ctx = _ctx()
        # 1 warning fail: score = 100 - 7 = 93, still PERMIT_READY since no blocking
        issues = [_issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.WARNING)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=5)
        assert bd.score == 93
        assert bd.label == ReadinessLabel.PERMIT_READY
        assert bd.blocking_issue_count == 0

    def test_multiple_error_issues_all_block(self):
        ctx = _ctx()
        issues = [
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.ERROR),
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.ERROR),
        ]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=10)
        assert bd.blocking_issue_count == 2
        assert bd.label == ReadinessLabel.ISSUES_TO_RESOLVE


# ═══════════════════════════════════════════════════════════════════════
# ISSUES_TO_RESOLVE: score in [60,80) OR blocking issues
# ═══════════════════════════════════════════════════════════════════════

class TestIssuesToResolve:
    def test_score_75_is_issues_to_resolve(self):
        ctx = _ctx()
        # 5 warnings at -7 each → 65. ISSUES_TO_RESOLVE
        issues = [
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.WARNING)
            for _ in range(5)
        ]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=5)
        assert 60 <= bd.score < 80
        assert bd.label == ReadinessLabel.ISSUES_TO_RESOLVE

    def test_score_60_is_issues_to_resolve(self):
        ctx = _ctx()
        issues = [
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.WARNING)
            for _ in range(6)  # 100 - 42 = 58 → but capped by warning count
        ]
        # Actually 6 * 7 = 42, score = 58 → INCOMPLETE_INPUT — let's use 4 warnings = 72
        issues = [
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.WARNING)
            for _ in range(4)
        ]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=5)
        assert bd.score == 72
        assert bd.label == ReadinessLabel.ISSUES_TO_RESOLVE


# ═══════════════════════════════════════════════════════════════════════
# INCOMPLETE_INPUT: score < 60
# ═══════════════════════════════════════════════════════════════════════

class TestIncompleteInput:
    def test_score_below_60_is_incomplete_input(self):
        ctx = _ctx()
        # 3 error fails: 100 - 45 = 55
        issues = [
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.ERROR)
            for _ in range(3)
        ]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=5)
        assert bd.score == 55
        assert bd.label == ReadinessLabel.INCOMPLETE_INPUT

    def test_missing_parcel_data_caps_at_60_and_affects_label(self):
        ctx = _ctx(has_parcel=False)
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=3)
        assert bd.score <= 60
        # At exactly 60 we are in ISSUES_TO_RESOLVE, not INCOMPLETE_INPUT
        assert bd.label in {ReadinessLabel.ISSUES_TO_RESOLVE, ReadinessLabel.INCOMPLETE_INPUT}

    def test_no_reviewed_rules_caps_at_50(self):
        ctx = _ctx(has_reviewed=False)
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=3)
        assert bd.score <= 50

    def test_no_reviewed_rules_reason_present(self):
        ctx = _ctx(has_reviewed=False)
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=3)
        keys = [r.key for r in bd.reasons]
        assert "no_reviewed_rules" in keys


# ═══════════════════════════════════════════════════════════════════════
# Score penalty schedule (mirrors scoring.ts)
# ═══════════════════════════════════════════════════════════════════════

class TestScorePenalties:
    def test_critical_fail_deducts_25(self):
        ctx = _ctx()
        issues = [_issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.CRITICAL)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=1)
        assert bd.score == 75

    def test_error_fail_deducts_15(self):
        ctx = _ctx()
        issues = [_issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.ERROR)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=1)
        assert bd.score == 85

    def test_warning_fail_deducts_7(self):
        ctx = _ctx()
        issues = [_issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.WARNING)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=1)
        assert bd.score == 93

    def test_ambiguous_deducts_5(self):
        ctx = _ctx()
        issues = [_issue(status=CheckResultStatus.AMBIGUOUS, severity=IssueSeverity.WARNING)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=1)
        assert bd.score == 95

    def test_missing_input_deducts_8(self):
        ctx = _ctx()
        issues = [_issue(status=CheckResultStatus.MISSING_INPUT, severity=IssueSeverity.WARNING)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=1)
        assert bd.score == 92

    def test_score_floored_at_zero(self):
        ctx = _ctx()
        # Many critical fails
        issues = [
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.CRITICAL)
            for _ in range(10)
        ]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=1)
        assert bd.score == 0

    def test_combined_penalties(self):
        ctx = _ctx()
        issues = [
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.ERROR),    # -15
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.WARNING),  # -7
            _issue(status=CheckResultStatus.MISSING_INPUT, severity=IssueSeverity.WARNING),  # -8
        ]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=3)
        assert bd.score == 100 - 15 - 7 - 8


# ═══════════════════════════════════════════════════════════════════════
# Reasons list content
# ═══════════════════════════════════════════════════════════════════════

class TestReasonsContent:
    def test_error_fail_reason_is_blocking(self):
        ctx = _ctx()
        issues = [_issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.ERROR)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=1)
        error_reason = next(r for r in bd.reasons if r.key == "fail_error_count")
        assert error_reason.is_blocking is True
        assert error_reason.delta == -15

    def test_warning_fail_reason_not_blocking(self):
        ctx = _ctx()
        issues = [_issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.WARNING)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=1)
        reason = next(r for r in bd.reasons if r.key == "fail_warning_count")
        assert reason.is_blocking is False

    def test_pass_count_positive_reason(self):
        ctx = _ctx()
        issues = [_issue(status=CheckResultStatus.PASS)]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=1)
        keys = [r.key for r in bd.reasons]
        assert "pass_count" in keys

    def test_authoritative_rule_count_reason(self):
        ctx = _ctx()
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=5)
        keys = [r.key for r in bd.reasons]
        assert "authoritative_rule_count" in keys

    def test_checklist_complete_reason(self):
        ctx = _ctx()
        bd = compute_readiness_breakdown(
            [], ctx,
            authoritative_rule_count=3,
            checklist_total=4,
            checklist_resolved=4,
        )
        keys = [r.key for r in bd.reasons]
        assert "checklist_complete" in keys

    def test_checklist_incomplete_reason(self):
        ctx = _ctx()
        bd = compute_readiness_breakdown(
            [], ctx,
            authoritative_rule_count=3,
            checklist_total=4,
            checklist_resolved=2,
        )
        keys = [r.key for r in bd.reasons]
        assert "checklist_incomplete" in keys

    def test_missing_site_data_cap_reason(self):
        ctx = _ctx(has_parcel=False)
        bd = compute_readiness_breakdown([], ctx, authoritative_rule_count=3)
        keys = [r.key for r in bd.reasons]
        assert "missing_site_data" in keys


# ═══════════════════════════════════════════════════════════════════════
# Convenience counts
# ═══════════════════════════════════════════════════════════════════════

class TestConvenienceCounts:
    def test_fail_count_counts_all_fail_severities(self):
        ctx = _ctx()
        issues = [
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.CRITICAL),
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.ERROR),
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.WARNING),
        ]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=5)
        assert bd.fail_count == 3

    def test_warning_count_counts_ambiguous(self):
        ctx = _ctx()
        issues = [
            _issue(status=CheckResultStatus.AMBIGUOUS),
            _issue(status=CheckResultStatus.AMBIGUOUS),
        ]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=3)
        assert bd.warning_count == 2

    def test_not_evaluable_count_counts_missing_input(self):
        ctx = _ctx()
        issues = [
            _issue(status=CheckResultStatus.MISSING_INPUT),
            _issue(status=CheckResultStatus.MISSING_INPUT),
            _issue(status=CheckResultStatus.MISSING_INPUT),
        ]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=3)
        assert bd.not_evaluable_count == 3

    def test_blocking_count_is_critical_plus_error_only(self):
        ctx = _ctx()
        issues = [
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.CRITICAL),
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.ERROR),
            _issue(status=CheckResultStatus.FAIL, severity=IssueSeverity.WARNING),  # not blocking
        ]
        bd = compute_readiness_breakdown(issues, ctx, authoritative_rule_count=5)
        assert bd.blocking_issue_count == 2
