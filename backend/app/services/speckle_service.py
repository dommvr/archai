"""
backend/app/services/speckle_service.py

SpeckleService — model version selection, object fetch, and geometry snapshot derivation.

V1 scope (scaffold):
  - Model/version selection support
  - SpeckleModelRef record creation
  - Geometry snapshot derivation seam (metric extraction stubbed)
  - Affected object ID mapping seam

V1 does NOT:
  - Authenticate against a user's personal Speckle token
  - Parse full Speckle object graphs
  - Implement viewer-side geometry rendering

TODO: All Speckle API calls require authentication.
      See: https://speckle.guide/dev/server-graphql.html

Mirrors: SpeckleServiceContract in lib/precheck/services.ts
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import httpx

from app.core.config import settings
from app.core.schemas import (
    GeometrySnapshot,
    GeometrySnapshotMetric,
    MetricKey,
    PrecheckRun,
    SpeckleModelRef,
    SyncSpeckleModelRequest,
)
from app.repositories.precheck_repository import PrecheckRepository

log = logging.getLogger(__name__)

# Speckle GraphQL endpoint
SPECKLE_GQL = "{server}/graphql"


class SpeckleService:
    """
    Mirrors SpeckleServiceContract from lib/precheck/services.ts.
    """

    def __init__(self, repo: PrecheckRepository) -> None:
        self._repo = repo

    # ── get_model_versions ────────────────────────────────────

    async def get_model_versions(self, stream_id: str) -> list[dict[str, Any]]:
        """
        Lists available versions (commits) for a Speckle stream.

        TODO: Implement via Speckle GraphQL API.
              Authentication: pass SPECKLE_TOKEN in Authorization header.
              Query: stream(id: $streamId) { commits { items { id message ... } } }
        """
        if not settings.speckle_token:
            log.warning("SPECKLE_TOKEN not set — cannot list model versions")
            return []

        # TODO: Speckle GraphQL integration
        # query = '''
        # query GetCommits($streamId: String!) {
        #   stream(id: $streamId) {
        #     commits { items { id message referencedObject createdAt authorName } }
        #   }
        # }
        # '''
        # async with httpx.AsyncClient() as client:
        #     resp = await client.post(
        #         SPECKLE_GQL.format(server=settings.speckle_server_url),
        #         json={"query": query, "variables": {"streamId": stream_id}},
        #         headers={"Authorization": f"Bearer {settings.speckle_token}"},
        #     )
        #     data = resp.json()
        #     return data["data"]["stream"]["commits"]["items"]
        return []

    # ── fetch_version_objects ─────────────────────────────────

    async def fetch_version_objects(
        self, stream_id: str, version_id: str
    ) -> dict[str, Any]:
        """
        Fetches the root object graph for a Speckle version.

        TODO: Use Speckle REST API or GraphQL to retrieve the object tree.
              Endpoint: GET {server}/objects/{stream_id}/{object_id}
              The object_id is the commit's referencedObject field.
              For geometry extraction, traverse the object tree to find
              Walls, Floors, Roofs, and site boundary objects.
        """
        if not settings.speckle_token:
            log.warning("SPECKLE_TOKEN not set — cannot fetch version objects")
            return {}

        # TODO: Speckle object fetch
        # async with httpx.AsyncClient() as client:
        #     resp = await client.get(
        #         f"{settings.speckle_server_url}/objects/{stream_id}/{version_id}",
        #         headers={"Authorization": f"Bearer {settings.speckle_token}"},
        #     )
        #     return resp.json()
        return {}

    # ── create_speckle_model_ref ──────────────────────────────

    async def create_speckle_model_ref(
        self,
        project_id: UUID,
        request: SyncSpeckleModelRequest,
    ) -> SpeckleModelRef:
        """Creates a SpeckleModelRef record linking a project to a specific version."""
        now = datetime.now(timezone.utc).isoformat()
        row: dict[str, Any] = {
            "id":            str(uuid4()),
            "project_id":    str(project_id),
            "stream_id":     request.stream_id,
            "branch_name":   request.branch_name,
            "version_id":    request.version_id,
            "model_name":    request.model_name,
            "commit_message": None,  # TODO: fetch from Speckle API
            "selected_at":   now,
        }
        return await self._repo.create_speckle_model_ref(row)

    # ── derive_geometry_snapshot ──────────────────────────────

    async def derive_geometry_snapshot(
        self,
        run: PrecheckRun,
        model_ref: SpeckleModelRef,
    ) -> GeometrySnapshot:
        """
        Derives a GeometrySnapshot from a Speckle model version.

        V1: Returns a stub snapshot with empty metrics.
        The stub is stored so the compliance engine can detect missing_input
        and score accordingly (readiness_score stays ≤ 60 without parcel data,
        and individual rules get missing_input status).

        TODO: Implement geometry extraction:
          1. Fetch object graph via fetch_version_objects()
          2. Identify floor plate objects (Speckle type: Objects.BuiltElements.Floor)
          3. Compute gross_floor_area_m2 by summing floor areas
          4. Identify building extents for building_height_m
          5. Derive setbacks from site boundary + building footprint polygons
          6. Compute FAR = gross_floor_area_m2 / parcel_area_m2
          7. Compute lot_coverage_pct = footprint_area / parcel_area_m2 * 100
          8. Store affected_object_ids per metric for viewer highlighting
        """
        now = datetime.now(timezone.utc)
        objects = await self.fetch_version_objects(model_ref.stream_id, model_ref.version_id)

        # Extract metrics from Speckle object graph
        # SPECKLE VIEWER WILL BE MOUNTED HERE — replace with real extraction
        metrics = _derive_metrics_stub(objects)

        row: dict[str, Any] = {
            "id":                   str(uuid4()),
            "project_id":           str(run.project_id),
            "run_id":               str(run.id),
            "speckle_model_ref_id": str(model_ref.id),
            "site_boundary":        None,   # TODO: derive from site context + model
            "building_footprints":  [],     # TODO: list of {objectId, polygon, level}
            "floors":               [],     # TODO: list of {level, areaM2, objectIds}
            "metrics":              [m.model_dump() for m in metrics],
            "raw_metrics":          {},
            "created_at":           now.isoformat(),
        }
        snapshot = await self._repo.create_geometry_snapshot(row)
        log.info("Geometry snapshot created: id=%s for run=%s", snapshot.id, run.id)
        return snapshot


# ── Helpers ───────────────────────────────────────────────────

def _derive_metrics_stub(objects: dict[str, Any]) -> list[GeometrySnapshotMetric]:
    """
    V1 stub: returns empty metric list.

    TODO: Parse the Speckle object tree to derive:
      - building_height_m  from max Z of roof objects
      - gross_floor_area_m2 from sum of floor areas
      - far                from gfa / parcel_area
      - lot_coverage_pct   from footprint / parcel_area * 100
      - setbacks           from footprint polygon vs site boundary polygon
      - parking            from parking object count
    """
    if not objects:
        return []

    # When objects are available, parse and return metrics.
    # Each metric should include source_object_ids for viewer highlight.
    return []
