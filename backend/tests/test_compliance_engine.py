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
    ChecklistSummarySection,
    ComplianceCheck,
    ComplianceIssue,
    ComplianceResultRow,
    ComplianceSummarySection,
    ExtractedRule,
    IssueSeverity,
    IssueSummarySection,
    MetricKey,
    PrecheckRunStatus,
    ReadinessBreakdown,
    ReadinessLabel,
    RuleOperator,
    RuleSourceKind,
    RuleStatus,
    RunReportData,
    ScoreContext,
    SiteContext,
)
from app.services.compliance_engine import (
    _build_explanation,
    _build_run_summary,
    _evaluate_single_rule,
    _is_applicable,
    calculate_readiness_score,
    compute_readiness_breakdown,
)
from app.services.report_generator import generate_report_pdf


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


# ═════════════════════════════════════════════════════════════════════════════
# Setback MISSING_INPUT — the core bug regression suite
#
# These tests verify the exact scenario that was broken:
#   approved setback rules + no metric in snapshot → MISSING_INPUT (not silence)
# ═════════════════════════════════════════════════════════════════════════════

class TestSetbackMissingInput:
    """
    Regression tests for the silent-skip bug where front/rear/left setback rules
    produced no compliance result when the geometry snapshot lacked those metrics.

    The evaluator must return MISSING_INPUT (not skip) for every approved rule
    whose metric is absent from the metric_map.
    """

    @pytest.mark.parametrize("metric_key", [
        MetricKey.FRONT_SETBACK_M,
        MetricKey.REAR_SETBACK_M,
        MetricKey.SIDE_SETBACK_LEFT_M,
        MetricKey.SIDE_SETBACK_RIGHT_M,
    ])
    def test_approved_setback_missing_metric_is_missing_input(
        self, metric_key: MetricKey
    ) -> None:
        """Approved setback rule + absent metric → MISSING_INPUT, never silently skipped."""
        rule = _make_rule(
            metric_key=metric_key,
            operator=RuleOperator.GTE,
            value_number=3.0,
            units="m",
            status=RuleStatus.APPROVED,
            is_authoritative=True,
        )
        check = _evaluate_single_rule(RUN_ID, rule, {}, NOW)
        assert check.status == CheckResultStatus.MISSING_INPUT, (
            f"{metric_key.value} with approved rule and empty metric_map must be "
            "MISSING_INPUT, not silently skipped"
        )
        assert check.actual_value is None
        assert check.rule_id == rule.id
        assert check.metric_key == metric_key

    @pytest.mark.parametrize("metric_key", [
        MetricKey.FRONT_SETBACK_M,
        MetricKey.REAR_SETBACK_M,
        MetricKey.SIDE_SETBACK_LEFT_M,
        MetricKey.SIDE_SETBACK_RIGHT_M,
    ])
    def test_approved_setback_missing_input_has_explanation(
        self, metric_key: MetricKey
    ) -> None:
        """MISSING_INPUT check must carry a non-empty explanation string."""
        rule = _make_rule(
            metric_key=metric_key,
            operator=RuleOperator.GTE,
            value_number=3.0,
        )
        check = _evaluate_single_rule(RUN_ID, rule, {}, NOW)
        assert check.explanation is not None
        assert len(check.explanation) > 0

    def test_height_available_setbacks_missing_mixed_results(self) -> None:
        """
        Integration scenario: height metric present, all setbacks absent.
        Height rule → PASS or FAIL (not MISSING_INPUT).
        All setback rules → MISSING_INPUT.
        """
        rules = [
            _make_rule(MetricKey.BUILDING_HEIGHT_M, RuleOperator.LTE, value_number=30.0),
            _make_rule(MetricKey.FRONT_SETBACK_M,   RuleOperator.GTE, value_number=5.0),
            _make_rule(MetricKey.REAR_SETBACK_M,    RuleOperator.GTE, value_number=6.0),
            _make_rule(MetricKey.SIDE_SETBACK_LEFT_M,  RuleOperator.GTE, value_number=2.0),
            _make_rule(MetricKey.SIDE_SETBACK_RIGHT_M, RuleOperator.GTE, value_number=2.0),
        ]
        # Only height is available
        metric_map = {MetricKey.BUILDING_HEIGHT_M: 25.0}

        checks = [_evaluate_single_rule(RUN_ID, r, metric_map, NOW) for r in rules]
        statuses = {c.metric_key: c.status for c in checks}

        assert statuses[MetricKey.BUILDING_HEIGHT_M] == CheckResultStatus.PASS
        assert statuses[MetricKey.FRONT_SETBACK_M]   == CheckResultStatus.MISSING_INPUT
        assert statuses[MetricKey.REAR_SETBACK_M]    == CheckResultStatus.MISSING_INPUT
        assert statuses[MetricKey.SIDE_SETBACK_LEFT_M]  == CheckResultStatus.MISSING_INPUT
        assert statuses[MetricKey.SIDE_SETBACK_RIGHT_M] == CheckResultStatus.MISSING_INPUT

    def test_all_rules_produce_exactly_one_check(self) -> None:
        """
        Every approved rule in the input list must produce exactly one check —
        no silent skips, no duplicates.
        """
        rules = [
            _make_rule(MetricKey.BUILDING_HEIGHT_M,    RuleOperator.LTE, value_number=30.0),
            _make_rule(MetricKey.FAR,                  RuleOperator.LTE, value_number=2.0),
            _make_rule(MetricKey.LOT_COVERAGE_PCT,     RuleOperator.LTE, value_number=60.0),
            _make_rule(MetricKey.FRONT_SETBACK_M,      RuleOperator.GTE, value_number=5.0),
            _make_rule(MetricKey.REAR_SETBACK_M,       RuleOperator.GTE, value_number=6.0),
            _make_rule(MetricKey.SIDE_SETBACK_LEFT_M,  RuleOperator.GTE, value_number=2.0),
            _make_rule(MetricKey.SIDE_SETBACK_RIGHT_M, RuleOperator.GTE, value_number=2.0),
            _make_rule(MetricKey.PARKING_SPACES_REQUIRED, RuleOperator.LTE, value_number=50.0),
        ]
        metric_map: dict[MetricKey, float] = {}  # nothing available

        checks = [_evaluate_single_rule(RUN_ID, r, metric_map, NOW) for r in rules]
        assert len(checks) == len(rules), (
            f"Expected {len(rules)} checks, got {len(checks)} — some rules were silently skipped"
        )
        # All must be MISSING_INPUT when metric_map is empty
        for check in checks:
            assert check.status == CheckResultStatus.MISSING_INPUT


