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
    ComplianceRunSummary,
    ExtractedRule,
    GeometrySnapshot,
    IssueSeverity,
    IssueType,
    MetricKey,
    PermitChecklistItem,
    PrecheckRun,
    ProjectExtractionOptions,
    ReadinessBreakdown,
    ReadinessLabel,
    ReadinessReason,
    RuleOperator,
    RuleSourceKind,
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
        options: ProjectExtractionOptions | None = None,
    ) -> list[ExtractedRule]:
        """
        Returns rules relevant to this run, filtered by site context and the
        authority model enforced by project extraction options.

        Authority precedence (explicit, documented):
          1. Manual rules (source_kind='manual', is_authoritative=True) — always used.
          2. Approved rules (status='approved' or 'reviewed') — always used.
          3. Auto-approved rules (status='auto_approved') — used when project
             options allow decision-driving extraction, OR when they are the
             only rules available for a given metric.
          4. Draft rules with confidence >= threshold — advisory only unless
             rule_auto_apply_enabled is True in project options.
          5. Draft rules with low confidence — advisory only, never decision-driving.

        Rejected and superseded rules are always excluded.
        """
        all_rules = await self._repo.get_rules_for_run(run_id)

        # Filter by applicability scope first
        if site_context:
            all_rules = [
                r for r in all_rules if _is_applicable(r.applicability, site_context)
            ]

        auto_apply = options.rule_auto_apply_enabled if options else False

        # Authority filter — only rules that drive compliance are evaluated.
        # Non-authoritative (draft, low-confidence) rules are excluded here so
        # the evaluator never produces AMBIGUOUS checks for advisory rules.
        # The UI displays all rules independently; only this subset is evaluated.
        #
        # Authoritative rule set:
        #   1. Manual rules (source_kind='manual') — always authoritative.
        #   2. Approved / reviewed / auto_approved rules — always authoritative.
        #   3. When auto_apply is enabled, auto_approved rules are included
        #      (they already are by is_authoritative=True on those rows).
        #   4. Draft rules with is_authoritative=True — included (edge case:
        #      admin override). Draft rules with is_authoritative=False are
        #      advisory only and EXCLUDED from compliance evaluation.
        _AUTHORITATIVE_STATUSES = {
            RuleStatus.APPROVED,
            RuleStatus.REVIEWED,
            RuleStatus.AUTO_APPROVED,
        }

        applicable: list[ExtractedRule] = []
        for rule in all_rules:
            # Manually skipping REJECTED is belt-and-suspenders; get_rules_for_run
            # already strips them, but guard against future query changes.
            if rule.status == RuleStatus.REJECTED:
                continue
            if rule.source_kind == RuleSourceKind.MANUAL:
                applicable.append(rule)
            elif rule.status in _AUTHORITATIVE_STATUSES:
                applicable.append(rule)
            elif rule.is_authoritative:
                # Draft rule with an explicit admin override flag
                applicable.append(rule)
            # else: draft / superseded without authoritative flag → excluded

        log.info(
            "Selected %d/%d rules for run=%s (auto_apply=%s, jurisdiction=%r, zone=%r)",
            len(applicable), len(all_rules), run_id, auto_apply,
            site_context.jurisdiction_code if site_context else None,
            site_context.zoning_district if site_context else None,
        )
        return applicable

    # ── resolve_metrics ───────────────────────────────────────

    async def resolve_metrics(
        self,
        snapshot: GeometrySnapshot,
        run: PrecheckRun | None = None,
    ) -> dict[MetricKey, float]:
        """
        Builds a MetricKey → float map from the geometry snapshot's metrics array,
        then overlays run-specific metrics (FAR, lot_coverage_pct) from
        precheck_runs.run_metrics.

        Run metrics win over snapshot metrics for FAR and lot_coverage_pct because
        they are computed with the correct run-specific parcel_area_m2.
        Model-only metrics (height, GFA, parking) come from the snapshot.
        """
        metric_map: dict[MetricKey, float] = {
            MetricKey(m.key): m.value
            for m in snapshot.metrics
            if m.value is not None
            # Exclude FAR from model snapshot — it was computed with potentially wrong
            # parcel data or no parcel data at sync time. The authoritative FAR lives
            # in run.run_metrics and is overlaid below.
            and m.key != MetricKey.FAR
        }

        if run and run.run_metrics:
            rm = run.run_metrics
            if rm.get("far") is not None:
                metric_map[MetricKey.FAR] = float(rm["far"])
            if rm.get("lot_coverage_pct") is not None:
                metric_map[MetricKey.LOT_COVERAGE_PCT] = float(rm["lot_coverage_pct"])

        return metric_map

    # ── evaluate_rules ────────────────────────────────────────

    async def evaluate_rules(
        self,
        run_id: UUID,
        rules: list[ExtractedRule],
        metric_map: dict[MetricKey, float],
        snapshot: GeometrySnapshot | None,
    ) -> tuple[list[ComplianceCheck], ComplianceRunSummary]:
        """
        Runs each rule through the deterministic evaluator.
        Persists ComplianceCheck rows and returns (checks, summary).

        Only authoritative rules should reach this method — call
        select_applicable_rules() first to enforce that invariant.

        This mirrors evaluateRule() in lib/precheck/rule-engine.ts exactly.
        """
        now = datetime.now(timezone.utc)
        check_rows: list[dict[str, Any]] = []
        checks_pre_persist: list[ComplianceCheck] = []

        for rule in rules:
            check = _evaluate_single_rule(run_id=run_id, rule=rule, metric_map=metric_map, now=now)
            checks_pre_persist.append(check)
            check_rows.append(_check_to_row(check))

        if not check_rows:
            summary = ComplianceRunSummary(
                run_id=run_id,
                total=0, passed=0, failed=0,
                ambiguous=0, missing_input=0, not_evaluable=0,
            )
            return [], summary

        checks = await self._repo.create_checks_bulk(check_rows)
        summary = _build_run_summary(run_id, checks)
        log.info(
            "Evaluated %d rules for run=%s — pass=%d fail=%d ambiguous=%d missing=%d",
            len(checks), run_id,
            summary.passed, summary.failed, summary.ambiguous, summary.missing_input,
        )
        return checks, summary

    # ── generate_issues ───────────────────────────────────────

    async def generate_issues(
        self,
        run_id: UUID,
        checks: list[ComplianceCheck],
        rules_by_id: dict[UUID, ExtractedRule],
        project_id: UUID | None = None,
    ) -> list[ComplianceIssue]:
        """
        Phase 2 issue generation — deterministic, no LLM.

        Converts non-passing ComplianceChecks into structured, user-facing
        ComplianceIssue objects with:
          - controlled issue_type vocab
          - rich title / summary / recommended_action content
          - source traceability (document, page, section) from rule citation
          - severity mapping by metric

        Only these check statuses generate issues:
          - FAIL → IssueType.VIOLATION
          - AMBIGUOUS → IssueType.AMBIGUOUS_RULE (rule needs review)
          - MISSING_INPUT → IssueType.MISSING_DATA

        PASS and NOT_APPLICABLE checks generate no issue.
        The caller (evaluate endpoint) is responsible for deleting prior
        issues before calling this method (idempotency via clear-regenerate).
        """
        now = datetime.now(timezone.utc)
        issue_rows: list[dict[str, Any]] = []

        for check in checks:
            if not _should_persist_issue(check.status):
                continue
            rule = rules_by_id.get(check.rule_id)
            issue = _build_issue(
                run_id=run_id,
                project_id=project_id,
                check=check,
                rule=rule,
                now=now,
            )
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

        The numeric score is persisted on the run row so the runs list
        can show it without fetching full details.  The richer breakdown
        (with label + reasons) is computed on demand by
        compute_readiness_breakdown() — called in get_run_details and the
        new /summary endpoint.
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

        # ── Compliance run state ──────────────────────────────
        # If evaluation has never been run, surface that as an explicit item.
        if run.status.value not in {"completed", "generating_report"}:
            items.append(_item(
                ChecklistCategory.SUBMISSION_DATA,
                "Run compliance evaluation",
                description="Evaluation has not completed — run the compliance check to see results",
            ))

        # ── Not-evaluable checks ──────────────────────────────
        not_evaluable_issues = [
            i for i in issues if i.status == CheckResultStatus.MISSING_INPUT
        ]
        if not_evaluable_issues:
            items.append(_item(
                ChecklistCategory.MODEL_DATA,
                f"Provide missing geometry for {len(not_evaluable_issues)} check(s)",
                description=(
                    f"{len(not_evaluable_issues)} rule(s) could not be evaluated "
                    "because geometry metrics are unavailable in the current model snapshot"
                ),
                required=False,
            ))

        # ── Submission data — critical / error issues ─────────
        critical_issues = [i for i in issues if i.severity == IssueSeverity.CRITICAL]
        error_issues    = [i for i in issues if i.severity == IssueSeverity.ERROR]
        warning_issues  = [
            i for i in issues
            if i.severity == IssueSeverity.WARNING
            and i.status not in {CheckResultStatus.MISSING_INPUT, CheckResultStatus.AMBIGUOUS}
        ]

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
        if warning_issues:
            items.append(_item(
                ChecklistCategory.SUBMISSION_DATA,
                f"Review {len(warning_issues)} compliance warning(s)",
                description="Warnings do not block submission but should be reviewed",
                required=False,
            ))
        if not critical_issues and not error_issues and run.status.value in {"completed", "generating_report"}:
            items.append(_item(
                ChecklistCategory.SUBMISSION_DATA,
                "No critical or error violations",
                description="Review any warnings before submitting",
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

    Callers are responsible for pre-filtering to authoritative rules via
    select_applicable_rules().  This function still defends against
    non-authoritative rows arriving here (pre-migration rows, admin
    edge cases) by emitting AMBIGUOUS rather than a hard PASS/FAIL.
    """
    actual = metric_map.get(rule.metric_key)

    if actual is None:
        # Metric not available from geometry snapshot
        metric_label = rule.metric_key.value.replace("_", " ").title()
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
            explanation=(
                f"{metric_label} could not be measured — "
                "no geometry snapshot metric available for this key."
            ),
            created_at=now,
        )

    # Non-authoritative rules that slip through are marked AMBIGUOUS.
    # select_applicable_rules() should have excluded them, but guard defensively.
    is_authoritative = getattr(rule, "is_authoritative", None)
    if is_authoritative is False:
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
            explanation=(
                "Rule is advisory only (not yet approved). "
                "Approve or manually create the rule to include it in evaluation."
            ),
            created_at=now,
        )

    # Legacy path: DRAFT rule with low confidence also becomes ambiguous
    # when is_authoritative is None (pre-migration rows without the column).
    if is_authoritative is None and rule.status == RuleStatus.DRAFT and rule.confidence < 0.6:
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
            explanation=(
                f"Rule confidence {rule.confidence:.0%} is below the required threshold. "
                "Review and approve the rule to include it in evaluation."
            ),
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
        explanation: str | None = (
            "Rule operator or threshold values are incomplete — "
            "cannot evaluate deterministically."
        )
    else:
        status = CheckResultStatus.PASS if passed else CheckResultStatus.FAIL
        explanation = _build_explanation(rule=rule, actual=actual, passed=passed)

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
        explanation=explanation,
        created_at=now,
    )


def _should_persist_issue(status: CheckResultStatus) -> bool:
    return status in {
        CheckResultStatus.FAIL,
        CheckResultStatus.AMBIGUOUS,
        CheckResultStatus.MISSING_INPUT,
    }


# ════════════════════════════════════════════════════════════
# PHASE 2 ISSUE GENERATION — deterministic, no LLM
# ════════════════════════════════════════════════════════════

# Human-readable metric labels used in issue content
_METRIC_LABELS: dict[MetricKey, str] = {
    MetricKey.BUILDING_HEIGHT_M:       "Building height",
    MetricKey.FRONT_SETBACK_M:         "Front setback",
    MetricKey.SIDE_SETBACK_LEFT_M:     "Left side setback",
    MetricKey.SIDE_SETBACK_RIGHT_M:    "Right side setback",
    MetricKey.REAR_SETBACK_M:          "Rear setback",
    MetricKey.FAR:                     "Floor area ratio (FAR)",
    MetricKey.LOT_COVERAGE_PCT:        "Lot coverage",
    MetricKey.PARKING_SPACES_REQUIRED: "Required parking spaces",
    MetricKey.PARKING_SPACES_PROVIDED: "Provided parking spaces",
    MetricKey.GROSS_FLOOR_AREA_M2:     "Gross floor area",
}

# Severity for FAIL issues by metric.
# These are defaults — individual rule or product overrides can be added later
# by adding a `severity` field to ExtractedRule.
_FAIL_SEVERITY_PHASE2: dict[MetricKey, IssueSeverity] = {
    MetricKey.BUILDING_HEIGHT_M:       IssueSeverity.ERROR,
    MetricKey.FRONT_SETBACK_M:         IssueSeverity.ERROR,
    MetricKey.SIDE_SETBACK_LEFT_M:     IssueSeverity.ERROR,
    MetricKey.SIDE_SETBACK_RIGHT_M:    IssueSeverity.ERROR,
    MetricKey.REAR_SETBACK_M:          IssueSeverity.ERROR,
    MetricKey.FAR:                     IssueSeverity.ERROR,
    MetricKey.LOT_COVERAGE_PCT:        IssueSeverity.ERROR,
    MetricKey.PARKING_SPACES_REQUIRED: IssueSeverity.WARNING,
    MetricKey.PARKING_SPACES_PROVIDED: IssueSeverity.WARNING,
    MetricKey.GROSS_FLOOR_AREA_M2:     IssueSeverity.WARNING,
}


def _metric_label(metric: MetricKey) -> str:
    return _METRIC_LABELS.get(metric, metric.value.replace("_", " ").title())


def _units_str(units: str | None) -> str:
    return f" {units}" if units else ""


def _build_issue(
    run_id: UUID,
    project_id: UUID | None,
    check: ComplianceCheck,
    rule: ExtractedRule | None,
    now: datetime,
) -> ComplianceIssue:
    """
    Phase 2 issue factory — deterministic, no I/O.

    Dispatches to per-status builders and attaches source traceability
    from the rule citation where available.
    """
    if check.status == CheckResultStatus.FAIL:
        return _build_violation_issue(run_id, project_id, check, rule, now)
    elif check.status == CheckResultStatus.AMBIGUOUS:
        return _build_ambiguous_issue(run_id, project_id, check, rule, now)
    elif check.status == CheckResultStatus.MISSING_INPUT:
        return _build_missing_data_issue(run_id, project_id, check, rule, now)
    else:
        raise ValueError(
            f"_build_issue called with non-issue status: {check.status.value}"
        )


def _source_fields(rule: ExtractedRule | None) -> dict:
    """Extract source traceability fields from a rule's citation."""
    if rule is None or rule.citation is None:
        return {
            "source_document_id": None,
            "source_page_start": None,
            "source_page_end": None,
            "source_section_number": None,
            "source_section_title": None,
        }
    cit = rule.citation
    return {
        "source_document_id": cit.document_id,
        "source_page_start": cit.page,
        "source_page_end": cit.page,          # single page; extend for multi-page in V2
        "source_section_number": cit.section,
        "source_section_title": None,          # not in RuleCitation yet; Phase 3 addition
    }


def _build_violation_issue(
    run_id: UUID,
    project_id: UUID | None,
    check: ComplianceCheck,
    rule: ExtractedRule | None,
    now: datetime,
) -> ComplianceIssue:
    """FAIL check → violation issue."""
    metric = check.metric_key
    label = _metric_label(metric)
    units = _units_str(check.units)
    actual = check.actual_value
    severity = _FAIL_SEVERITY_PHASE2.get(metric, IssueSeverity.ERROR)

    # ── Title ────────────────────────────────────────────────
    if rule and rule.operator in {RuleOperator.LTE, RuleOperator.LT}:
        title = f"{label} exceeds maximum allowed value"
    elif rule and rule.operator in {RuleOperator.GTE, RuleOperator.GT}:
        title = f"{label} is below minimum required value"
    elif rule and rule.operator == RuleOperator.EQ:
        title = f"{label} does not match required value"
    elif rule and rule.operator == RuleOperator.BETWEEN:
        title = f"{label} falls outside the required range"
    else:
        title = f"{label} fails compliance check"

    # ── Summary (detailed) ───────────────────────────────────
    if rule and actual is not None:
        if rule.operator in {RuleOperator.LTE, RuleOperator.LT} \
                and check.expected_value is not None:
            excess = round(actual - check.expected_value, 4)
            summary = (
                f"Measured {label.lower()} is {actual}{units}, which exceeds "
                f"the approved maximum of {check.expected_value}{units} "
                f"by {excess}{units}."
            )
        elif rule.operator in {RuleOperator.GTE, RuleOperator.GT} \
                and check.expected_value is not None:
            deficit = round(check.expected_value - actual, 4)
            summary = (
                f"Measured {label.lower()} is {actual}{units}, which is "
                f"{deficit}{units} below the approved minimum of "
                f"{check.expected_value}{units}."
            )
        elif rule.operator == RuleOperator.EQ \
                and check.expected_value is not None:
            summary = (
                f"Measured {label.lower()} is {actual}{units}, but the "
                f"required value is {check.expected_value}{units}."
            )
        elif rule.operator == RuleOperator.BETWEEN \
                and check.expected_min is not None \
                and check.expected_max is not None:
            summary = (
                f"Measured {label.lower()} is {actual}{units}, which falls "
                f"outside the required range of "
                f"{check.expected_min}–{check.expected_max}{units}."
            )
        else:
            summary = (
                f"Measured {label.lower()} is {actual}{units} and fails "
                f"the compliance check."
            )
    else:
        summary = f"{label} fails the compliance check."

    # ── Recommended action ───────────────────────────────────
    if rule and rule.operator in {RuleOperator.LTE, RuleOperator.LT}:
        recommended_action = (
            f"Reduce {label.lower()} to within the approved maximum"
            f"{(' of ' + str(check.expected_value) + units) if check.expected_value is not None else ''}. "
            f"Alternatively, confirm whether an alternative rule applies to this site."
        )
    elif rule and rule.operator in {RuleOperator.GTE, RuleOperator.GT}:
        recommended_action = (
            f"Increase {label.lower()} to meet the minimum required value"
            f"{(' of ' + str(check.expected_value) + units) if check.expected_value is not None else ''}. "
            f"Review the approved rule and adjust the design accordingly."
        )
    elif rule and rule.operator == RuleOperator.BETWEEN:
        recommended_action = (
            f"Adjust {label.lower()} to fall within the required range"
            f"{(' of ' + str(check.expected_min) + '–' + str(check.expected_max) + units) if check.expected_min is not None else ''}."
        )
    else:
        recommended_action = (
            f"Review the approved rule for {label.lower()} "
            f"and update the design to meet the requirement."
        )

    src = _source_fields(rule)
    return ComplianceIssue(
        id=uuid4(),
        run_id=run_id,
        project_id=project_id,
        rule_id=rule.id if rule else None,
        check_id=check.id,
        severity=severity,
        issue_type=IssueType.VIOLATION,
        title=title,
        summary=summary,
        explanation=check.explanation,
        recommended_action=recommended_action,
        status=check.status,
        metric_key=check.metric_key,
        actual_value=check.actual_value,
        expected_value=check.expected_value,
        expected_min=check.expected_min,
        expected_max=check.expected_max,
        units=check.units,
        citation=rule.citation if rule else None,
        source_document_id=src["source_document_id"],
        source_page_start=src["source_page_start"],
        source_page_end=src["source_page_end"],
        source_section_number=src["source_section_number"],
        source_section_title=src["source_section_title"],
        affected_object_ids=[],
        affected_geometry=None,
        created_at=now,
        updated_at=now,
    )


def _build_ambiguous_issue(
    run_id: UUID,
    project_id: UUID | None,
    check: ComplianceCheck,
    rule: ExtractedRule | None,
    now: datetime,
) -> ComplianceIssue:
    """AMBIGUOUS check → ambiguous_rule issue."""
    metric = check.metric_key
    label = _metric_label(metric)

    if rule and rule.operator in {
        RuleOperator.LTE, RuleOperator.LT,
        RuleOperator.GTE, RuleOperator.GT,
        RuleOperator.EQ, RuleOperator.BETWEEN,
    } and (rule.value_number is None
           and rule.value_min is None
           and rule.value_max is None):
        # Operator present but threshold values missing
        issue_type = IssueType.UNSUPPORTED_BASIS
        title = f"{label} rule has incomplete threshold values"
        summary = (
            f"The approved rule for {label.lower()} specifies operator "
            f"'{rule.operator.value}' but no threshold value is available. "
            f"The check cannot be evaluated deterministically."
        )
        recommended_action = (
            f"Edit the rule for {label.lower()} to supply a numeric threshold, "
            f"or create a manual rule with the correct value."
        )
    else:
        # Low confidence / not yet authoritative
        issue_type = IssueType.AMBIGUOUS_RULE
        title = f"{label} rule requires review before it can be evaluated"
        summary = (
            f"The rule for {label.lower()} has not been marked as authoritative "
            f"(confidence: {rule.confidence:.0%}) and cannot drive a pass/fail result."
            if rule else
            f"The rule for {label.lower()} could not be evaluated — "
            f"no authoritative rule is available."
        )
        recommended_action = (
            "Open the Rules panel and approve or review the rule to include it "
            "in the compliance evaluation."
        )

    src = _source_fields(rule)
    return ComplianceIssue(
        id=uuid4(),
        run_id=run_id,
        project_id=project_id,
        rule_id=rule.id if rule else None,
        check_id=check.id,
        severity=IssueSeverity.WARNING,
        issue_type=issue_type,
        title=title,
        summary=summary,
        explanation=check.explanation,
        recommended_action=recommended_action,
        status=check.status,
        metric_key=check.metric_key,
        actual_value=check.actual_value,
        expected_value=check.expected_value,
        expected_min=check.expected_min,
        expected_max=check.expected_max,
        units=check.units,
        citation=rule.citation if rule else None,
        source_document_id=src["source_document_id"],
        source_page_start=src["source_page_start"],
        source_page_end=src["source_page_end"],
        source_section_number=src["source_section_number"],
        source_section_title=src["source_section_title"],
        affected_object_ids=[],
        affected_geometry=None,
        created_at=now,
        updated_at=now,
    )


def _build_missing_data_issue(
    run_id: UUID,
    project_id: UUID | None,
    check: ComplianceCheck,
    rule: ExtractedRule | None,
    now: datetime,
) -> ComplianceIssue:
    """MISSING_INPUT check → missing_data issue."""
    metric = check.metric_key
    label = _metric_label(metric)

    # Metric-specific missing-data messaging
    _MISSING_SUMMARIES: dict[MetricKey, tuple[str, str]] = {
        MetricKey.BUILDING_HEIGHT_M: (
            "Building height could not be measured — no height geometry metric is available in the current model snapshot.",
            "Sync a Speckle model that includes building mass or floor height data, then rerun.",
        ),
        MetricKey.FRONT_SETBACK_M: (
            "Front setback could not be evaluated because the parcel frontage geometry is unavailable.",
            "Provide or verify parcel boundary data and ensure the front lot line is classified correctly, then rerun.",
        ),
        MetricKey.SIDE_SETBACK_LEFT_M: (
            "Left side setback could not be measured from the current geometry snapshot.",
            "Ensure the building footprint and parcel boundary are both present in the synced model, then rerun.",
        ),
        MetricKey.SIDE_SETBACK_RIGHT_M: (
            "Right side setback could not be measured from the current geometry snapshot.",
            "Ensure the building footprint and parcel boundary are both present in the synced model, then rerun.",
        ),
        MetricKey.REAR_SETBACK_M: (
            "Rear setback could not be measured because the rear parcel boundary classification is unavailable.",
            "Provide or verify parcel boundary data with rear lot line classification, then rerun.",
        ),
        MetricKey.FAR: (
            "Floor area ratio (FAR) could not be calculated — gross floor area or parcel area is missing.",
            "Sync a model with floor area data and confirm the parcel area in the site context, then rerun.",
        ),
        MetricKey.LOT_COVERAGE_PCT: (
            "Lot coverage could not be calculated — building footprint area or parcel area is missing.",
            "Sync a model with building footprint geometry and confirm the parcel area, then rerun.",
        ),
        MetricKey.PARKING_SPACES_REQUIRED: (
            "Required parking could not be evaluated — the parking basis input (e.g. dwelling units or GFA) is unavailable.",
            "Provide the parking basis input required by the approved rule and rerun compliance.",
        ),
        MetricKey.PARKING_SPACES_PROVIDED: (
            "Provided parking space count could not be measured from the current model.",
            "Sync a model that includes parking level geometry or provide a manual parking count.",
        ),
        MetricKey.GROSS_FLOOR_AREA_M2: (
            "Gross floor area could not be calculated from the current model snapshot.",
            "Sync a model with floor slab geometry included, then rerun.",
        ),
    }

    default_summary = (
        f"{label} could not be measured — no geometry metric is available "
        f"for '{metric.value}' in the current model snapshot."
    )
    default_action = (
        f"Sync a Speckle model that provides '{metric.value}' data, then rerun compliance."
    )
    summary, recommended_action = _MISSING_SUMMARIES.get(
        metric, (default_summary, default_action)
    )

    src = _source_fields(rule)
    return ComplianceIssue(
        id=uuid4(),
        run_id=run_id,
        project_id=project_id,
        rule_id=rule.id if rule else None,
        check_id=check.id,
        severity=IssueSeverity.WARNING,
        issue_type=IssueType.MISSING_DATA,
        title=f"{label} could not be verified",
        summary=summary,
        explanation=check.explanation,
        recommended_action=recommended_action,
        status=check.status,
        metric_key=check.metric_key,
        actual_value=None,
        expected_value=check.expected_value,
        expected_min=check.expected_min,
        expected_max=check.expected_max,
        units=check.units,
        citation=rule.citation if rule else None,
        source_document_id=src["source_document_id"],
        source_page_start=src["source_page_start"],
        source_page_end=src["source_page_end"],
        source_section_number=src["source_section_number"],
        source_section_title=src["source_section_title"],
        affected_object_ids=[],
        affected_geometry=None,
        created_at=now,
        updated_at=now,
    )


# ════════════════════════════════════════════════════════════
# READINESS SCORE + BREAKDOWN  (Phase 3)
# calculate_readiness_score  → plain int, mirrors scoring.ts
# compute_readiness_breakdown → richer ReadinessBreakdown with
#   label, reasons, and a hard "Permit Ready" guard
# ════════════════════════════════════════════════════════════

def compute_readiness_breakdown(
    issues: list[ComplianceIssue],
    context: ScoreContext,
    authoritative_rule_count: int = 0,
    checklist_total: int = 0,
    checklist_resolved: int = 0,
) -> ReadinessBreakdown:
    """
    Pure function — no I/O.

    Returns a ReadinessBreakdown with:
      - numeric score (same formula as calculate_readiness_score)
      - label  (PERMIT_READY / ISSUES_TO_RESOLVE / INCOMPLETE_INPUT /
                NOT_YET_EVALUATED)
      - ordered reasons list (human-readable, deterministic)

    Label rules:
      NOT_YET_EVALUATED  : no geometry snapshot OR no authoritative rules
      INCOMPLETE_INPUT   : score < 60 OR missing parcel/zoning
      ISSUES_TO_RESOLVE  : score in [60, 80) OR score >= 80 but blocking
                           issues exist (unresolved FAIL with severity
                           ERROR or CRITICAL)
      PERMIT_READY       : score >= 80 AND no blocking issues

    "Blocking issue" = a FAIL-status issue with severity ERROR or CRITICAL.
    Warnings and missing-data issues reduce the score but don't block the
    Permit Ready label on their own.
    """
    reasons: list[ReadinessReason] = []

    # ── No geometry snapshot ─────────────────────────────────
    if not context.has_geometry_snapshot:
        reasons.append(ReadinessReason(
            key="no_geometry_snapshot",
            label="No model geometry — sync a Speckle model to enable evaluation",
            delta=0,
            is_blocking=True,
        ))
        return ReadinessBreakdown(
            score=0,
            label=ReadinessLabel.NOT_YET_EVALUATED,
            reasons=reasons,
            fail_count=0,
            warning_count=0,
            not_evaluable_count=0,
            blocking_issue_count=0,
        )

    # ── No authoritative rules ───────────────────────────────
    if authoritative_rule_count == 0:
        reasons.append(ReadinessReason(
            key="no_authoritative_rules",
            label="No approved rules — approve at least one rule to enable evaluation",
            delta=0,
            is_blocking=True,
        ))
        return ReadinessBreakdown(
            score=0,
            label=ReadinessLabel.NOT_YET_EVALUATED,
            reasons=reasons,
            fail_count=0,
            warning_count=0,
            not_evaluable_count=0,
            blocking_issue_count=0,
        )

    score = 100

    # ── Issue penalties ──────────────────────────────────────
    fail_critical = [
        i for i in issues
        if i.status == CheckResultStatus.FAIL and i.severity == IssueSeverity.CRITICAL
    ]
    fail_error = [
        i for i in issues
        if i.status == CheckResultStatus.FAIL and i.severity == IssueSeverity.ERROR
    ]
    fail_warning = [
        i for i in issues
        if i.status == CheckResultStatus.FAIL and i.severity == IssueSeverity.WARNING
    ]
    ambiguous = [i for i in issues if i.status == CheckResultStatus.AMBIGUOUS]
    missing = [i for i in issues if i.status == CheckResultStatus.MISSING_INPUT]

    blocking_count = len(fail_critical) + len(fail_error)

    for _ in fail_critical:
        score = max(0, score - 25)
    for _ in fail_error:
        score = max(0, score - 15)
    for _ in fail_warning:
        score = max(0, score - 7)
    for _ in ambiguous:
        score = max(0, score - 5)
    for _ in missing:
        score = max(0, score - 8)

    if fail_critical:
        reasons.append(ReadinessReason(
            key="fail_critical_count",
            label=f"{len(fail_critical)} critical violation(s) must be resolved",
            delta=-(len(fail_critical) * 25),
            is_blocking=True,
        ))
    if fail_error:
        reasons.append(ReadinessReason(
            key="fail_error_count",
            label=f"{len(fail_error)} unresolved compliance error(s) lowers readiness",
            delta=-(len(fail_error) * 15),
            is_blocking=True,
        ))
    if fail_warning:
        reasons.append(ReadinessReason(
            key="fail_warning_count",
            label=f"{len(fail_warning)} compliance warning(s) reduce readiness",
            delta=-(len(fail_warning) * 7),
        ))
    if ambiguous:
        reasons.append(ReadinessReason(
            key="ambiguous_rule_count",
            label=f"{len(ambiguous)} rule(s) need review before they can be evaluated",
            delta=-(len(ambiguous) * 5),
        ))
    if missing:
        reasons.append(ReadinessReason(
            key="missing_data_count",
            label=f"{len(missing)} check(s) could not be evaluated — geometry data missing",
            delta=-(len(missing) * 8),
        ))

    # ── Data caps ────────────────────────────────────────────
    if not context.has_parcel_data or not context.has_zoning_data:
        score = min(score, 60)
        reasons.append(ReadinessReason(
            key="missing_site_data",
            label="Missing parcel or zoning data caps readiness at 60",
            delta=0,
        ))

    if not context.has_reviewed_rules:
        score = min(score, 50)
        reasons.append(ReadinessReason(
            key="no_reviewed_rules",
            label="No reviewed/approved rules caps readiness at 50",
            delta=0,
        ))

    # ── Positive signals ─────────────────────────────────────
    pass_count = sum(
        1 for i in issues if i.status == CheckResultStatus.PASS
    )
    if pass_count:
        reasons.append(ReadinessReason(
            key="pass_count",
            label=f"{pass_count} check(s) passed",
            delta=0,
        ))

    if authoritative_rule_count:
        reasons.append(ReadinessReason(
            key="authoritative_rule_count",
            label=f"{authoritative_rule_count} authoritative rule(s) evaluated",
            delta=0,
        ))

    if checklist_total:
        unresolved = checklist_total - checklist_resolved
        if unresolved == 0:
            reasons.append(ReadinessReason(
                key="checklist_complete",
                label="All checklist items resolved",
                delta=0,
            ))
        else:
            reasons.append(ReadinessReason(
                key="checklist_incomplete",
                label=(
                    f"{checklist_resolved}/{checklist_total} "
                    f"checklist item(s) resolved"
                ),
                delta=0,
            ))

    # ── Label ────────────────────────────────────────────────
    if score == 0:
        label = ReadinessLabel.NOT_YET_EVALUATED
    elif score < 60:
        label = ReadinessLabel.INCOMPLETE_INPUT
    elif score < 80 or blocking_count > 0:
        # Score in [60, 80) is always ISSUES_TO_RESOLVE.
        # Score >= 80 but with blocking (error/critical) issues is also
        # ISSUES_TO_RESOLVE — Permit Ready label is hard-blocked.
        label = ReadinessLabel.ISSUES_TO_RESOLVE
    else:
        label = ReadinessLabel.PERMIT_READY

    return ReadinessBreakdown(
        score=score,
        label=label,
        reasons=reasons,
        fail_count=len(fail_critical) + len(fail_error) + len(fail_warning),
        warning_count=len(ambiguous),
        not_evaluable_count=len(missing),
        blocking_issue_count=blocking_count,
    )


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


def _build_explanation(rule: ExtractedRule, actual: float, passed: bool) -> str:
    """
    Produces a one-sentence human-readable explanation for a deterministic check.
    Format mirrors the TS rule-engine comment style.
    """
    metric = rule.metric_key.value.replace("_", " ").title()
    units  = f" {rule.units}" if rule.units else ""
    val    = rule.value_number

    if passed:
        if rule.operator in {RuleOperator.LTE, RuleOperator.LT} and val is not None:
            return f"{metric} {actual}{units} is within the maximum allowed {val}{units}."
        if rule.operator in {RuleOperator.GTE, RuleOperator.GT} and val is not None:
            return f"{metric} {actual}{units} meets the minimum required {val}{units}."
        if rule.operator == RuleOperator.EQ and val is not None:
            return f"{metric} {actual}{units} matches the required value of {val}{units}."
        if rule.operator == RuleOperator.BETWEEN \
                and rule.value_min is not None and rule.value_max is not None:
            return (
                f"{metric} {actual}{units} is within the required range "
                f"{rule.value_min}–{rule.value_max}{units}."
            )
        return f"{metric} passes the compliance check."
    else:
        if rule.operator in {RuleOperator.LTE, RuleOperator.LT} and val is not None:
            return (
                f"{metric} {actual}{units} exceeds the maximum allowed {val}{units}."
            )
        if rule.operator in {RuleOperator.GTE, RuleOperator.GT} and val is not None:
            return (
                f"{metric} {actual}{units} is below the minimum required {val}{units}."
            )
        if rule.operator == RuleOperator.EQ and val is not None:
            return (
                f"{metric} {actual}{units} does not match the required value of {val}{units}."
            )
        if rule.operator == RuleOperator.BETWEEN \
                and rule.value_min is not None and rule.value_max is not None:
            return (
                f"{metric} {actual}{units} falls outside the required range "
                f"{rule.value_min}–{rule.value_max}{units}."
            )
        return f"{metric} fails the compliance check."


def _build_run_summary(run_id: UUID, checks: list[ComplianceCheck]) -> ComplianceRunSummary:
    passed = sum(1 for c in checks if c.status == CheckResultStatus.PASS)
    failed = sum(1 for c in checks if c.status == CheckResultStatus.FAIL)
    ambiguous = sum(1 for c in checks if c.status == CheckResultStatus.AMBIGUOUS)
    missing = sum(1 for c in checks if c.status == CheckResultStatus.MISSING_INPUT)
    not_evaluable = sum(1 for c in checks if c.status == CheckResultStatus.NOT_APPLICABLE)
    return ComplianceRunSummary(
        run_id=run_id,
        total=len(checks),
        passed=passed,
        failed=failed,
        ambiguous=ambiguous,
        missing_input=missing,
        not_evaluable=not_evaluable,
    )


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
        "explanation":    check.explanation,
        "created_at":     check.created_at.isoformat(),
    }


def _issue_to_row(issue: ComplianceIssue) -> dict[str, Any]:
    now = issue.updated_at or issue.created_at
    return {
        "id":                    str(issue.id),
        "run_id":                str(issue.run_id),
        "project_id":            str(issue.project_id) if issue.project_id else None,
        "rule_id":               str(issue.rule_id) if issue.rule_id else None,
        "check_id":              str(issue.check_id) if issue.check_id else None,
        "severity":              issue.severity.value,
        "issue_type":            issue.issue_type.value if issue.issue_type else None,
        "title":                 issue.title,
        "summary":               issue.summary,
        "explanation":           issue.explanation,
        "recommended_action":    issue.recommended_action,
        "status":                issue.status.value,
        "metric_key":            issue.metric_key.value if issue.metric_key else None,
        "actual_value":          issue.actual_value,
        "expected_value":        issue.expected_value,
        "expected_min":          issue.expected_min,
        "expected_max":          issue.expected_max,
        "units":                 issue.units,
        # mode="json" is required here: Pydantic v2 model_dump() returns UUID
        # objects for UUID fields (e.g. RuleCitation.document_id, .chunk_id).
        # Supabase's JSON serializer cannot handle UUID objects directly →
        # TypeError: Object of type UUID is not JSON serializable.
        "citation":              issue.citation.model_dump(mode="json") if issue.citation else None,
        "source_document_id":    str(issue.source_document_id) if issue.source_document_id else None,
        "source_page_start":     issue.source_page_start,
        "source_page_end":       issue.source_page_end,
        "source_section_number": issue.source_section_number,
        "source_section_title":  issue.source_section_title,
        "affected_object_ids":   issue.affected_object_ids,
        "affected_geometry":     issue.affected_geometry.model_dump(mode="json") if issue.affected_geometry else None,
        "created_at":            issue.created_at.isoformat(),
        "updated_at":            now.isoformat(),
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
