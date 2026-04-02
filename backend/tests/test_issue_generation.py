"""
backend/tests/test_issue_generation.py

Unit tests for Phase 2 issue generation.

Tests run against the pure helper functions (_build_issue, _build_violation_issue,
_build_ambiguous_issue, _build_missing_data_issue, _should_persist_issue) directly —
no database, no FastAPI, no network required.

Run with:
    cd backend
    pytest tests/test_issue_generation.py -v
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.core.schemas import (
    Applicability,
    CheckResultStatus,
    ComplianceCheck,
    ExtractedRule,
    IssueSeverity,
    IssueType,
    MetricKey,
    RuleCitation,
    RuleOperator,
    RuleSourceKind,
    RuleStatus,
)
from app.services.compliance_engine import (
    _build_ambiguous_issue,
    _build_issue,
    _build_missing_data_issue,
    _build_violation_issue,
    _should_persist_issue,
)


# ── Fixtures ─────────────────────────────────────────────────────────────────

NOW = datetime.now(timezone.utc)
PROJECT_ID = uuid4()
RUN_ID = uuid4()
DOC_ID = uuid4()


def _make_rule(
    metric_key: MetricKey = MetricKey.BUILDING_HEIGHT_M,
    operator: RuleOperator = RuleOperator.LTE,
    value_number: float | None = 35.0,
    value_min: float | None = None,
    value_max: float | None = None,
    units: str | None = "ft",
    source_kind: RuleSourceKind = RuleSourceKind.EXTRACTED,
    is_authoritative: bool = True,
    status: RuleStatus = RuleStatus.APPROVED,
    confidence: float = 0.95,
    citation: RuleCitation | None = None,
) -> ExtractedRule:
    return ExtractedRule(
        id=uuid4(),
        project_id=PROJECT_ID,
        document_id=DOC_ID if source_kind == RuleSourceKind.EXTRACTED else None,
        rule_code="TEST-001",
        title=f"Test rule for {metric_key.value}",
        metric_key=metric_key,
        operator=operator,
        value_number=value_number,
        value_min=value_min,
        value_max=value_max,
        units=units,
        applicability=Applicability(),
        citation=citation,
        confidence=confidence,
        status=status,
        source_kind=source_kind,
        is_authoritative=is_authoritative,
        created_at=NOW,
        updated_at=NOW,
    )


def _make_check(
    metric_key: MetricKey = MetricKey.BUILDING_HEIGHT_M,
    status: CheckResultStatus = CheckResultStatus.FAIL,
    actual_value: float | None = 38.2,
    expected_value: float | None = 35.0,
    expected_min: float | None = None,
    expected_max: float | None = None,
    units: str | None = "ft",
    explanation: str | None = None,
    rule_id: UUID | None = None,
) -> ComplianceCheck:
    return ComplianceCheck(
        id=uuid4(),
        run_id=RUN_ID,
        rule_id=rule_id or uuid4(),
        metric_key=metric_key,
        status=status,
        actual_value=actual_value,
        expected_value=expected_value,
        expected_min=expected_min,
        expected_max=expected_max,
        units=units,
        explanation=explanation,
        created_at=NOW,
    )


def _make_citation(page: int = 12, section: str = "4.2.1") -> RuleCitation:
    return RuleCitation(
        document_id=DOC_ID,
        page=page,
        section=section,
        snippet="Maximum building height shall not exceed 35 ft.",
    )


# ═════════════════════════════════════════════════════════════════════════════
# _should_persist_issue gate
# ═════════════════════════════════════════════════════════════════════════════

class TestShouldPersistIssue:

    def test_fail_is_persisted(self) -> None:
        assert _should_persist_issue(CheckResultStatus.FAIL) is True

    def test_ambiguous_is_persisted(self) -> None:
        assert _should_persist_issue(CheckResultStatus.AMBIGUOUS) is True

    def test_missing_input_is_persisted(self) -> None:
        assert _should_persist_issue(CheckResultStatus.MISSING_INPUT) is True

    def test_pass_is_not_persisted(self) -> None:
        assert _should_persist_issue(CheckResultStatus.PASS) is False

    def test_not_applicable_is_not_persisted(self) -> None:
        assert _should_persist_issue(CheckResultStatus.NOT_APPLICABLE) is False


# ═════════════════════════════════════════════════════════════════════════════
# FAIL → violation issue
# ═════════════════════════════════════════════════════════════════════════════

class TestViolationIssue:

    def test_fail_produces_violation_issue_type(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.issue_type == IssueType.VIOLATION

    def test_fail_severity_is_error_for_height(self) -> None:
        rule = _make_rule(metric_key=MetricKey.BUILDING_HEIGHT_M)
        check = _make_check(metric_key=MetricKey.BUILDING_HEIGHT_M, status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.severity == IssueSeverity.ERROR

    def test_fail_severity_is_warning_for_parking(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.PARKING_SPACES_REQUIRED,
            operator=RuleOperator.LTE,
            value_number=50.0,
            units=None,
        )
        check = _make_check(
            metric_key=MetricKey.PARKING_SPACES_REQUIRED,
            status=CheckResultStatus.FAIL,
            actual_value=60.0,
            expected_value=50.0,
            units=None,
        )
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.severity == IssueSeverity.WARNING

    def test_fail_title_mentions_exceeds_for_lte(self) -> None:
        rule = _make_rule(operator=RuleOperator.LTE)
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "exceed" in issue.title.lower() or "maximum" in issue.title.lower()

    def test_fail_title_mentions_below_for_gte(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.FRONT_SETBACK_M,
            operator=RuleOperator.GTE,
            value_number=5.0,
        )
        check = _make_check(
            metric_key=MetricKey.FRONT_SETBACK_M,
            status=CheckResultStatus.FAIL,
            actual_value=3.0,
            expected_value=5.0,
        )
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "below" in issue.title.lower() or "minimum" in issue.title.lower()

    def test_fail_summary_includes_actual_and_expected_values(self) -> None:
        rule = _make_rule(value_number=35.0)
        check = _make_check(actual_value=38.2, expected_value=35.0, status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "38.2" in issue.summary
        assert "35.0" in issue.summary

    def test_fail_summary_includes_excess_for_lte(self) -> None:
        rule = _make_rule(operator=RuleOperator.LTE, value_number=35.0)
        check = _make_check(actual_value=38.2, expected_value=35.0, status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        # Excess = 38.2 - 35.0 = 3.2
        assert "3.2" in issue.summary

    def test_fail_recommended_action_is_non_empty(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.recommended_action is not None
        assert len(issue.recommended_action) > 10

    def test_fail_status_is_fail(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.status == CheckResultStatus.FAIL

    def test_fail_links_rule_id(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.FAIL, rule_id=rule.id)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.rule_id == rule.id

    def test_fail_links_check_id(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.check_id == check.id

    def test_fail_links_project_id(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.project_id == PROJECT_ID

    def test_fail_no_rule_still_builds(self) -> None:
        """If rule metadata is missing, issue still builds without crashing."""
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, None, NOW)
        assert issue.issue_type == IssueType.VIOLATION
        assert issue.rule_id is None

    def test_between_fail_summary_mentions_range(self) -> None:
        rule = _make_rule(
            operator=RuleOperator.BETWEEN,
            value_number=None,
            value_min=5.0,
            value_max=30.0,
            units="m",
        )
        check = _make_check(
            actual_value=35.0,
            expected_value=None,
            expected_min=5.0,
            expected_max=30.0,
            status=CheckResultStatus.FAIL,
            units="m",
        )
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "5.0" in issue.summary
        assert "30.0" in issue.summary


# ═════════════════════════════════════════════════════════════════════════════
# Source traceability
# ═════════════════════════════════════════════════════════════════════════════

class TestSourceTraceability:

    def test_citation_populates_source_document_id(self) -> None:
        citation = _make_citation(page=15, section="3.1")
        rule = _make_rule(citation=citation)
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.source_document_id == DOC_ID

    def test_citation_populates_source_page(self) -> None:
        citation = _make_citation(page=15)
        rule = _make_rule(citation=citation)
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.source_page_start == 15
        assert issue.source_page_end == 15

    def test_citation_populates_section_number(self) -> None:
        citation = _make_citation(section="4.2.1")
        rule = _make_rule(citation=citation)
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.source_section_number == "4.2.1"

    def test_no_citation_source_fields_are_none(self) -> None:
        rule = _make_rule(citation=None)
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.source_document_id is None
        assert issue.source_page_start is None
        assert issue.source_section_number is None

    def test_missing_data_issue_preserves_citation(self) -> None:
        citation = _make_citation(page=7, section="2.4")
        rule = _make_rule(citation=citation)
        check = _make_check(status=CheckResultStatus.MISSING_INPUT, actual_value=None)
        issue = _build_missing_data_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.source_document_id == DOC_ID
        assert issue.source_page_start == 7


# ═════════════════════════════════════════════════════════════════════════════
# AMBIGUOUS → ambiguous_rule issue
# ═════════════════════════════════════════════════════════════════════════════

class TestAmbiguousIssue:

    def test_ambiguous_produces_ambiguous_rule_type(self) -> None:
        rule = _make_rule(is_authoritative=False, confidence=0.5)
        check = _make_check(status=CheckResultStatus.AMBIGUOUS)
        issue = _build_ambiguous_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.issue_type == IssueType.AMBIGUOUS_RULE

    def test_ambiguous_severity_is_warning(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.AMBIGUOUS)
        issue = _build_ambiguous_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.severity == IssueSeverity.WARNING

    def test_ambiguous_status_is_ambiguous(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.AMBIGUOUS)
        issue = _build_ambiguous_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.status == CheckResultStatus.AMBIGUOUS

    def test_ambiguous_recommended_action_mentions_rules_panel(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.AMBIGUOUS)
        issue = _build_ambiguous_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "rule" in issue.recommended_action.lower()

    def test_ambiguous_no_rule_still_builds(self) -> None:
        check = _make_check(status=CheckResultStatus.AMBIGUOUS)
        issue = _build_ambiguous_issue(RUN_ID, PROJECT_ID, check, None, NOW)
        assert issue.issue_type in {IssueType.AMBIGUOUS_RULE, IssueType.UNSUPPORTED_BASIS}

    def test_incomplete_threshold_is_unsupported_basis(self) -> None:
        """Rule with operator but missing value → UNSUPPORTED_BASIS."""
        rule = _make_rule(
            operator=RuleOperator.LTE,
            value_number=None,  # no threshold
            value_min=None,
            value_max=None,
        )
        check = _make_check(status=CheckResultStatus.AMBIGUOUS)
        issue = _build_ambiguous_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.issue_type == IssueType.UNSUPPORTED_BASIS


# ═════════════════════════════════════════════════════════════════════════════
# MISSING_INPUT → missing_data issue
# ═════════════════════════════════════════════════════════════════════════════

class TestMissingDataIssue:

    def test_missing_produces_missing_data_type(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.MISSING_INPUT, actual_value=None)
        issue = _build_missing_data_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.issue_type == IssueType.MISSING_DATA

    def test_missing_severity_is_warning(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.MISSING_INPUT, actual_value=None)
        issue = _build_missing_data_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.severity == IssueSeverity.WARNING

    def test_missing_actual_value_is_none(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.MISSING_INPUT, actual_value=None)
        issue = _build_missing_data_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.actual_value is None

    def test_missing_status_is_missing_input(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.MISSING_INPUT, actual_value=None)
        issue = _build_missing_data_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.status == CheckResultStatus.MISSING_INPUT

    def test_missing_has_recommended_action(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.MISSING_INPUT, actual_value=None)
        issue = _build_missing_data_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.recommended_action is not None
        assert len(issue.recommended_action) > 10

    def test_missing_height_specific_message(self) -> None:
        rule = _make_rule(metric_key=MetricKey.BUILDING_HEIGHT_M)
        check = _make_check(
            metric_key=MetricKey.BUILDING_HEIGHT_M,
            status=CheckResultStatus.MISSING_INPUT,
            actual_value=None,
        )
        issue = _build_missing_data_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "height" in issue.summary.lower() or "geometry" in issue.summary.lower()

    def test_missing_far_specific_message(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.FAR,
            operator=RuleOperator.LTE,
            value_number=2.0,
            units=None,
        )
        check = _make_check(
            metric_key=MetricKey.FAR,
            status=CheckResultStatus.MISSING_INPUT,
            actual_value=None,
            units=None,
        )
        issue = _build_missing_data_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "far" in issue.summary.lower() or "floor area" in issue.summary.lower()

    def test_missing_parking_mentions_basis(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.PARKING_SPACES_REQUIRED,
            operator=RuleOperator.LTE,
            value_number=50.0,
            units=None,
        )
        check = _make_check(
            metric_key=MetricKey.PARKING_SPACES_REQUIRED,
            status=CheckResultStatus.MISSING_INPUT,
            actual_value=None,
            units=None,
        )
        issue = _build_missing_data_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "parking" in issue.summary.lower() or "basis" in issue.summary.lower()

    def test_missing_no_rule_still_builds(self) -> None:
        check = _make_check(status=CheckResultStatus.MISSING_INPUT, actual_value=None)
        issue = _build_missing_data_issue(RUN_ID, PROJECT_ID, check, None, NOW)
        assert issue.issue_type == IssueType.MISSING_DATA


# ═════════════════════════════════════════════════════════════════════════════
# _build_issue dispatch
# ═════════════════════════════════════════════════════════════════════════════

class TestBuildIssueDispatch:

    def test_fail_dispatches_to_violation(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.FAIL)
        issue = _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.issue_type == IssueType.VIOLATION

    def test_ambiguous_dispatches_to_ambiguous_rule(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.AMBIGUOUS)
        issue = _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.issue_type in {IssueType.AMBIGUOUS_RULE, IssueType.UNSUPPORTED_BASIS}

    def test_missing_dispatches_to_missing_data(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.MISSING_INPUT, actual_value=None)
        issue = _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue.issue_type == IssueType.MISSING_DATA

    def test_pass_raises_value_error(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.PASS)
        with pytest.raises(ValueError, match="non-issue status"):
            _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)


# ═════════════════════════════════════════════════════════════════════════════
# Idempotency / regeneration contract
# ═════════════════════════════════════════════════════════════════════════════

class TestIdempotencyContract:
    """
    The generate_issues() method is idempotent because the caller (evaluate
    endpoint) deletes all prior issues before calling it.  These tests verify
    that calling the pure helpers twice on the same inputs produces equivalent
    results (same type, severity, metric) — different UUIDs are expected.
    """

    def test_two_calls_produce_same_issue_type(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.FAIL)
        issue_a = _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        issue_b = _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue_a.issue_type == issue_b.issue_type

    def test_two_calls_produce_same_severity(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.FAIL)
        issue_a = _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        issue_b = _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue_a.severity == issue_b.severity

    def test_two_calls_produce_same_summary(self) -> None:
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.FAIL, actual_value=38.2, expected_value=35.0)
        issue_a = _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        issue_b = _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue_a.summary == issue_b.summary

    def test_two_calls_produce_different_ids(self) -> None:
        """Each call creates a fresh UUID — deduplication is the caller's job."""
        rule = _make_rule()
        check = _make_check(status=CheckResultStatus.FAIL)
        issue_a = _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        issue_b = _build_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert issue_a.id != issue_b.id