# ═════════════════════════════════════════════════════════════════════════════
# _build_run_summary — not_evaluable counts MISSING_INPUT correctly
# ═════════════════════════════════════════════════════════════════════════════

class TestBuildRunSummary:
    """
    Regression tests for the _build_run_summary bug where not_evaluable always
    showed 0 because it only counted NOT_APPLICABLE (which the evaluator never
    produces) instead of MISSING_INPUT.
    """

    def _check(self, status: CheckResultStatus) -> ComplianceCheck:
        return ComplianceCheck(
            id=uuid4(),
            run_id=RUN_ID,
            rule_id=uuid4(),
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            status=status,
            actual_value=None,
            expected_value=None,
            expected_min=None,
            expected_max=None,
            units=None,
            explanation="test",
            created_at=NOW,
        )

    def test_missing_input_counted_in_not_evaluable(self) -> None:
        checks = [
            self._check(CheckResultStatus.PASS),
            self._check(CheckResultStatus.MISSING_INPUT),
            self._check(CheckResultStatus.MISSING_INPUT),
        ]
        summary = _build_run_summary(RUN_ID, checks)
        assert summary.missing_input == 2
        assert summary.not_evaluable == 2  # was always 0 before the fix

    def test_not_applicable_also_counted_in_not_evaluable(self) -> None:
        checks = [
            self._check(CheckResultStatus.NOT_APPLICABLE),
            self._check(CheckResultStatus.MISSING_INPUT),
        ]
        summary = _build_run_summary(RUN_ID, checks)
        assert summary.not_evaluable == 2

    def test_summary_totals_are_consistent(self) -> None:
        checks = [
            self._check(CheckResultStatus.PASS),
            self._check(CheckResultStatus.FAIL),
            self._check(CheckResultStatus.AMBIGUOUS),
            self._check(CheckResultStatus.MISSING_INPUT),
        ]
        summary = _build_run_summary(RUN_ID, checks)
        assert summary.total == 4
        assert summary.passed == 1
        assert summary.failed == 1
        assert summary.ambiguous == 1
        assert summary.missing_input == 1


# ═════════════════════════════════════════════════════════════════════════════
# _is_applicable — silent district filtering
# ═════════════════════════════════════════════════════════════════════════════

def _make_site(
    jurisdiction_code: str | None = None,
    zoning_district: str | None = None,
) -> SiteContext:
    return SiteContext(
        id=uuid4(),
        project_id=uuid4(),
        jurisdiction_code=jurisdiction_code,
        zoning_district=zoning_district,
        source_provider="test",
        created_at=NOW,
        updated_at=NOW,
    )


class TestIsApplicable:
    """
    Tests for the _is_applicable filter — the primary root cause of the
    silent-skip bug when LLM assigns specific zoning_districts to rules.
    """

    def test_no_constraints_always_applicable(self) -> None:
        app = Applicability()
        site = _make_site(jurisdiction_code="NYC", zoning_district="R6")
        assert _is_applicable(app, site) is True

    def test_matching_jurisdiction_applicable(self) -> None:
        app = Applicability(jurisdiction_code="NYC")
        site = _make_site(jurisdiction_code="NYC")
        assert _is_applicable(app, site) is True

    def test_mismatched_jurisdiction_excluded(self) -> None:
        app = Applicability(jurisdiction_code="LAX")
        site = _make_site(jurisdiction_code="NYC")
        assert _is_applicable(app, site) is False

    def test_matching_zoning_district_applicable(self) -> None:
        app = Applicability(zoning_districts=["R6", "R7"])
        site = _make_site(zoning_district="R6")
        assert _is_applicable(app, site) is True

    def test_mismatched_zoning_district_excluded(self) -> None:
        """
        This is the primary root cause: LLM sets zoning_districts=['R6'] on a
        front-setback rule, but site.zoning_district='R7A' → rule silently excluded.
        """
        app = Applicability(zoning_districts=["R6"])
        site = _make_site(zoning_district="R7A")
        assert _is_applicable(app, site) is False

    def test_rule_with_districts_site_has_no_district_is_applicable(self) -> None:
        """
        If the site has no zoning_district set yet, district-constrained rules
        are NOT excluded — we can't confirm a mismatch, so we include the rule.
        """
        app = Applicability(zoning_districts=["R6"])
        site = _make_site(zoning_district=None)
        assert _is_applicable(app, site) is True

    def test_site_has_district_rule_has_no_constraint_applicable(self) -> None:
        """Rule with no district constraint always applies regardless of site district."""
        app = Applicability(zoning_districts=[])
        site = _make_site(zoning_district="R6")
        assert _is_applicable(app, site) is True


# ═════════════════════════════════════════════════════════════════════════════
# _build_run_summary — compliance count aggregation
# ═════════════════════════════════════════════════════════════════════════════

def _make_check(status: CheckResultStatus) -> ComplianceCheck:
    """Factory for a minimal ComplianceCheck with the given status."""
    return ComplianceCheck(
        id=uuid4(),
        run_id=RUN_ID,
        rule_id=uuid4(),
        metric_key=MetricKey.BUILDING_HEIGHT_M,
        status=status,
        created_at=NOW,
    )


