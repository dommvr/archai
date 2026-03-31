"""
backend/tests/test_compliance_engine.py

Unit tests for the deterministic compliance engine.

Tests run against the pure helper functions (_evaluate_single_rule,
calculate_readiness_score, _build_explanation) directly — no database,
no FastAPI, no network required.

Run with:
    cd backend
    pytest tests/test_compliance_engine.py -v
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.core.schemas import (
    Applicability,
    CheckResultStatus,
    ComplianceCheck,
    ComplianceIssue,
    ExtractedRule,
    IssueSeverity,
    MetricKey,
    RuleOperator,
    RuleSourceKind,
    RuleStatus,
    ScoreContext,
)
from app.services.compliance_engine import (
    _build_explanation,
    _evaluate_single_rule,
    calculate_readiness_score,
)


# ── Fixtures ─────────────────────────────────────────────────────────────────

NOW = datetime.now(timezone.utc)
PROJECT_ID = uuid4()
RUN_ID = uuid4()


def _make_rule(
    metric_key: MetricKey,
    operator: RuleOperator,
    value_number: float | None = None,
    value_min: float | None = None,
    value_max: float | None = None,
    units: str | None = None,
    status: RuleStatus = RuleStatus.APPROVED,
    source_kind: RuleSourceKind = RuleSourceKind.EXTRACTED,
    is_authoritative: bool = True,
    confidence: float = 0.95,
) -> ExtractedRule:
    """Factory for ExtractedRule test objects."""
    return ExtractedRule(
        id=uuid4(),
        project_id=PROJECT_ID,
        document_id=uuid4() if source_kind == RuleSourceKind.EXTRACTED else None,
        rule_code=f"TEST-{metric_key.value}",
        title=f"Test rule for {metric_key.value}",
        metric_key=metric_key,
        operator=operator,
        value_number=value_number,
        value_min=value_min,
        value_max=value_max,
        units=units,
        applicability=Applicability(),
        citation=None,
        confidence=confidence,
        status=status,
        source_kind=source_kind,
        is_authoritative=is_authoritative,
        created_at=NOW,
        updated_at=NOW,
    )


def _make_issue(
    status: CheckResultStatus,
    severity: IssueSeverity = IssueSeverity.ERROR,
) -> ComplianceIssue:
    return ComplianceIssue(
        id=uuid4(),
        run_id=RUN_ID,
        severity=severity,
        title="Test issue",
        summary="Test",
        status=status,
        created_at=NOW,
    )


# ═════════════════════════════════════════════════════════════════════════════
# Authority filter tests
# ═════════════════════════════════════════════════════════════════════════════

class TestAuthorityFilter:
    """
    Tests that non-authoritative rules are excluded by select_applicable_rules
    before reaching _evaluate_single_rule.  We test the defence-in-depth path:
    if a non-authoritative rule slips through, the evaluator emits AMBIGUOUS,
    never PASS or FAIL.
    """

    def test_non_authoritative_rule_is_ambiguous_not_fail(self) -> None:
        """A non-authoritative approved-looking rule must produce AMBIGUOUS."""
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.LTE,
            value_number=10.0,
            units="m",
            is_authoritative=False,  # key: not authoritative
        )
        metric_map = {MetricKey.BUILDING_HEIGHT_M: 50.0}  # clear violation
        check = _evaluate_single_rule(RUN_ID, rule, metric_map, NOW)
        assert check.status == CheckResultStatus.AMBIGUOUS

    def test_authoritative_approved_rule_is_evaluated(self) -> None:
        """An authoritative approved rule must produce PASS or FAIL, not AMBIGUOUS."""
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.LTE,
            value_number=35.0,
            units="ft",
            is_authoritative=True,
            status=RuleStatus.APPROVED,
        )
        metric_map = {MetricKey.BUILDING_HEIGHT_M: 20.0}  # pass
        check = _evaluate_single_rule(RUN_ID, rule, metric_map, NOW)
        assert check.status == CheckResultStatus.PASS

    def test_manual_rule_is_evaluated(self) -> None:
        """Manual rules are always authoritative and must be evaluated."""
        rule = _make_rule(
            metric_key=MetricKey.FRONT_SETBACK_M,
            operator=RuleOperator.GTE,
            value_number=5.0,
            units="m",
            source_kind=RuleSourceKind.MANUAL,
            is_authoritative=True,
            status=RuleStatus.APPROVED,
        )
        metric_map = {MetricKey.FRONT_SETBACK_M: 3.0}  # fail
        check = _evaluate_single_rule(RUN_ID, rule, metric_map, NOW)
        assert check.status == CheckResultStatus.FAIL

    def test_draft_low_confidence_legacy_is_ambiguous(self) -> None:
        """
        Pre-migration legacy rows: is_authoritative=None + DRAFT + low confidence
        must still be AMBIGUOUS rather than producing a hard PASS/FAIL.
        """
        rule = _make_rule(
            metric_key=MetricKey.FAR,
            operator=RuleOperator.LTE,
            value_number=2.0,
            status=RuleStatus.DRAFT,
            confidence=0.5,  # below 0.6 threshold
            is_authoritative=False,  # simulate pre-migration None via False
        )
        metric_map = {MetricKey.FAR: 3.0}
        check = _evaluate_single_rule(RUN_ID, rule, metric_map, NOW)
        assert check.status == CheckResultStatus.AMBIGUOUS


# ═════════════════════════════════════════════════════════════════════════════
# Metric evaluation: max_height (LTE)
# ═════════════════════════════════════════════════════════════════════════════

class TestMaxHeightEvaluation:

    def test_height_pass(self) -> None:
        """Building height within limit → PASS."""
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.LTE,
            value_number=35.0,
            units="ft",
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.BUILDING_HEIGHT_M: 30.0}, NOW)
        assert check.status == CheckResultStatus.PASS
        assert check.actual_value == 30.0
        assert check.expected_value == 35.0

    def test_height_fail(self) -> None:
        """Building height exceeds limit → FAIL."""
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.LTE,
            value_number=35.0,
            units="ft",
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.BUILDING_HEIGHT_M: 38.2}, NOW)
        assert check.status == CheckResultStatus.FAIL
        assert check.actual_value == 38.2
        assert check.expected_value == 35.0

    def test_height_exactly_at_limit_passes(self) -> None:
        """Height exactly equal to LTE threshold → PASS."""
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.LTE,
            value_number=35.0,
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.BUILDING_HEIGHT_M: 35.0}, NOW)
        assert check.status == CheckResultStatus.PASS

    def test_height_explanation_on_fail(self) -> None:
        """FAIL check must produce a non-empty explanation mentioning the values."""
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.LTE,
            value_number=35.0,
            units="ft",
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.BUILDING_HEIGHT_M: 38.2}, NOW)
        assert check.explanation is not None
        assert "38.2" in check.explanation
        assert "35.0" in check.explanation

    def test_height_explanation_on_pass(self) -> None:
        """PASS check must produce a non-empty explanation."""
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.LTE,
            value_number=35.0,
            units="ft",
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.BUILDING_HEIGHT_M: 30.0}, NOW)
        assert check.explanation is not None
        assert len(check.explanation) > 0


# ═════════════════════════════════════════════════════════════════════════════
# Missing metric
# ═════════════════════════════════════════════════════════════════════════════

class TestMissingMetric:

    def test_missing_metric_is_missing_input(self) -> None:
        """When metric absent from snapshot → MISSING_INPUT, never FAIL."""
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.LTE,
            value_number=35.0,
        )
        check = _evaluate_single_rule(RUN_ID, rule, {}, NOW)
        assert check.status == CheckResultStatus.MISSING_INPUT
        assert check.actual_value is None

    def test_missing_metric_has_explanation(self) -> None:
        """MISSING_INPUT check must include an explanation."""
        rule = _make_rule(
            metric_key=MetricKey.REAR_SETBACK_M,
            operator=RuleOperator.GTE,
            value_number=6.0,
        )
        check = _evaluate_single_rule(RUN_ID, rule, {}, NOW)
        assert check.explanation is not None
        assert len(check.explanation) > 0


# ═════════════════════════════════════════════════════════════════════════════
# Setback evaluations (GTE)
# ═════════════════════════════════════════════════════════════════════════════

class TestSetbackEvaluation:

    def test_front_setback_pass(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.FRONT_SETBACK_M,
            operator=RuleOperator.GTE,
            value_number=5.0,
            units="m",
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.FRONT_SETBACK_M: 7.0}, NOW)
        assert check.status == CheckResultStatus.PASS

    def test_front_setback_fail(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.FRONT_SETBACK_M,
            operator=RuleOperator.GTE,
            value_number=5.0,
            units="m",
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.FRONT_SETBACK_M: 3.0}, NOW)
        assert check.status == CheckResultStatus.FAIL

    def test_side_setback_exactly_at_min_passes(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.SIDE_SETBACK_LEFT_M,
            operator=RuleOperator.GTE,
            value_number=2.5,
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.SIDE_SETBACK_LEFT_M: 2.5}, NOW)
        assert check.status == CheckResultStatus.PASS


# ═════════════════════════════════════════════════════════════════════════════
# FAR / lot coverage (LTE)
# ═════════════════════════════════════════════════════════════════════════════

class TestFarAndLotCoverage:

    def test_far_pass(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.FAR,
            operator=RuleOperator.LTE,
            value_number=2.0,
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.FAR: 1.8}, NOW)
        assert check.status == CheckResultStatus.PASS

    def test_far_fail(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.FAR,
            operator=RuleOperator.LTE,
            value_number=2.0,
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.FAR: 2.5}, NOW)
        assert check.status == CheckResultStatus.FAIL

    def test_lot_coverage_pass(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.LOT_COVERAGE_PCT,
            operator=RuleOperator.LTE,
            value_number=60.0,
            units="%",
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.LOT_COVERAGE_PCT: 55.0}, NOW)
        assert check.status == CheckResultStatus.PASS

    def test_lot_coverage_fail(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.LOT_COVERAGE_PCT,
            operator=RuleOperator.LTE,
            value_number=60.0,
            units="%",
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.LOT_COVERAGE_PCT: 72.0}, NOW)
        assert check.status == CheckResultStatus.FAIL


# ═════════════════════════════════════════════════════════════════════════════
# BETWEEN operator
# ═════════════════════════════════════════════════════════════════════════════

class TestBetweenOperator:

    def test_between_pass_inside_range(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.BETWEEN,
            value_min=5.0,
            value_max=30.0,
            units="m",
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.BUILDING_HEIGHT_M: 15.0}, NOW)
        assert check.status == CheckResultStatus.PASS

    def test_between_fail_below_min(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.BETWEEN,
            value_min=5.0,
            value_max=30.0,
            units="m",
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.BUILDING_HEIGHT_M: 3.0}, NOW)
        assert check.status == CheckResultStatus.FAIL

    def test_between_fail_above_max(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.BETWEEN,
            value_min=5.0,
            value_max=30.0,
            units="m",
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.BUILDING_HEIGHT_M: 35.0}, NOW)
        assert check.status == CheckResultStatus.FAIL

    def test_between_incomplete_values_is_ambiguous(self) -> None:
        """BETWEEN with missing value_max → operator can't evaluate → AMBIGUOUS."""
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.BETWEEN,
            value_min=5.0,
            value_max=None,  # incomplete
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.BUILDING_HEIGHT_M: 15.0}, NOW)
        assert check.status == CheckResultStatus.AMBIGUOUS


