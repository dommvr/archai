"""
backend/app/services/compliance_engine.py

ComplianceEngineService — deterministic rule evaluation, issue generation,
readiness scoring, and checklist generation.

Architecture invariant:
  - ONLY this service decides pass/fail/missing_input for numerical rules.
  - LLMs may provide explanations for issues, but never override evaluation results.
  - This mirrors the deterministic logic in lib/precheck/rule-engine.ts and
    lib/precheck/scoring.ts exactly.

Mirrors: ComplianceEngineServiceContract in lib/precheck/services.ts
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from app.core.schemas import (
    Applicability,
    ChecklistCategory,
    CheckResultStatus,
    ComplianceCheck,
    ComplianceIssue,
    ExtractedRule,
    GeometrySnapshot,
    GetRunDetailsResponse,
    IssueSeverity,
    MetricKey,
    PermitChecklistItem,
    PrecheckRun,
    RuleOperator,
    RuleStatus,
    ScoreContext,
    SiteContext,
)
from app.repositories.precheck_repository import PrecheckRepository

log = logging.getLogger(__name__)

# Severity assignments for fail results — can be overridden per metric in V2
# by adding a `severity` field to ExtractedRule.
_FAIL_SEVERITY_BY_METRIC: dict[MetricKey, IssueSeverity] = {
    MetricKey.BUILDING_HEIGHT_M:       IssueSeverity.ERROR,
    MetricKey.FRONT_SETBACK_M:         IssueSeverity.ERROR,
    MetricKey.SIDE_SETBACK_LEFT_M:     IssueSeverity.ERROR,
    MetricKey.SIDE_SETBACK_RIGHT_M:    IssueSeverity.ERROR,
    MetricKey.REAR_SETBACK_M:          IssueSeverity.ERROR,
    MetricKey.FAR:                     IssueSeverity.ERROR,
    MetricKey.LOT_COVERAGE_PCT:        IssueSeverity.ERROR,
    MetricKey.PARKING_SPACES_REQUIRED: IssueSeverity.WARNING,   # softer — often negotiable
    MetricKey.PARKING_SPACES_PROVIDED: IssueSeverity.WARNING,
    MetricKey.GROSS_FLOOR_AREA_M2:     IssueSeverity.WARNING,
}


class ComplianceEngineService:
    """
    Mirrors ComplianceEngineServiceContract from lib/precheck/services.ts.
    """

    def __init__(self, repo: PrecheckRepository) -> None:
        self._repo = repo

    # ── select_applicable_rules ───────────────────────────────

    async def select_applicable_rules(
        self,
        run_id: UUID,
        site_context: SiteContext | None,
    ) -> list[ExtractedRule]:
        """
        Returns rules relevant to this run's jurisdiction and zoning district.
        Excludes rejected rules. If no site context, returns all non-rejected rules.
        """
        all_rules = await self._repo.get_rules_for_run(run_id)

        if not site_context:
            return all_rules

        applicable: list[ExtractedRule] = []
        for rule in all_rules:
            if _is_applicable(rule.applicability, site_context):
                applicable.append(rule)

        log.info(
            "Selected %d/%d rules applicable for run=%s (jurisdiction=%r, zone=%r)",
            len(applicable), len(all_rules), run_id,
            site_context.jurisdiction_code, site_context.zoning_district,
        )
        return applicable

    # ── resolve_metrics ───────────────────────────────────────

    async def resolve_metrics(
        self, snapshot: GeometrySnapshot
    ) -> dict[MetricKey, float]:
        """
        Builds a MetricKey → float map from the geometry snapshot's metrics array.
        This is the metric_map consumed by evaluate_rules().
        """
        return {
            MetricKey(m.key): m.value
            for m in snapshot.metrics
            if m.value is not None
        }

    # ── evaluate_rules ────────────────────────────────────────

    async def evaluate_rules(
        self,
        run_id: UUID,
        rules: list[ExtractedRule],
        metric_map: dict[MetricKey, float],
        snapshot: GeometrySnapshot | None,
    ) -> list[ComplianceCheck]:
        """
        Runs each rule through the deterministic evaluator.
        Persists ComplianceCheck rows and returns them.

        This mirrors evaluateRule() in lib/precheck/rule-engine.ts exactly.
        """
        now = datetime.now(timezone.utc)
        check_rows: list[dict[str, Any]] = []

        for rule in rules:
            check = _evaluate_single_rule(run_id=run_id, rule=rule, metric_map=metric_map, now=now)
            check_rows.append(_check_to_row(check))

        if not check_rows:
            return []

        checks = await self._repo.create_checks_bulk(check_rows)
        log.info("Evaluated %d rules for run=%s", len(checks), run_id)
        return checks

    # ── generate_issues ───────────────────────────────────────

    async def generate_issues(
        self,
        run_id: UUID,
        checks: list[ComplianceCheck],
        rules_by_id: dict[UUID, ExtractedRule],
    ) -> list[ComplianceIssue]:
        """
        Converts non-passing ComplianceChecks into ComplianceIssue presentation objects.
        Passing checks (status=pass) produce an INFO issue for the report trail.

        Explanation fields are left empty in V1.
        TODO: Run each failing issue through an LLM to generate a plain-English
              explanation, remedy suggestion, and citation context.
              The LLM READS the issue data; it does not change pass/fail status.
        """
        now = datetime.now(timezone.utc)
        issue_rows: list[dict[str, Any]] = []

        for check in checks:
            rule = rules_by_id.get(check.rule_id)
            issue = _check_to_issue(run_id=run_id, check=check, rule=rule, now=now)
            issue_rows.append(_issue_to_row(issue))

        if not issue_rows:
            return []

        issues = await self._repo.create_issues_bulk(issue_rows)
        log.info("Generated %d issues for run=%s", len(issues), run_id)
        return issues

    # ── generate_readiness_score ──────────────────────────────

    async def generate_readiness_score(
        self,
        run_id: UUID,
        issues: list[ComplianceIssue],
        context: ScoreContext,
    ) -> int:
        """
        Calculates the readiness score 0–100 and writes it to precheck_runs.

        Mirrors calculateReadinessScore() from lib/precheck/scoring.ts exactly.
        Score is computed in Python (not the DB) and persisted as an integer.
        """
        score = calculate_readiness_score(issues, context)
        await self._repo.update_run_readiness_score(run_id, score)
        log.info("Readiness score for run=%s: %d", run_id, score)
        return score

    # ── generate_checklist ────────────────────────────────────

    async def generate_checklist(
        self,
        run: PrecheckRun,
        site_context: SiteContext | None,
        issues: list[ComplianceIssue],
        has_model: bool,
        has_reviewed_rules: bool,
    ) -> list[PermitChecklistItem]:
        """
        Derives a PermitChecklistItem list from the run state.
        Items reflect what is still missing or unresolved.
        """
        now = datetime.now(timezone.utc)
        items: list[PermitChecklistItem] = []

        def _item(
            category: ChecklistCategory,
            title: str,
            description: str | None = None,
            required: bool = True,
            resolved: bool = False,
        ) -> PermitChecklistItem:
            return PermitChecklistItem(
                id=uuid4(),
                run_id=run.id,
                category=category,
                title=title,
                description=description,
                required=required,
                resolved=resolved,
                created_at=now,
            )

        # ── Site data ─────────────────────────────────────────
        if not site_context:
            items.append(_item(ChecklistCategory.SITE_DATA, "Provide site address or coordinates"))
        else:
            items.append(_item(
                ChecklistCategory.SITE_DATA,
                "Site address provided",
                resolved=bool(site_context.address),
            ))
            if not site_context.parcel_area_m2:
                items.append(_item(
                    ChecklistCategory.SITE_DATA,
                    "Confirm parcel area (m²)",
                    description="Required for FAR and lot coverage calculations",
                ))

        # ── Zoning data ───────────────────────────────────────
        if site_context and not site_context.zoning_district:
            items.append(_item(
                ChecklistCategory.ZONING_DATA,
                "Confirm zoning district",
                description="Required to select applicable rules",
            ))

        # ── Model data ────────────────────────────────────────
        if not has_model:
            items.append(_item(
                ChecklistCategory.MODEL_DATA,
                "Sync a Speckle model version",
                description="Required to measure building metrics",
            ))

        # ── Rules data ────────────────────────────────────────
        if not has_reviewed_rules:
            items.append(_item(
                ChecklistCategory.RULES_DATA,
                "Review and approve extracted rules",
                description="At least one rule must be reviewed before final evaluation",
                required=False,
            ))

        # ── Submission data — critical issues ─────────────────
        critical_issues = [i for i in issues if i.severity == IssueSeverity.CRITICAL]
        error_issues    = [i for i in issues if i.severity == IssueSeverity.ERROR]

        if critical_issues:
            items.append(_item(
                ChecklistCategory.SUBMISSION_DATA,
                f"Resolve {len(critical_issues)} critical compliance violation(s)",
                description="Critical issues must be resolved before submission",
            ))
        if error_issues:
            items.append(_item(
                ChecklistCategory.SUBMISSION_DATA,
                f"Resolve {len(error_issues)} compliance error(s)",
                description="Errors likely require design changes",
                required=False,
            ))
        if not critical_issues and not error_issues and issues:
            items.append(_item(
                ChecklistCategory.SUBMISSION_DATA,
                "No critical or error violations",
                description="Review warnings before submitting",
                resolved=True,
            ))

        # Persist
        if items:
            rows = [_checklist_to_row(item) for item in items]
            stored = await self._repo.create_checklist_items_bulk(rows)
            return stored

        return []


# ════════════════════════════════════════════════════════════
# DETERMINISTIC RULE EVALUATOR
# Mirrors evaluateRule() in lib/precheck/rule-engine.ts exactly.
# Do NOT add LLM calls here.
# ════════════════════════════════════════════════════════════

def _evaluate_single_rule(
    run_id: UUID,
    rule: ExtractedRule,
    metric_map: dict[MetricKey, float],
    now: datetime,
) -> ComplianceCheck:
    """
    Pure function — no I/O. Returns a ComplianceCheck for one rule.
    """
    actual = metric_map.get(rule.metric_key)

    if actual is None:
        # Metric not available from geometry snapshot
        return ComplianceCheck(
            id=uuid4(),
            run_id=run_id,
            rule_id=rule.id,
            metric_key=rule.metric_key,
            status=CheckResultStatus.MISSING_INPUT,
            actual_value=None,
            expected_value=rule.value_number,
            expected_min=rule.value_min,
            expected_max=rule.value_max,
            units=rule.units,
            created_at=now,
        )

    # Unreviewed rule with low confidence → ambiguous (configurable)
    # Only mark ambiguous if rule is still draft AND confidence is low.
    if rule.status == RuleStatus.DRAFT and rule.confidence < 0.6:
        return ComplianceCheck(
            id=uuid4(),
            run_id=run_id,
            rule_id=rule.id,
            metric_key=rule.metric_key,
            status=CheckResultStatus.AMBIGUOUS,
            actual_value=actual,
            expected_value=rule.value_number,
            expected_min=rule.value_min,
            expected_max=rule.value_max,
            units=rule.units,
            created_at=now,
        )

    # Deterministic evaluation — mirrors rule-engine.ts operator logic
    passed: bool | None = None

    if rule.operator == RuleOperator.LTE and rule.value_number is not None:
        passed = actual <= rule.value_number

    elif rule.operator == RuleOperator.GTE and rule.value_number is not None:
        passed = actual >= rule.value_number

    elif rule.operator == RuleOperator.BETWEEN \
            and rule.value_min is not None and rule.value_max is not None:
        passed = rule.value_min <= actual <= rule.value_max

    elif rule.operator == RuleOperator.LT and rule.value_number is not None:
        passed = actual < rule.value_number

    elif rule.operator == RuleOperator.GT and rule.value_number is not None:
        passed = actual > rule.value_number

    elif rule.operator == RuleOperator.EQ and rule.value_number is not None:
        passed = actual == rule.value_number

    if passed is None:
        status = CheckResultStatus.AMBIGUOUS
    else:
        status = CheckResultStatus.PASS if passed else CheckResultStatus.FAIL

    return ComplianceCheck(
        id=uuid4(),
        run_id=run_id,
        rule_id=rule.id,
        metric_key=rule.metric_key,
        status=status,
        actual_value=actual,
        expected_value=rule.value_number,
        expected_min=rule.value_min,
        expected_max=rule.value_max,
        units=rule.units,
        created_at=now,
    )


def _check_to_issue(
    run_id: UUID,
    check: ComplianceCheck,
    rule: ExtractedRule | None,
    now: datetime,
) -> ComplianceIssue:
    """Converts a ComplianceCheck into a ComplianceIssue for display."""
    title   = rule.title if rule else f"Rule check: {check.metric_key.value}"
    metric  = check.metric_key

    if check.status == CheckResultStatus.PASS:
        severity    = IssueSeverity.INFO
        summary     = f"{metric.value.replace('_', ' ').title()} is within the allowed limit."
        explanation = None

    elif check.status == CheckResultStatus.FAIL:
        severity    = _FAIL_SEVERITY_BY_METRIC.get(metric, IssueSeverity.ERROR)
        summary     = _fail_summary(check)
        explanation = None  # TODO: LLM explanation — see generate_issues() docstring

    elif check.status == CheckResultStatus.MISSING_INPUT:
        severity    = IssueSeverity.WARNING
        summary     = f"Metric '{metric.value}' could not be measured — model geometry missing."
        explanation = "Sync a Speckle model and ensure the relevant element types are present."

    elif check.status == CheckResultStatus.AMBIGUOUS:
        severity    = IssueSeverity.WARNING
        summary     = f"Rule for '{metric.value}' has low confidence and needs human review."
        explanation = "Mark this rule as 'reviewed' in the Rules panel to include it in evaluation."

    else:  # not_applicable
        severity    = IssueSeverity.INFO
        summary     = f"Rule for '{metric.value}' is not applicable to this project."
        explanation = None

    return ComplianceIssue(
        id=uuid4(),
        run_id=run_id,
        rule_id=rule.id if rule else None,
        check_id=check.id,
        severity=severity,
        title=title,
        summary=summary,
        explanation=explanation,
        status=check.status,
        metric_key=check.metric_key,
        actual_value=check.actual_value,
        expected_value=check.expected_value,
        expected_min=check.expected_min,
        expected_max=check.expected_max,
        units=check.units,
        citation=rule.citation if rule else None,
        affected_object_ids=[],  # TODO: populated from GeometrySnapshotMetric.source_object_ids
        affected_geometry=None,
        created_at=now,
    )


def _fail_summary(check: ComplianceCheck) -> str:
    metric = check.metric_key.value.replace("_", " ").title()
    actual = check.actual_value

    if check.expected_value is not None:
        op = "exceeds the maximum" if check.status == CheckResultStatus.FAIL else "is below the minimum"
        return f"{metric} ({actual} {check.units or ''}) {op} of {check.expected_value} {check.units or ''}.".strip()

    if check.expected_min is not None and check.expected_max is not None:
        return (
            f"{metric} ({actual} {check.units or ''}) falls outside "
            f"the required range {check.expected_min}–{check.expected_max} {check.units or ''}.".strip()
        )

    return f"{metric} failed compliance check."


# ════════════════════════════════════════════════════════════
# READINESS SCORE
# Mirrors calculateReadinessScore() in lib/precheck/scoring.ts exactly.
# ════════════════════════════════════════════════════════════

def calculate_readiness_score(
    issues: list[ComplianceIssue],
    context: ScoreContext,
) -> int:
    """
    Pure function — no I/O. Returns score 0–100.

    Penalty schedule (mirrors scoring.ts):
      ambiguous:      -5
      missing_input:  -8
      fail critical: -25
      fail error:    -15
      fail warning:   -7

    Caps:
      < parcel or zoning data → max 60
      < reviewed rules        → max 50
    """
    if not context.has_geometry_snapshot:
        return 0

    score = 100

    for issue in issues:
        if issue.status == CheckResultStatus.AMBIGUOUS:
            score -= 5
        elif issue.status == CheckResultStatus.MISSING_INPUT:
            score -= 8
        elif issue.status == CheckResultStatus.FAIL:
            if issue.severity == IssueSeverity.CRITICAL:
                score -= 25
            elif issue.severity == IssueSeverity.ERROR:
                score -= 15
            elif issue.severity == IssueSeverity.WARNING:
                score -= 7

        score = max(0, score)

    if not context.has_parcel_data or not context.has_zoning_data:
        score = min(score, 60)

    if not context.has_reviewed_rules:
        score = min(score, 50)

    return score


# ── Helpers ───────────────────────────────────────────────────

def _is_applicable(applicability: Applicability, site: SiteContext) -> bool:
    """Returns True if a rule applies to the given site context."""
    if applicability.jurisdiction_code and site.jurisdiction_code:
        if applicability.jurisdiction_code != site.jurisdiction_code:
            return False

    if applicability.zoning_districts and site.zoning_district:
        if site.zoning_district not in applicability.zoning_districts:
            return False

    return True


def _check_to_row(check: ComplianceCheck) -> dict[str, Any]:
    return {
        "id":             str(check.id),
        "run_id":         str(check.run_id),
        "rule_id":        str(check.rule_id),
        "metric_key":     check.metric_key.value,
        "status":         check.status.value,
        "actual_value":   check.actual_value,
        "expected_value": check.expected_value,
        "expected_min":   check.expected_min,
        "expected_max":   check.expected_max,
        "units":          check.units,
        "created_at":     check.created_at.isoformat(),
    }


def _issue_to_row(issue: ComplianceIssue) -> dict[str, Any]:
    return {
        "id":                   str(issue.id),
        "run_id":               str(issue.run_id),
        "rule_id":              str(issue.rule_id) if issue.rule_id else None,
        "check_id":             str(issue.check_id) if issue.check_id else None,
        "severity":             issue.severity.value,
        "title":                issue.title,
        "summary":              issue.summary,
        "explanation":          issue.explanation,
        "status":               issue.status.value,
        "metric_key":           issue.metric_key.value if issue.metric_key else None,
        "actual_value":         issue.actual_value,
        "expected_value":       issue.expected_value,
        "expected_min":         issue.expected_min,
        "expected_max":         issue.expected_max,
        "units":                issue.units,
        "citation":             issue.citation.model_dump() if issue.citation else None,
        "affected_object_ids":  issue.affected_object_ids,
        "affected_geometry":    issue.affected_geometry.model_dump() if issue.affected_geometry else None,
        "created_at":           issue.created_at.isoformat(),
    }


def _checklist_to_row(item: PermitChecklistItem) -> dict[str, Any]:
    return {
        "id":          str(item.id),
        "run_id":      str(item.run_id),
        "category":    item.category.value,
        "title":       item.title,
        "description": item.description,
        "required":    item.required,
        "resolved":    item.resolved,
        "created_at":  item.created_at.isoformat(),
    }