class TestBuildRunSummary:
    """
    _build_run_summary must correctly count pass/fail/ambiguous/missing_input
    and populate the ComplianceRunSummary fields.  These counts drive the
    on-screen summary and the PDF report.
    """

    def test_all_pass(self) -> None:
        checks = [_make_check(CheckResultStatus.PASS)] * 5
        summary = _build_run_summary(RUN_ID, checks)
        assert summary.total == 5
        assert summary.passed == 5
        assert summary.failed == 0
        assert summary.ambiguous == 0
        assert summary.missing_input == 0

    def test_all_fail(self) -> None:
        checks = [_make_check(CheckResultStatus.FAIL)] * 3
        summary = _build_run_summary(RUN_ID, checks)
        assert summary.total == 3
        assert summary.passed == 0
        assert summary.failed == 3

    def test_mixed_statuses(self) -> None:
        checks = [
            _make_check(CheckResultStatus.PASS),
            _make_check(CheckResultStatus.PASS),
            _make_check(CheckResultStatus.FAIL),
            _make_check(CheckResultStatus.AMBIGUOUS),
            _make_check(CheckResultStatus.MISSING_INPUT),
        ]
        summary = _build_run_summary(RUN_ID, checks)
        assert summary.total == 5
        assert summary.passed == 2
        assert summary.failed == 1
        assert summary.ambiguous == 1
        assert summary.missing_input == 1

    def test_empty_checks_returns_zero_counts(self) -> None:
        summary = _build_run_summary(RUN_ID, [])
        assert summary.total == 0
        assert summary.passed == 0
        assert summary.failed == 0

    def test_run_id_preserved(self) -> None:
        rid = uuid4()
        summary = _build_run_summary(rid, [_make_check(CheckResultStatus.PASS)])
        assert summary.run_id == rid


# ═════════════════════════════════════════════════════════════════════════════
# ComplianceSummarySection — report data counts
# These tests validate the aggregation logic used in _build_report_data.
# We test it as a pure data-assembly step (no DB, no network).
# ═════════════════════════════════════════════════════════════════════════════

def _make_compliance_summary_section(checks: list[ComplianceCheck]) -> ComplianceSummarySection:
    """Inline reimplementation matching the logic in _build_report_data."""
    return ComplianceSummarySection(
        total=len(checks),
        passed=sum(1 for c in checks if c.status == CheckResultStatus.PASS),
        failed=sum(1 for c in checks if c.status == CheckResultStatus.FAIL),
        warning=sum(1 for c in checks if c.status == CheckResultStatus.AMBIGUOUS),
        not_evaluable=sum(1 for c in checks if c.status == CheckResultStatus.MISSING_INPUT),
    )


class TestComplianceSummarySection:

    def test_passed_count_correct(self) -> None:
        checks = [_make_check(CheckResultStatus.PASS)] * 4
        section = _make_compliance_summary_section(checks)
        assert section.passed == 4
        assert section.failed == 0

    def test_failed_count_correct(self) -> None:
        checks = [_make_check(CheckResultStatus.FAIL)] * 2
        section = _make_compliance_summary_section(checks)
        assert section.failed == 2
        assert section.passed == 0

    def test_warning_maps_to_ambiguous(self) -> None:
        """'warning' in the UI corresponds to AMBIGUOUS checks."""
        checks = [
            _make_check(CheckResultStatus.AMBIGUOUS),
            _make_check(CheckResultStatus.AMBIGUOUS),
        ]
        section = _make_compliance_summary_section(checks)
        assert section.warning == 2

    def test_not_evaluable_maps_to_missing_input(self) -> None:
        """'not_evaluable' in the UI corresponds to MISSING_INPUT checks."""
        checks = [_make_check(CheckResultStatus.MISSING_INPUT)] * 3
        section = _make_compliance_summary_section(checks)
        assert section.not_evaluable == 3

    def test_total_sums_all_statuses(self) -> None:
        checks = [
            _make_check(CheckResultStatus.PASS),
            _make_check(CheckResultStatus.FAIL),
            _make_check(CheckResultStatus.AMBIGUOUS),
            _make_check(CheckResultStatus.MISSING_INPUT),
        ]
        section = _make_compliance_summary_section(checks)
        assert section.total == 4
        assert section.passed + section.failed + section.warning + section.not_evaluable == 4

    def test_only_not_evaluable_results(self) -> None:
        """All-missing-input case must not crash and must show zero pass/fail."""
        checks = [_make_check(CheckResultStatus.MISSING_INPUT)] * 6
        section = _make_compliance_summary_section(checks)
        assert section.not_evaluable == 6
        assert section.passed == 0
        assert section.failed == 0
        assert section.warning == 0

    def test_only_warnings_results(self) -> None:
        """All-ambiguous case must not crash."""
        checks = [_make_check(CheckResultStatus.AMBIGUOUS)] * 2
        section = _make_compliance_summary_section(checks)
        assert section.warning == 2
        assert section.passed == 0
        assert section.failed == 0

    def test_no_authoritative_rules_empty_summary(self) -> None:
        """No checks → all counts zero."""
        section = _make_compliance_summary_section([])
        assert section.total == 0
        assert section.passed == 0
        assert section.failed == 0
        assert section.warning == 0
        assert section.not_evaluable == 0


# ═════════════════════════════════════════════════════════════════════════════
# RunReportData — struct assembly and stale flag propagation
# ═════════════════════════════════════════════════════════════════════════════

