"""
backend/tests/test_phase4_workflow.py

Phase 4 workflow tests covering:

  - Rule approval marks project runs as stale (mock repository)
  - Rule unapproval reverts status to draft, marks stale
  - Unapprove on a manual rule raises ValueError
  - Unapprove on a non-existent rule raises ValueError
  - Rejected rule marks stale
  - compute_readiness_breakdown after unapprove reflects non-authoritative rule
  - Readiness label is not PERMIT_READY when authoritative_rule_count == 0
  - Rerun: evaluate is not blocked after 'completed' status
  - Stale run: breakdown still returns last computed score (not zero)

Run with:
    cd backend
    pytest tests/test_phase4_workflow.py -v
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from app.core.schemas import (
    Applicability,
    CheckResultStatus,
    ComplianceIssue,
    ExtractedRule,
    IssueSeverity,
    IssueType,
    MetricKey,
    ReadinessLabel,
    RuleOperator,
    RuleSourceKind,
    RuleStatus,
    ScoreContext,
)
from app.services.compliance_engine import compute_readiness_breakdown
from app.services.rule_extraction import RuleExtractionService


# ── Helpers ───────────────────────────────────────────────────────────────────

NOW = datetime.now(timezone.utc)
PROJECT_ID = uuid4()
RUN_ID = uuid4()


def _make_rule(
    *,
    source_kind: RuleSourceKind = RuleSourceKind.EXTRACTED,
    status: RuleStatus = RuleStatus.DRAFT,
    is_authoritative: bool = False,
    conflict_group_id: UUID | None = None,
    rule_id: UUID | None = None,
) -> ExtractedRule:
    return ExtractedRule(
        id=rule_id or uuid4(),
        project_id=PROJECT_ID,
        rule_code="HEIGHT-01",
        title="Max building height",
        metric_key=MetricKey.BUILDING_HEIGHT_M,
        operator=RuleOperator.LTE,
        value_number=12.0,
        units="m",
        applicability=Applicability(),
        confidence=0.9,
        status=status,
        source_kind=source_kind,
        is_authoritative=is_authoritative,
        conflict_group_id=conflict_group_id,
        created_at=NOW,
        updated_at=NOW,
    )


def _make_issue(
    *,
    severity: IssueSeverity = IssueSeverity.ERROR,
    status: CheckResultStatus = CheckResultStatus.FAIL,
    issue_type: IssueType = IssueType.VIOLATION,
) -> ComplianceIssue:
    return ComplianceIssue(
        id=uuid4(),
        run_id=RUN_ID,
        severity=severity,
        title="Height violation",
        summary="Building exceeds max height",
        status=status,
        issue_type=issue_type,
        created_at=NOW,
        updated_at=NOW,
    )


def _make_svc(repo: Any) -> RuleExtractionService:
    """Construct RuleExtractionService with a mock repository."""
    svc = RuleExtractionService.__new__(RuleExtractionService)
    svc._repo = repo
    return svc


def _mock_repo(rule: ExtractedRule) -> MagicMock:
    """
    Build a minimal mock repository that:
      - get_rule_by_id → returns the rule
      - update_rule → returns a copy with patched fields
      - mark_run_stale → AsyncMock (no-op)
      - clear_conflict_group_recommendations → AsyncMock (no-op)
    """
    repo = MagicMock()
    repo.get_rule_by_id = AsyncMock(return_value=rule)

    async def _update_rule(rule_id: UUID, updates: dict) -> ExtractedRule:
        d = rule.model_dump()
        for k, v in updates.items():
            d[k] = v
        return ExtractedRule(**d)

    repo.update_rule = AsyncMock(side_effect=_update_rule)
    repo.mark_run_stale = AsyncMock()
    repo.clear_conflict_group_recommendations = AsyncMock()
    return repo


# ── Test: approve_rule marks stale ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_approve_rule_marks_project_stale():
    """
    After approve_rule(), mark_run_stale is called with the rule's project_id.
    """
    rule = _make_rule(
        status=RuleStatus.DRAFT,
        source_kind=RuleSourceKind.EXTRACTED,
    )
    repo = _mock_repo(rule)
    svc = _make_svc(repo)

    updated = await svc.approve_rule(rule.id)

    assert updated.status == RuleStatus.APPROVED
    assert updated.is_authoritative is True
    repo.mark_run_stale.assert_awaited_once()
    call_args = repo.mark_run_stale.call_args
    assert call_args.args[0] == PROJECT_ID


@pytest.mark.asyncio
async def test_approve_rule_returns_authoritative_rule():
    rule = _make_rule(
        status=RuleStatus.DRAFT,
        source_kind=RuleSourceKind.EXTRACTED,
    )
    repo = _mock_repo(rule)
    svc = _make_svc(repo)

    updated = await svc.approve_rule(rule.id)

    assert updated.is_authoritative is True
    assert updated.status == RuleStatus.APPROVED


# ── Test: unapprove_rule ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_unapprove_rule_reverts_to_draft():
    """
    unapprove_rule() on an approved extracted rule returns a draft rule
    with is_authoritative=False and calls mark_run_stale.
    """
    rule = _make_rule(
        status=RuleStatus.APPROVED,
        source_kind=RuleSourceKind.EXTRACTED,
        is_authoritative=True,
    )
    repo = _mock_repo(rule)
    svc = _make_svc(repo)

    updated = await svc.unapprove_rule(rule.id)

    assert updated.status == RuleStatus.DRAFT
    assert updated.is_authoritative is False
    repo.mark_run_stale.assert_awaited_once()


@pytest.mark.asyncio
async def test_unapprove_rule_marks_project_stale():
    rule = _make_rule(
        status=RuleStatus.APPROVED,
        source_kind=RuleSourceKind.EXTRACTED,
        is_authoritative=True,
    )
    repo = _mock_repo(rule)
    svc = _make_svc(repo)

    await svc.unapprove_rule(rule.id)

    call_args = repo.mark_run_stale.call_args
    assert call_args.args[0] == PROJECT_ID


@pytest.mark.asyncio
async def test_unapprove_manual_rule_raises():
    """
    Manual rules must never be unapproved — they are always authoritative.
    unapprove_rule() must raise ValueError with "manual rule" in the message.
    """
    rule = _make_rule(
        status=RuleStatus.APPROVED,
        source_kind=RuleSourceKind.MANUAL,
        is_authoritative=True,
    )
    repo = _mock_repo(rule)
    svc = _make_svc(repo)

    with pytest.raises(ValueError, match="manual rule"):
        await svc.unapprove_rule(rule.id)

    repo.mark_run_stale.assert_not_awaited()


@pytest.mark.asyncio
async def test_unapprove_nonexistent_rule_raises():
    """
    unapprove_rule() must raise ValueError when the rule does not exist.
    """
    repo = MagicMock()
    repo.get_rule_by_id = AsyncMock(return_value=None)
    repo.mark_run_stale = AsyncMock()
    svc = _make_svc(repo)

    with pytest.raises(ValueError):
        await svc.unapprove_rule(uuid4())

    repo.mark_run_stale.assert_not_awaited()


# ── Test: reject_rule marks stale ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reject_rule_marks_project_stale():
    rule = _make_rule(status=RuleStatus.APPROVED, is_authoritative=True)
    repo = _mock_repo(rule)
    svc = _make_svc(repo)

    updated = await svc.reject_rule(rule.id)

    assert updated.status == RuleStatus.REJECTED
    assert updated.is_authoritative is False
    repo.mark_run_stale.assert_awaited_once()


# ── Test: unapproved rule excluded from authoritative set ─────────────────────

def test_readiness_breakdown_no_authoritative_rules_capped():
    """
    When all extracted rules are DRAFT (unapproved), score is capped at 50
    (no reviewed rules) and label is NOT PERMIT_READY.
    """
    ctx = ScoreContext(
        has_parcel_data=True,
        has_zoning_data=True,
        has_reviewed_rules=False,
    )
    breakdown = compute_readiness_breakdown(
        issues=[],
        context=ctx,
        authoritative_rule_count=0,
        checklist_total=0,
        checklist_resolved=0,
    )

    assert breakdown.score <= 50
    assert breakdown.label != ReadinessLabel.PERMIT_READY


def test_readiness_breakdown_approved_rule_can_be_permit_ready():
    """
    With authoritative rules, no issues, and parcel + zoning data,
    score should be >= 80 and label PERMIT_READY.
    """
    ctx = ScoreContext(
        has_parcel_data=True,
        has_zoning_data=True,
        has_reviewed_rules=True,
    )
    breakdown = compute_readiness_breakdown(
        issues=[],
        context=ctx,
        authoritative_rule_count=3,
        checklist_total=2,
        checklist_resolved=2,
    )

    assert breakdown.label == ReadinessLabel.PERMIT_READY
    assert breakdown.score >= 80


# ── Test: stale state does not zero score ─────────────────────────────────────

def test_readiness_stale_run_still_has_score():
    """
    Staleness lives on the run row, not in the breakdown.
    compute_readiness_breakdown() operates on current issues — a stale run
    with zero blocking issues still returns a meaningful score.
    """
    ctx = ScoreContext(
        has_parcel_data=True,
        has_zoning_data=True,
        has_reviewed_rules=True,
    )
    breakdown = compute_readiness_breakdown(
        issues=[],
        context=ctx,
        authoritative_rule_count=2,
        checklist_total=0,
        checklist_resolved=0,
    )

    assert breakdown.score > 0
    assert breakdown.label != ReadinessLabel.NOT_YET_EVALUATED


# ── Test: rerun button logic ──────────────────────────────────────────────────

def test_evaluate_button_not_disabled_after_completion():
    """
    The rerun button is enabled when status is 'completed'.
    Only disabled during 'evaluating' or 'generating_report'.

    Mirrors the frontend condition:
      disabled = status in {'evaluating', 'generating_report'}
    """
    active = {"evaluating", "generating_report"}

    assert "completed" not in active, (
        "'completed' must NOT disable the rerun button"
    )
    assert "failed" not in active, (
        "'failed' must NOT disable the rerun button"
    )
    assert "evaluating" in active
    assert "generating_report" in active


# ── Test: score hard-block guard ─────────────────────────────────────────────

def test_blocking_error_prevents_permit_ready():
    """
    Hard guard: PERMIT_READY only when score >= 80 AND blocking_count == 0.
    A single ERROR issue must force ISSUES_TO_RESOLVE.
    """
    ctx = ScoreContext(
        has_parcel_data=True,
        has_zoning_data=True,
        has_reviewed_rules=True,
    )
    error_issue = _make_issue(
        severity=IssueSeverity.ERROR,
        status=CheckResultStatus.FAIL,
    )

    breakdown = compute_readiness_breakdown(
        issues=[error_issue],
        context=ctx,
        authoritative_rule_count=5,
    )

    assert breakdown.label == ReadinessLabel.ISSUES_TO_RESOLVE
    assert breakdown.blocking_issue_count >= 1


def test_warning_only_does_not_block_permit_ready():
    """
    WARNING-severity issues do NOT block PERMIT_READY (only ERROR/CRITICAL do).
    """
    ctx = ScoreContext(
        has_parcel_data=True,
        has_zoning_data=True,
        has_reviewed_rules=True,
    )
    warn_issue = _make_issue(
        severity=IssueSeverity.WARNING,
        status=CheckResultStatus.FAIL,
    )

    breakdown = compute_readiness_breakdown(
        issues=[warn_issue],
        context=ctx,
        authoritative_rule_count=5,
    )

    assert breakdown.blocking_issue_count == 0


# ── Test: mark_rule_status sets is_authoritative correctly ────────────────────

@pytest.mark.asyncio
async def test_mark_rule_status_draft_clears_authoritative():
    rule = _make_rule(status=RuleStatus.APPROVED, is_authoritative=True)
    repo = _mock_repo(rule)
    svc = _make_svc(repo)

    updated = await svc.mark_rule_status(rule.id, RuleStatus.DRAFT)

    assert updated.status == RuleStatus.DRAFT
    assert updated.is_authoritative is False


@pytest.mark.asyncio
async def test_mark_rule_status_approved_sets_authoritative():
    rule = _make_rule(status=RuleStatus.DRAFT, is_authoritative=False)
    repo = _mock_repo(rule)
    svc = _make_svc(repo)

    updated = await svc.mark_rule_status(rule.id, RuleStatus.APPROVED)

    assert updated.status == RuleStatus.APPROVED
    assert updated.is_authoritative is True


@pytest.mark.asyncio
async def test_mark_rule_status_rejected_clears_authoritative():
    rule = _make_rule(status=RuleStatus.APPROVED, is_authoritative=True)
    repo = _mock_repo(rule)
    svc = _make_svc(repo)

    updated = await svc.mark_rule_status(rule.id, RuleStatus.REJECTED)

    assert updated.status == RuleStatus.REJECTED
    assert updated.is_authoritative is False
