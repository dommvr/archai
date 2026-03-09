"""
backend/app/services/realtime_publisher.py

RealtimePublisher — event-driven run status updates via Supabase Realtime.

Implementation strategy:
  Supabase Realtime broadcasts Postgres row change events automatically
  when a table is added to the supabase_realtime publication:
    ALTER PUBLICATION supabase_realtime ADD TABLE public.precheck_runs;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_issues;

  This publisher therefore just needs to UPDATE the relevant rows —
  the Postgres change → Realtime broadcast → Next.js client subscription
  chain is handled by Supabase infrastructure.

  The Next.js client subscribes in PrecheckWorkspace (future wiring):
    supabase.channel('precheck-run-{runId}')
      .on('postgres_changes', { event: 'UPDATE', ... }, handler)
      .subscribe()

V1 scope: status + score updates only (no streaming geometry diffs).

Mirrors: RealtimePublisherContract in lib/precheck/services.ts
"""

from __future__ import annotations

import logging
from uuid import UUID

from app.core.schemas import ComplianceIssue, PrecheckRun, PrecheckRunStatus
from app.repositories.precheck_repository import PrecheckRepository

log = logging.getLogger(__name__)


class RealtimePublisher:
    """
    Mirrors RealtimePublisherContract from lib/precheck/services.ts.
    """

    def __init__(self, repo: PrecheckRepository) -> None:
        self._repo = repo

    async def publish_run_status(
        self,
        run_id: UUID,
        status: PrecheckRunStatus,
        current_step: str | None = None,
        error_message: str | None = None,
    ) -> PrecheckRun:
        """
        Updates run status in Postgres → triggers Supabase Realtime broadcast.

        Callers should invoke this at each pipeline step boundary so the
        frontend PrecheckProgressCard stays in sync.
        """
        updated = await self._repo.update_run_status(
            run_id=run_id,
            status=status,
            current_step=current_step,
            error_message=error_message,
        )
        log.info("Run %s status → %s (step=%r)", run_id, status.value, current_step)
        return updated

    async def publish_issues(
        self,
        run_id: UUID,
        issues: list[ComplianceIssue],
    ) -> None:
        """
        Issues are written to compliance_issues by the compliance engine.
        This method exists as an explicit seam for any additional broadcast
        logic (e.g. push notification, Slack webhook) needed in the future.

        V1: no-op beyond logging — Realtime picks up the INSERT automatically.
        """
        log.info("Published %d issues for run=%s via Realtime", len(issues), run_id)

    async def publish_score(
        self,
        run_id: UUID,
        score: int,
    ) -> None:
        """
        Score is written to precheck_runs by the compliance engine.
        V1: no-op beyond logging — Realtime picks up the UPDATE automatically.
        """
        log.info("Published readiness score=%d for run=%s via Realtime", score, run_id)