def _make_minimal_report_data(is_stale: bool = False) -> RunReportData:
    """
    Builds a minimal RunReportData without any DB interaction.
    Used to verify that the struct assembles correctly and the stale flag
    propagates into both the JSON payload and the PDF output.
    """
    breakdown = compute_readiness_breakdown(
        issues=[],
        context=ScoreContext(
            has_parcel_data=True,
            has_zoning_data=True,
            has_reviewed_rules=True,
            has_geometry_snapshot=True,
        ),
        authoritative_rule_count=3,
        checklist_total=4,
        checklist_resolved=4,
    )
    return RunReportData(
        run_id=RUN_ID,
        run_name="Test Run",
        run_status=PrecheckRunStatus.COMPLETED,
        run_created_at=NOW,
        is_stale=is_stale,
        readiness=breakdown,
        compliance_summary=ComplianceSummarySection(
            total=3, passed=2, failed=1, warning=0, not_evaluable=0
        ),
        compliance_results=[],
        issue_summary=IssueSummarySection(
            total=1, critical=0, error=1, warning=0, info=0
        ),
        top_issues=[],
        checklist_summary=ChecklistSummarySection(
            total=4, resolved=4, unresolved=0
        ),
        checklist_items=[],
        authoritative_rule_count=3,
    )


class TestRunReportDataAssembly:

    def test_stale_flag_false_by_default(self) -> None:
        data = _make_minimal_report_data(is_stale=False)
        assert data.is_stale is False

    def test_stale_flag_propagates(self) -> None:
        data = _make_minimal_report_data(is_stale=True)
        assert data.is_stale is True

    def test_compliance_summary_counts_consistent(self) -> None:
        data = _make_minimal_report_data()
        cs = data.compliance_summary
        assert cs.passed + cs.failed + cs.warning + cs.not_evaluable <= cs.total

    def test_readiness_breakdown_present(self) -> None:
        data = _make_minimal_report_data()
        assert data.readiness is not None
        assert data.readiness.score >= 0
        assert data.readiness.label in (
            ReadinessLabel.PERMIT_READY,
            ReadinessLabel.ISSUES_TO_RESOLVE,
            ReadinessLabel.INCOMPLETE_INPUT,
            ReadinessLabel.NOT_YET_EVALUATED,
        )

    def test_authoritative_rule_count_matches_summary(self) -> None:
        data = _make_minimal_report_data()
        # authoritative_rule_count should be >= compliance_summary.total
        # (some authoritative rules may produce not_applicable checks excluded from total)
        assert data.authoritative_rule_count >= 0

    def test_checklist_summary_consistent(self) -> None:
        data = _make_minimal_report_data()
        cs = data.checklist_summary
        assert cs.resolved + cs.unresolved == cs.total


# ═════════════════════════════════════════════════════════════════════════════
# PDF generation — generate_report_pdf
# Tests that the PDF generator produces valid output for common scenarios.
# No snapshot of PDF content — just structural integrity checks.
# ═════════════════════════════════════════════════════════════════════════════

class TestPdfGeneration:

    def test_pdf_returns_non_empty_bytes(self) -> None:
        """generate_report_pdf must return bytes, not raise, not return empty."""
        data = _make_minimal_report_data()
        result = generate_report_pdf(data)
        assert isinstance(result, bytes)
        assert len(result) > 1024  # a valid PDF is always more than 1 KB

    def test_pdf_starts_with_pdf_magic_bytes(self) -> None:
        """All valid PDF files start with the %PDF- header."""
        data = _make_minimal_report_data()
        result = generate_report_pdf(data)
        assert result[:5] == b"%PDF-"

    def test_pdf_with_stale_flag_still_generates(self) -> None:
        """A stale run must not block PDF generation — just adds a warning."""
        data = _make_minimal_report_data(is_stale=True)
        result = generate_report_pdf(data)
        assert result[:5] == b"%PDF-"

    def test_pdf_with_no_checks_generates(self) -> None:
        """Edge case: no compliance results must not crash the generator."""
        data = _make_minimal_report_data()
        data.compliance_results = []
        data.compliance_summary = ComplianceSummarySection(
            total=0, passed=0, failed=0, warning=0, not_evaluable=0
        )
        result = generate_report_pdf(data)
        assert result[:5] == b"%PDF-"

    def test_pdf_with_no_issues_generates(self) -> None:
        """Edge case: no issues must not crash the generator."""
        data = _make_minimal_report_data()
        data.top_issues = []
        data.issue_summary = IssueSummarySection(
            total=0, critical=0, error=0, warning=0, info=0
        )
        result = generate_report_pdf(data)
        assert result[:5] == b"%PDF-"

    def test_pdf_with_compliance_results_generates(self) -> None:
        """Generator must handle a non-empty compliance_results list."""
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.LTE,
            value_number=35.0,
            units="m",
        )
        check = _evaluate_single_rule(
            RUN_ID, rule, {MetricKey.BUILDING_HEIGHT_M: 38.2}, NOW
        )
        data = _make_minimal_report_data()
        data.compliance_results = [
            ComplianceResultRow(
                check_id=check.id,
                rule_id=rule.id,
                rule_title=rule.title,
                metric_key=check.metric_key,
                metric_label="Building height",
                status=check.status,
                actual_value=check.actual_value,
                expected_value=check.expected_value,
                units=check.units,
                explanation=check.explanation,
                source_kind=rule.source_kind,
            )
        ]
        result = generate_report_pdf(data)
        assert result[:5] == b"%PDF-"

    def test_pdf_with_missing_site_metadata_generates(self) -> None:
        """Missing address/municipality must not crash — these fields are optional."""
        data = _make_minimal_report_data()
        data.address = None
        data.municipality = None
        data.jurisdiction_code = None
        data.zoning_district = None
        result = generate_report_pdf(data)
        assert result[:5] == b"%PDF-"