# ═════════════════════════════════════════════════════════════════════════════
# Parking — not_evaluable behaviour
# ═════════════════════════════════════════════════════════════════════════════

class TestParkingNotEvaluable:

    def test_parking_missing_metric_is_missing_input(self) -> None:
        """Parking metric absent from snapshot → MISSING_INPUT."""
        rule = _make_rule(
            metric_key=MetricKey.PARKING_SPACES_REQUIRED,
            operator=RuleOperator.LTE,
            value_number=50.0,
        )
        check = _evaluate_single_rule(RUN_ID, rule, {}, NOW)
        assert check.status == CheckResultStatus.MISSING_INPUT

    def test_parking_provided_evaluates_when_available(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.PARKING_SPACES_PROVIDED,
            operator=RuleOperator.GTE,
            value_number=20.0,
        )
        check = _evaluate_single_rule(
            RUN_ID, rule,
            {MetricKey.PARKING_SPACES_PROVIDED: 25.0},
            NOW,
        )
        assert check.status == CheckResultStatus.PASS


# ═════════════════════════════════════════════════════════════════════════════
# Explanation generation
# ═════════════════════════════════════════════════════════════════════════════

class TestBuildExplanation:

    def test_lte_fail_mentions_exceeds(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.LTE,
            value_number=35.0,
            units="ft",
        )
        text = _build_explanation(rule, actual=38.2, passed=False)
        assert "exceed" in text.lower()
        assert "38.2" in text
        assert "35.0" in text

    def test_gte_fail_mentions_below(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.FRONT_SETBACK_M,
            operator=RuleOperator.GTE,
            value_number=5.0,
            units="m",
        )
        text = _build_explanation(rule, actual=3.0, passed=False)
        assert "below" in text.lower() or "minimum" in text.lower()

    def test_between_fail_mentions_range(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.BETWEEN,
            value_min=5.0,
            value_max=30.0,
        )
        text = _build_explanation(rule, actual=35.0, passed=False)
        assert "5.0" in text
        assert "30.0" in text

    def test_pass_explanation_is_non_empty(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.FAR,
            operator=RuleOperator.LTE,
            value_number=2.0,
        )
        text = _build_explanation(rule, actual=1.5, passed=True)
        assert len(text) > 0