# ═════════════════════════════════════════════════════════════════════════════
# Content template spot-checks
# ═════════════════════════════════════════════════════════════════════════════

class TestContentTemplates:

    def test_front_setback_gte_fail_content(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.FRONT_SETBACK_M,
            operator=RuleOperator.GTE,
            value_number=5.0,
            units="m",
        )
        check = _make_check(
            metric_key=MetricKey.FRONT_SETBACK_M,
            status=CheckResultStatus.FAIL,
            actual_value=3.0,
            expected_value=5.0,
            units="m",
        )
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "3.0" in issue.summary
        assert "5.0" in issue.summary
        assert issue.issue_type == IssueType.VIOLATION
        # Deficit = 5.0 - 3.0 = 2.0
        assert "2.0" in issue.summary

    def test_far_lte_fail_content(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.FAR,
            operator=RuleOperator.LTE,
            value_number=2.0,
            units=None,
        )
        check = _make_check(
            metric_key=MetricKey.FAR,
            status=CheckResultStatus.FAIL,
            actual_value=2.5,
            expected_value=2.0,
            units=None,
        )
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "2.5" in issue.summary
        assert "2.0" in issue.summary
        assert issue.severity == IssueSeverity.ERROR

    def test_lot_coverage_lte_fail_content(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.LOT_COVERAGE_PCT,
            operator=RuleOperator.LTE,
            value_number=60.0,
            units="%",
        )
        check = _make_check(
            metric_key=MetricKey.LOT_COVERAGE_PCT,
            status=CheckResultStatus.FAIL,
            actual_value=72.0,
            expected_value=60.0,
            units="%",
        )
        issue = _build_violation_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "72.0" in issue.summary
        assert "60.0" in issue.summary
        assert "coverage" in issue.title.lower() or "lot" in issue.title.lower()

    def test_missing_rear_setback_message(self) -> None:
        rule = _make_rule(
            metric_key=MetricKey.REAR_SETBACK_M,
            operator=RuleOperator.GTE,
            value_number=6.0,
            units="m",
        )
        check = _make_check(
            metric_key=MetricKey.REAR_SETBACK_M,
            status=CheckResultStatus.MISSING_INPUT,
            actual_value=None,
        )
        issue = _build_missing_data_issue(RUN_ID, PROJECT_ID, check, rule, NOW)
        assert "rear" in issue.summary.lower() or "setback" in issue.summary.lower()
        assert issue.recommended_action is not None