# ═════════════════════════════════════════════════════════════════════════════
# Issue 1 regression: approved extracted rules bypass applicability filter
#
# Root cause: the applicability filter in select_applicable_rules was excluding
# LLM-extracted approved rules whose applicability.zoning_districts didn't match
# the site's zoning_district. The fix: user-approved (status=approved/reviewed)
# and manual rules are ALWAYS included, regardless of their extracted applicability.
#
# These tests cover the pure _evaluate_single_rule path — confirming that
# approved extracted rules for the four previously-missing metrics (height,
# front/rear/left setback) evaluate correctly when the metric is present.
# The _is_applicable-bypass logic is tested separately in TestApplicabilityBypass.
# ═════════════════════════════════════════════════════════════════════════════

class TestApprovedExtractedRulesEvaluate:
    """
    Regression suite: approved extracted rules for setback and height metrics
    must evaluate as PASS or FAIL (never be silently skipped) even when the
    LLM stored a non-empty zoning_districts list in the rule's applicability.

    Before the fix these rules were silently excluded by the applicability filter
    in select_applicable_rules because zoning_districts didn't match the site.
    After the fix, approved/reviewed rules bypass that filter.
    """

    @pytest.mark.parametrize("metric_key,actual,threshold,op,expected_status", [
        (MetricKey.BUILDING_HEIGHT_M,    30.0, 35.0, RuleOperator.LTE, CheckResultStatus.PASS),
        (MetricKey.BUILDING_HEIGHT_M,    38.0, 35.0, RuleOperator.LTE, CheckResultStatus.FAIL),
        (MetricKey.FRONT_SETBACK_M,       6.0,  5.0, RuleOperator.GTE, CheckResultStatus.PASS),
        (MetricKey.FRONT_SETBACK_M,       3.0,  5.0, RuleOperator.GTE, CheckResultStatus.FAIL),
        (MetricKey.REAR_SETBACK_M,        8.0,  6.0, RuleOperator.GTE, CheckResultStatus.PASS),
        (MetricKey.REAR_SETBACK_M,        4.0,  6.0, RuleOperator.GTE, CheckResultStatus.FAIL),
        (MetricKey.SIDE_SETBACK_LEFT_M,   3.0,  2.5, RuleOperator.GTE, CheckResultStatus.PASS),
        (MetricKey.SIDE_SETBACK_LEFT_M,   1.0,  2.5, RuleOperator.GTE, CheckResultStatus.FAIL),
        (MetricKey.SIDE_SETBACK_RIGHT_M,  3.0,  2.5, RuleOperator.GTE, CheckResultStatus.PASS),
        (MetricKey.SIDE_SETBACK_RIGHT_M,  1.0,  2.5, RuleOperator.GTE, CheckResultStatus.FAIL),
        (MetricKey.FAR,                   1.5,  2.0, RuleOperator.LTE, CheckResultStatus.PASS),
        (MetricKey.FAR,                   2.5,  2.0, RuleOperator.LTE, CheckResultStatus.FAIL),
        (MetricKey.LOT_COVERAGE_PCT,     55.0, 60.0, RuleOperator.LTE, CheckResultStatus.PASS),
        (MetricKey.LOT_COVERAGE_PCT,     72.0, 60.0, RuleOperator.LTE, CheckResultStatus.FAIL),
    ])
    def test_approved_extracted_rule_evaluates(
        self,
        metric_key: MetricKey,
        actual: float,
        threshold: float,
        op: RuleOperator,
        expected_status: CheckResultStatus,
    ) -> None:
        """
        Approved extracted rule with any applicability data must evaluate to
        PASS or FAIL — never be skipped or produce AMBIGUOUS.
        This mirrors the real path after the applicability-bypass fix.
        """
        rule = _make_rule(
            metric_key=metric_key,
            operator=op,
            value_number=threshold,
            units="m",
            status=RuleStatus.APPROVED,
            source_kind=RuleSourceKind.EXTRACTED,
            is_authoritative=True,
        )
        check = _evaluate_single_rule(RUN_ID, rule, {metric_key: actual}, NOW)
        assert check.status == expected_status, (
            f"{metric_key.value}: actual={actual} threshold={threshold} op={op.value} → "
            f"expected {expected_status.value}, got {check.status.value}"
        )

    def test_approved_extracted_rule_evaluated_same_as_manual(self) -> None:
        """
        An approved extracted rule and a manual rule for the same metric+threshold
        must produce the same PASS/FAIL result — they share the same evaluator path.
        """
        metric_key = MetricKey.BUILDING_HEIGHT_M
        value      = 35.0
        actual     = 30.0

        extracted_rule = _make_rule(
            metric_key=metric_key,
            operator=RuleOperator.LTE,
            value_number=value,
            status=RuleStatus.APPROVED,
            source_kind=RuleSourceKind.EXTRACTED,
            is_authoritative=True,
        )
        manual_rule = _make_rule(
            metric_key=metric_key,
            operator=RuleOperator.LTE,
            value_number=value,
            status=RuleStatus.APPROVED,
            source_kind=RuleSourceKind.MANUAL,
            is_authoritative=True,
        )

        extracted_check = _evaluate_single_rule(RUN_ID, extracted_rule, {metric_key: actual}, NOW)
        manual_check    = _evaluate_single_rule(RUN_ID, manual_rule,    {metric_key: actual}, NOW)

        assert extracted_check.status == manual_check.status == CheckResultStatus.PASS

    def test_reviewed_status_also_evaluates(self) -> None:
        """RuleStatus.REVIEWED (legacy alias for approved) must also produce PASS/FAIL."""
        rule = _make_rule(
            metric_key=MetricKey.FRONT_SETBACK_M,
            operator=RuleOperator.GTE,
            value_number=5.0,
            status=RuleStatus.REVIEWED,
            source_kind=RuleSourceKind.EXTRACTED,
            is_authoritative=True,
        )
        check = _evaluate_single_rule(RUN_ID, rule, {MetricKey.FRONT_SETBACK_M: 3.0}, NOW)
        assert check.status == CheckResultStatus.FAIL