# ═════════════════════════════════════════════════════════════════════════════
# Readiness score
# ═════════════════════════════════════════════════════════════════════════════

class TestReadinessScore:

    def _ctx(
        self,
        parcel: bool = True,
        zoning: bool = True,
        reviewed: bool = True,
        geometry: bool = True,
    ) -> ScoreContext:
        return ScoreContext(
            has_parcel_data=parcel,
            has_zoning_data=zoning,
            has_reviewed_rules=reviewed,
            has_geometry_snapshot=geometry,
        )

    def test_zero_issues_full_context_is_100(self) -> None:
        score = calculate_readiness_score([], self._ctx())
        assert score == 100

    def test_no_geometry_snapshot_is_zero(self) -> None:
        score = calculate_readiness_score([], self._ctx(geometry=False))
        assert score == 0

    def test_single_error_fail_deducts_15(self) -> None:
        issues = [_make_issue(CheckResultStatus.FAIL, IssueSeverity.ERROR)]
        score = calculate_readiness_score(issues, self._ctx())
        assert score == 85

    def test_single_critical_fail_deducts_25(self) -> None:
        issues = [_make_issue(CheckResultStatus.FAIL, IssueSeverity.CRITICAL)]
        score = calculate_readiness_score(issues, self._ctx())
        assert score == 75

    def test_ambiguous_deducts_5(self) -> None:
        issues = [_make_issue(CheckResultStatus.AMBIGUOUS, IssueSeverity.WARNING)]
        score = calculate_readiness_score(issues, self._ctx())
        assert score == 95

    def test_missing_input_deducts_8(self) -> None:
        issues = [_make_issue(CheckResultStatus.MISSING_INPUT, IssueSeverity.WARNING)]
        score = calculate_readiness_score(issues, self._ctx())
        assert score == 92

    def test_no_parcel_data_caps_at_60(self) -> None:
        score = calculate_readiness_score([], self._ctx(parcel=False))
        assert score == 60

    def test_no_reviewed_rules_caps_at_50(self) -> None:
        score = calculate_readiness_score([], self._ctx(reviewed=False))
        assert score == 50

    def test_both_caps_applied_gives_lower_cap(self) -> None:
        # no parcel (cap 60) + no reviewed (cap 50) → 50
        score = calculate_readiness_score([], self._ctx(parcel=False, reviewed=False))
        assert score == 50

    def test_score_floor_at_zero(self) -> None:
        issues = [
            _make_issue(CheckResultStatus.FAIL, IssueSeverity.CRITICAL)
            for _ in range(10)
        ]
        score = calculate_readiness_score(issues, self._ctx())
        assert score == 0