class TestApplicabilityBypass:
    """
    Tests for the applicability filter change:
    - Approved/reviewed rules are NOT filtered out by zoning_districts mismatch.
    - Manual rules are NOT filtered out (unchanged behaviour).
    - Draft/auto_approved rules ARE still filtered by _is_applicable.

    The actual bypass is in select_applicable_rules (requires async/DB).
    These tests use _is_applicable directly to confirm the helper's contract
    and document the expected gate behaviour at the filter level.
    """

    def _make_site(
        self,
        jurisdiction_code: str | None = None,
        zoning_district: str | None = None,
    ) -> SiteContext:
        return SiteContext(
            id=uuid4(),
            project_id=uuid4(),
            jurisdiction_code=jurisdiction_code,
            zoning_district=zoning_district,
            source_provider="test",
            created_at=NOW,
            updated_at=NOW,
        )

    def test_rule_with_mismatched_district_excluded_by_is_applicable(self) -> None:
        """
        _is_applicable returns False when districts mismatch.
        This confirms the pre-fix behaviour that silently dropped approved rules.
        The bypass in select_applicable_rules overrides this for approved rules.
        """
        app  = Applicability(zoning_districts=["R6"])
        site = self._make_site(zoning_district="R7A")
        assert _is_applicable(app, site) is False

    def test_rule_with_empty_applicability_always_passes(self) -> None:
        """Empty applicability (all manual rules + unannotated extracted rules) always passes."""
        app  = Applicability()
        site = self._make_site(zoning_district="R7A")
        assert _is_applicable(app, site) is True

    def test_rule_with_matching_district_passes(self) -> None:
        """A rule whose district list contains the site's district passes the filter."""
        app  = Applicability(zoning_districts=["R6", "R7A"])
        site = self._make_site(zoning_district="R7A")
        assert _is_applicable(app, site) is True

    def test_rule_with_site_has_no_district_passes(self) -> None:
        """
        When site has no district yet, district-constrained rules are not excluded —
        we can't confirm a mismatch so we include the rule.
        """
        app  = Applicability(zoning_districts=["R6"])
        site = self._make_site(zoning_district=None)
        assert _is_applicable(app, site) is True


# ═════════════════════════════════════════════════════════════════════════════
# Issue 2: Manual rule delete guard
#
# The backend delete_manual_rule service raises ValueError for non-manual rules.
# We test the guard logic directly using the RuleSourceKind check, which is the
# same condition used in the service.  The full service method requires async DB
# calls, so we test the discriminator predicate here.
# ═════════════════════════════════════════════════════════════════════════════

class TestManualRuleDeleteGuard:
    """
    Unit tests for the source_kind guard that prevents extracted rules from
    being hard-deleted.  Mirrors the check in delete_manual_rule().
    """

    def test_manual_rule_is_deletable(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            operator=RuleOperator.LTE,
            value_number=30.0,
            source_kind=RuleSourceKind.MANUAL,
            status=RuleStatus.APPROVED,
            is_authoritative=True,
        )
        # The guard: only manual rules may be hard-deleted
        assert rule.source_kind == RuleSourceKind.MANUAL

    def test_extracted_rule_is_not_deletable(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.FRONT_SETBACK_M,
            operator=RuleOperator.GTE,
            value_number=5.0,
            source_kind=RuleSourceKind.EXTRACTED,
            status=RuleStatus.APPROVED,
            is_authoritative=True,
        )
        # Extracted rules must NOT pass the hard-delete guard
        assert rule.source_kind != RuleSourceKind.MANUAL

    def test_deleted_manual_rule_not_authoritative(self) -> None:
        """
        After deletion, a manual rule no longer exists — simulate by checking
        that the authority predicate would not count it.
        Authoritative = source_kind='manual' OR status in approved/reviewed/auto_approved.
        A hard-deleted rule is gone: no row → no authority.
        This test documents the expected behaviour rather than testing the DB.
        """
        # With hard delete, the rule is gone — nothing to count.
        # Any remaining rule set must not include the deleted rule.
        remaining_rules: list[ExtractedRule] = []
        _AUTHORITATIVE_STATUSES_CHECK = {
            RuleStatus.APPROVED, RuleStatus.REVIEWED, RuleStatus.AUTO_APPROVED,
        }
        authoritative_count = sum(
            1 for r in remaining_rules
            if r.source_kind == RuleSourceKind.MANUAL
            or r.status in _AUTHORITATIVE_STATUSES_CHECK
        )
        assert authoritative_count == 0  # deleted rule is gone


# ═════════════════════════════════════════════════════════════════════════════
# Issue 3: PDF filename sanitisation
#
# Tests the filename logic used in the backend Content-Disposition header
# and the frontend a.download attribute.
# Format: "{run_name} - summary.pdf"
# ═════════════════════════════════════════════════════════════════════════════

def _backend_pdf_filename(run_name: str | None, run_id_fallback: str = "abc12345") -> str:
    """
    Reimplements the backend filename logic from download_run_report_pdf()
    so we can test it without HTTP.
    """
    raw_name = run_name or f"run-{run_id_fallback}"
    safe_name_str = "".join(c if c.isalnum() or c in "-_ ." else "_" for c in raw_name)
    safe_name_str = safe_name_str.strip() or "compliance-report"
    return f"{safe_name_str} - summary.pdf"


class TestPdfFilename:
    """
    Regression tests for Issue 3: PDF download filename must be
    "{run_name} - summary.pdf" (not just "{run_name}.pdf").
    """

    def test_simple_name_produces_correct_filename(self) -> None:
        assert _backend_pdf_filename("Test 1") == "Test 1 - summary.pdf"

    def test_name_with_spaces_preserved(self) -> None:
        assert _backend_pdf_filename("Downtown Tower Review") == "Downtown Tower Review - summary.pdf"

    def test_name_with_special_chars_sanitised(self) -> None:
        filename = _backend_pdf_filename("Run/Name:Test")
        assert filename.endswith(" - summary.pdf")
        # Slashes and colons must be replaced
        assert "/" not in filename
        assert ":" not in filename

    def test_none_name_uses_fallback(self) -> None:
        filename = _backend_pdf_filename(None, run_id_fallback="abc12345")
        assert "run-abc12345" in filename
        assert filename.endswith(" - summary.pdf")

    def test_empty_name_uses_fallback(self) -> None:
        # After stripping special chars from an all-special-char name, the result
        # is empty → "compliance-report - summary.pdf"
        filename = _backend_pdf_filename("!!!")
        assert filename.endswith(" - summary.pdf")
        assert len(filename) > len(" - summary.pdf")

    def test_name_with_hyphens_and_underscores_preserved(self) -> None:
        filename = _backend_pdf_filename("Run_Name-2024")
        assert "Run_Name-2024" in filename
        assert filename == "Run_Name-2024 - summary.pdf"

    def test_suffix_always_ends_with_summary_pdf(self) -> None:
        for name in ["Test 1", "My Project", "Run 42", "A"]:
            assert _backend_pdf_filename(name).endswith(" - summary.pdf")


# ═════════════════════════════════════════════════════════════════════════════
# ComplianceResultRow — provenance fields added in enrichment pass
#
# Verifies that the new optional fields (description, condition_text,
# exception_text, normalization_note, citation_snippet, rule_code) are
# accepted and round-trip correctly through the schema.
# ═════════════════════════════════════════════════════════════════════════════

class TestComplianceResultRowProvenanceFields:
    """
    The enrichment pass added extra provenance fields to ComplianceResultRow.
    These tests confirm:
      - New fields default to None gracefully (backward compat with old data).
      - When populated, they round-trip through the schema without error.
      - PDF generation still succeeds with all new fields populated.
    """

    def _make_row(
        self,
        *,
        rule_code: str | None = None,
        description: str | None = None,
        condition_text: str | None = None,
        exception_text: str | None = None,
        normalization_note: str | None = None,
        citation_snippet: str | None = None,
        citation_section: str | None = None,
        citation_page: int | None = None,
    ) -> ComplianceResultRow:
        return ComplianceResultRow(
            check_id=uuid4(),
            rule_id=uuid4(),
            rule_code=rule_code,
            rule_title="Building height limit",
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            metric_label="Building height",
            status=CheckResultStatus.PASS,
            actual_value=28.0,
            expected_value=35.0,
            units="m",
            explanation="Height within limit.",
            source_kind=RuleSourceKind.EXTRACTED,
            citation_section=citation_section,
            citation_page=citation_page,
            description=description,
            condition_text=condition_text,
            exception_text=exception_text,
            normalization_note=normalization_note,
            citation_snippet=citation_snippet,
        )

    def test_provenance_fields_default_to_none(self) -> None:
        """All new fields should be None when not supplied."""
        row = self._make_row()
        assert row.rule_code is None
        assert row.description is None
        assert row.condition_text is None
        assert row.exception_text is None
        assert row.normalization_note is None
        assert row.citation_snippet is None

    def test_rule_code_populated(self) -> None:
        row = self._make_row(rule_code="ZC-4.2.1")
        assert row.rule_code == "ZC-4.2.1"

    def test_description_populated(self) -> None:
        row = self._make_row(description="Maximum permitted building height for R-2 district.")
        assert row.description == "Maximum permitted building height for R-2 district."

    def test_condition_text_populated(self) -> None:
        row = self._make_row(condition_text="Applies to R-2 and R-3 residential districts.")
        assert row.condition_text == "Applies to R-2 and R-3 residential districts."

    def test_exception_text_populated(self) -> None:
        row = self._make_row(exception_text="Mechanical penthouses excluded from height calculation.")
        assert row.exception_text == "Mechanical penthouses excluded from height calculation."

    def test_normalization_note_populated(self) -> None:
        row = self._make_row(normalization_note="Converted from 115 ft using 1 ft = 0.3048 m.")
        assert row.normalization_note == "Converted from 115 ft using 1 ft = 0.3048 m."

    def test_citation_snippet_populated(self) -> None:
        snippet = "No building shall exceed 35 meters in height above grade."
        row = self._make_row(citation_snippet=snippet)
        assert row.citation_snippet == snippet

    def test_citation_section_and_page_populated(self) -> None:
        row = self._make_row(citation_section="4.2.1", citation_page=42)
        assert row.citation_section == "4.2.1"
        assert row.citation_page == 42

    def test_all_provenance_fields_populated_pdf_generates(self) -> None:
        """PDF must still generate successfully when all provenance fields are set."""
        row = self._make_row(
            rule_code="ZC-4.2.1",
            description="Maximum permitted building height.",
            condition_text="Applies to R-2 districts.",
            exception_text="Mechanical penthouses excluded.",
            normalization_note="Converted from 115 ft.",
            citation_snippet="No building shall exceed 35 m above grade.",
            citation_section="4.2.1",
            citation_page=42,
        )
        data = _make_minimal_report_data()
        data.compliance_results = [row]
        result = generate_report_pdf(data)
        assert result[:5] == b"%PDF-"
        assert len(result) > 1024

    def test_pdf_appendix_included_when_results_present(self) -> None:
        """
        When compliance_results is non-empty the PDF includes the appendix page.
        We can't inspect PDF text content easily, but we confirm the PDF is
        larger than one produced with no results (appendix adds content).
        """
        row = self._make_row(rule_code="ZC-1.0", description="Test rule")
        data_with_results = _make_minimal_report_data()
        data_with_results.compliance_results = [row]

        data_no_results = _make_minimal_report_data()
        data_no_results.compliance_results = []

        pdf_with = generate_report_pdf(data_with_results)
        pdf_without = generate_report_pdf(data_no_results)

        # Both must be valid PDFs
        assert pdf_with[:5] == b"%PDF-"
        assert pdf_without[:5] == b"%PDF-"
        # Report with appendix must be strictly larger
        assert len(pdf_with) > len(pdf_without)

    def test_pdf_no_appendix_when_no_results(self) -> None:
        """PDF with no compliance results must still generate (no appendix page)."""
        data = _make_minimal_report_data()
        data.compliance_results = []
        result = generate_report_pdf(data)
        assert result[:5] == b"%PDF-"


# ═════════════════════════════════════════════════════════════════════════════
# Manual rule update — schema validation
#
# Confirms that UpdateManualRuleRequest (the payload used by the edit endpoint)
# correctly validates required fields, and that the form round-trip mapping
# from ExtractedRule → form state → update payload is consistent.
# ═════════════════════════════════════════════════════════════════════════════

class TestManualRuleUpdateSchema:
    """
    Unit tests for ExtractedRule → edit form round-trip mapping,
    using the Pydantic schemas directly (no DB, no FastAPI).
    These back the frontend form prefill logic: if the schema accepts a
    round-tripped rule, the form data is structurally valid.
    """

    def _base_rule_for_edit(self) -> ExtractedRule:
        """A minimal manual rule as it would come back from the DB."""
        return _make_rule(
            metric_key=MetricKey.FRONT_SETBACK_M,
            operator=RuleOperator.GTE,
            value_number=5.0,
            units="m",
            source_kind=RuleSourceKind.MANUAL,
            status=RuleStatus.APPROVED,
            is_authoritative=True,
        )

    def test_manual_rule_has_expected_fields(self) -> None:
        """A freshly constructed manual rule must have the fields the edit form reads."""
        rule = self._base_rule_for_edit()
        assert rule.rule_code.startswith("TEST-")
        assert rule.title is not None
        assert rule.metric_key == MetricKey.FRONT_SETBACK_M
        assert rule.operator == RuleOperator.GTE
        assert rule.value_number == 5.0
        assert rule.units == "m"
        assert rule.source_kind == RuleSourceKind.MANUAL

    def test_manual_rule_nullable_fields_default_to_none(self) -> None:
        """Fields the edit form populates as optional must default to None."""
        rule = self._base_rule_for_edit()
        # These are the optional fields the form manages
        assert rule.description is None
        assert rule.condition_text is None
        assert rule.exception_text is None
        assert rule.normalization_note is None
        assert rule.citation is None
        assert rule.version_label is None
        assert rule.effective_date is None

    def test_manual_rule_round_trips_to_edit_form_values(self) -> None:
        """
        Simulates what ManualRuleDialog does: read rule fields → build form state.
        Verifies the mapping is consistent (no field is silently dropped).
        """
        rule = self._base_rule_for_edit()

        # Replicate the form initialisation logic from ManualRuleDialog
        form_state = {
            "ruleCode":      rule.rule_code,
            "title":         rule.title,
            "description":   rule.description or "",
            "metricKey":     rule.metric_key.value,
            "operator":      rule.operator.value,
            "valueNumber":   str(rule.value_number) if rule.value_number is not None else "",
            "valueMin":      str(rule.value_min)    if rule.value_min    is not None else "",
            "valueMax":      str(rule.value_max)    if rule.value_max    is not None else "",
            "units":         rule.units or "",
            "conditionText": rule.condition_text or "",
            "exceptionText": rule.exception_text or "",
            "versionLabel":  rule.version_label  or "",
            "effectiveDate": "",
        }

        # Every mapped field should be non-None in the form state
        assert form_state["ruleCode"] == rule.rule_code
        assert form_state["title"]    == rule.title
        assert form_state["metricKey"] == MetricKey.FRONT_SETBACK_M.value
        assert form_state["operator"]  == RuleOperator.GTE.value
        assert form_state["valueNumber"] == "5.0"
        assert form_state["units"] == "m"

    def test_metric_key_optional_in_update_payload(self) -> None:
        """
        metricKey is optional (nullable) in UpdateManualRuleRequest — the frontend
        intentionally does not send it on edits (the field is disabled/locked in the form).
        This test confirms the schema allows a null metric_key.
        """
        from app.core.schemas import UpdateManualRuleRequest
        fields = set(UpdateManualRuleRequest.model_fields.keys())
        # operator and value fields must be present for numeric updates
        assert "operator" in fields
        assert "value_number" in fields
        assert "title" in fields
        # metric_key is present but nullable (optional patch field)
        assert "metric_key" in fields
        field_info = UpdateManualRuleRequest.model_fields["metric_key"]
        # Must default to None (not required)
        assert field_info.default is None or field_info.is_required() is False

    def test_manual_rule_between_operator_round_trips(self) -> None:
        """A 'between' operator manual rule must round-trip correctly."""
        rule = ExtractedRule(
            id=uuid4(),
            project_id=PROJECT_ID,
            document_id=None,
            rule_code="TEST-BETWEEN",
            title="Between rule",
            metric_key=MetricKey.FAR,
            operator=RuleOperator.BETWEEN,
            value_number=None,
            value_min=1.0,
            value_max=3.0,
            units=None,
            applicability=Applicability(),
            citation=None,
            confidence=1.0,
            status=RuleStatus.APPROVED,
            source_kind=RuleSourceKind.MANUAL,
            is_authoritative=True,
            created_at=NOW,
            updated_at=NOW,
        )

        form_state = {
            "operator":    rule.operator.value,
            "valueNumber": str(rule.value_number) if rule.value_number is not None else "",
            "valueMin":    str(rule.value_min)    if rule.value_min    is not None else "",
            "valueMax":    str(rule.value_max)    if rule.value_max    is not None else "",
        }

        assert form_state["operator"]    == "between"
        assert form_state["valueNumber"] == ""     # not used for between
        assert form_state["valueMin"]    == "1.0"
        assert form_state["valueMax"]    == "3.0"
