"""
backend/app/services/speckle_service.py

SpeckleService — model version selection, object fetch, and geometry snapshot derivation.

V1 scope:
  - SpeckleModelRef record creation
  - Geometry snapshot derivation with a full multi-connector metric extraction pipeline
  - Metrics produced when real objects are available:
      gross_floor_area_m2, building_height_m, far, parking_spaces_provided
  - Metrics NOT yet derived (require shapely + parcel boundary polygon):
      front_setback_m, side_setback_left_m, side_setback_right_m, rear_setback_m,
      lot_coverage_pct
      → These resolve as missing_input in the compliance engine until shapely is added.
  - FAR is derived in Python from GFA + site_context.parcel_area_m2 (no shapely needed).

Multi-connector normalization architecture (V1.1):
  The extraction pipeline has four distinct stages:
    1. raw fetch         → fetch_version_objects() returns a flat element pool
    2. flattening        → _get_elements_from_objects() unpacks the pool
    3. normalization     → _normalize_elements() runs connector-specific extractors and
                           produces typed semantic candidates (AreaCandidate, HeightCandidate,
                           ParkingCandidate) regardless of connector origin
    4. metric derivation → _derive_metrics_from_candidates() aggregates candidates into
                           GeometrySnapshotMetric objects

  Connector conventions supported:
    A. Revit-origin  — "Revit" in speckle_type, Revit parameter dict, category strings
    B. IFC / direct  — IFC class names in type/category, property sets, quantity sets
    C. Generic/Rhino — name and layer string hints, bbox fallback, area field fallback

  This layered design means adding a new connector convention requires only a new
  extractor function — the rest of the pipeline is unchanged.

Speckle fetch behaviour (V1):
  - Requires SPECKLE_SERVER_URL and SPECKLE_TOKEN to be set in .env
  - If SPECKLE_TOKEN is missing, fetch is skipped and metrics will be empty (dev-mode stub).
    The run does NOT fail; raw_metrics will contain {"fetch_skipped": true, "reason": ...}.
  - If the token is set, specklepy.api.client.SpeckleClient is used to:
      1. Authenticate against SPECKLE_SERVER_URL
      2. Resolve version_id (commit ID) → referencedObject hash via GraphQL
         (client.commit.get() is NOT used — it is absent in some specklepy versions)
      3. Fetch the full object tree via ServerTransport + MemoryTransport +
         operations.receive() using the resolved referencedObject hash
    This avoids the /streams/{streamId}/objects/{hash} REST path that returns a 302
    redirect to the browser UI on local Speckle server deployments.
  - If the specklepy fetch raises (auth error, 404, network), the exception propagates
    and the run is set to FAILED by the route handler — do NOT silently swallow errors.

Diagnostics:
  All log.warning / log.info / log.debug messages are present so you can trace exactly
  why metrics are empty without instrumenting the code further. Search for:
    "SPECKLE_SERVER_URL", "SPECKLE_TOKEN", "specklepy", "object tree",
    "metric extraction", "fetch_skipped", "_normalize_elements", "_derive_metrics"
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse
from uuid import UUID, uuid4

import httpx

from app.core.config import settings
from app.core.schemas import (
    GeometrySnapshot,
    GeometrySnapshotMetric,
    MetricKey,
    PrecheckRun,
    SiteContext,
    SpeckleModelRef,
    SyncSpeckleModelRequest,
)
from app.repositories.precheck_repository import PrecheckRepository
from app.services.unit_normalizer import UnitNormalizationReport, detect_and_normalize_units

log = logging.getLogger(__name__)

# Speckle GraphQL endpoint template (still used by get_model_versions)
SPECKLE_GQL = "{server}/graphql"

# ── Config diagnostics logged once at first use ────────────────────────────────
_config_logged = False


def _log_config_status() -> None:
    global _config_logged
    if _config_logged:
        return
    _config_logged = True
    if settings.speckle_server_url:
        log.info("Speckle config: SPECKLE_SERVER_URL = %s", settings.speckle_server_url)
    else:
        log.warning("Speckle config: SPECKLE_SERVER_URL is not set — using default https://app.speckle.systems")
    if settings.speckle_token:
        log.info("Speckle config: SPECKLE_TOKEN is set (length=%d)", len(settings.speckle_token))
    else:
        log.warning(
            "Speckle config: SPECKLE_TOKEN is NOT set — fetch_version_objects will be skipped. "
            "Geometry snapshots will have no metrics until a token is configured."
        )


class SpeckleService:
    """
    Handles Speckle model/version selection and geometry snapshot derivation.
    """

    def __init__(self, repo: PrecheckRepository) -> None:
        self._repo = repo

    # ── get_model_versions ────────────────────────────────────

    async def get_model_versions(self, stream_id: str) -> list[dict[str, Any]]:
        """
        Lists available versions (commits) for a Speckle stream via GraphQL.
        Returns [] if SPECKLE_TOKEN is not set or the request fails.
        """
        _log_config_status()
        if not settings.speckle_token:
            log.warning("get_model_versions: SPECKLE_TOKEN not set — cannot list model versions")
            return []

        server = settings.speckle_server_url.rstrip("/")
        query = """
        query GetCommits($streamId: String!) {
          stream(id: $streamId) {
            commits { items { id message referencedObject createdAt authorName } }
          }
        }
        """
        headers = {
            "Authorization": f"Bearer {settings.speckle_token}",
            "Content-Type": "application/json",
        }
        log.info("get_model_versions: outbound GraphQL request → %s (streamId=%s)", server, stream_id)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    SPECKLE_GQL.format(server=server),
                    json={"query": query, "variables": {"streamId": stream_id}},
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()
                items = (
                    (data.get("data") or {})
                    .get("stream", {})
                    .get("commits", {})
                    .get("items", [])
                )
                log.info("get_model_versions: returned %d commits for stream=%s", len(items), stream_id)
                return items
        except Exception as exc:
            log.warning("get_model_versions: failed for stream=%s — %s", stream_id, exc)
            return []

    # ── fetch_version_objects ─────────────────────────────────

    async def fetch_version_objects(
        self, stream_id: str, version_id: str
    ) -> dict[str, Any]:
        """
        Fetches the Speckle object tree using the specklepy SDK and returns it in a
        format suitable for the metric extraction pipeline.

        How it works (specklepy path):
          1. Authenticate via SpeckleClient(host=server).authenticate_with_token(token)
          2. Resolve version_id (commit ID) → referencedObjectId via client.commit.get()
             Falls back to using version_id directly if commit resolution fails
             (e.g. version_id is already an object hash).
          3. Fetch the full object tree via ServerTransport + operations.receive().
             This uses specklepy's native transport which correctly calls the Speckle
             object API — avoiding the /streams/{id}/objects/{hash} REST route that
             returns a 302 redirect to the browser UI on local server deployments.
          4. Traverse the Base object tree via _collect_elements_from_base() and
             convert each node to a flat dict via _base_to_metric_dict().
          5. Return as:
             {"__archai_objects_wrapper": True, "elements": [flat_dicts], "__debug": {...}}
             so _get_elements_from_objects works without modification.

        Returns {} (not raises) when SPECKLE_TOKEN is not set (dev-mode stub).
        Raises on auth errors, commit-not-found, or network failures when a token IS set.
        """
        _log_config_status()

        if not settings.speckle_token:
            log.warning(
                "fetch_version_objects: SPECKLE_TOKEN not set — "
                "skipping object fetch for stream=%s version=%s",
                stream_id, version_id,
            )
            return {}

        server = settings.speckle_server_url.rstrip("/")
        log.info(
            "fetch_version_objects: starting specklepy fetch "
            "(server=%s stream=%s version=%s)",
            server, stream_id, version_id,
        )

        # specklepy uses requests (sync I/O) internally — run in a thread pool
        # so we don't block the async event loop during the fetch.
        object_hash, elements = await asyncio.to_thread(
            _fetch_objects_with_specklepy,
            server,
            settings.speckle_token,
            stream_id,
            version_id,
        )

        log.info(
            "fetch_version_objects: %d elements retrieved (stream=%s object=%s)",
            len(elements), stream_id, object_hash,
        )

        if not elements:
            log.warning(
                "fetch_version_objects: object tree returned 0 elements for "
                "stream=%s object=%s — model may have no typed geometry elements",
                stream_id, object_hash,
            )

        # Build type breakdown for debug logging
        type_counts: dict[str, int] = {}
        for elem in elements:
            t = str(elem.get("speckle_type") or elem.get("type") or "unknown").split(".")[-1]
            type_counts[t] = type_counts.get(t, 0) + 1

        if type_counts:
            log.debug(
                "fetch_version_objects: type breakdown — %s",
                ", ".join(
                    f"{k}={v}"
                    for k, v in sorted(type_counts.items(), key=lambda x: -x[1])[:15]
                ),
            )

        return {
            "__archai_objects_wrapper": True,
            "elements": elements,
            "__debug": {
                "total_object_count": len(elements),
                "stream_id": stream_id,
                "object_hash": object_hash,
                "type_counts": type_counts,
            },
        }

    # ── create_speckle_model_ref ──────────────────────────────

    async def create_speckle_model_ref(
        self,
        project_id: UUID,
        request: SyncSpeckleModelRequest,
    ) -> SpeckleModelRef:
        """Creates a SpeckleModelRef record linking a project to a specific version."""
        now = datetime.now(timezone.utc).isoformat()
        row: dict[str, Any] = {
            "id":             str(uuid4()),
            "project_id":     str(project_id),
            "stream_id":      request.stream_id,
            "branch_name":    request.branch_name,
            "version_id":     request.version_id,
            "model_name":     request.model_name,
            "commit_message": None,
            "selected_at":    now,
        }
        return await self._repo.create_speckle_model_ref(row)

    # ── derive_geometry_snapshot ──────────────────────────────

    async def derive_geometry_snapshot(
        self,
        run: PrecheckRun,
        model_ref: SpeckleModelRef,
        site_context: SiteContext | None = None,
    ) -> GeometrySnapshot:
        """
        Derives a GeometrySnapshot from a Speckle model version.

        Metric derivation pipeline:
          1. fetch_version_objects() — returns {} if no token (dev-mode)
             or raises on network/auth error (run → FAILED)
          2. _get_elements_from_objects() — unpack element pool
          3. _normalize_elements() — multi-connector normalization into semantic candidates
          4. _derive_metrics_from_candidates() — pure metric aggregation
          5. raw_metrics populated with rich debug/diagnostic info from candidates
          6. Persist and return the snapshot

        Callers must delete any existing snapshots for this run before calling this
        method (idempotency is the caller's responsibility — see the route handler).
        """
        now = datetime.now(timezone.utc)
        objects = await self.fetch_version_objects(model_ref.stream_id, model_ref.version_id)
        parcel_area_m2 = site_context.parcel_area_m2 if site_context else None

        # ── Run normalization pipeline ────────────────────────
        if not objects:
            metrics: list[GeometrySnapshotMetric] = []
            candidates: NormalizedCandidates | None = None
            unit_report: UnitNormalizationReport | None = None
            derivation_diagnostics: dict[str, Any] = {}
        else:
            all_elements = _get_elements_from_objects(objects)
            candidates = _normalize_elements(all_elements)
            # Stage 3.5 — unit detection, conversion, and plausibility check.
            # Converts IFC/generic candidates to metric in-place before aggregation.
            candidates, unit_report = detect_and_normalize_units(candidates, all_elements)
            metrics, derivation_diagnostics = _derive_metrics_from_candidates(candidates, parcel_area_m2)

        # ── Build raw_metrics debug blob ────────────────────────────────────────
        if not objects:
            raw_metrics: dict[str, Any] = {
                "fetch_skipped": True,
                "reason": (
                    "SPECKLE_TOKEN not set — configure SPECKLE_TOKEN in .env to enable "
                    "geometry extraction"
                    if not settings.speckle_token
                    else "fetch returned empty response — check stream_id and version_id"
                ),
                "metrics_derived": 0,
            }
        else:
            debug = objects.get("__debug", {})
            raw_metrics = {
                "fetch_skipped": False,
                "total_object_count": debug.get("total_object_count", 0),
                "stream_id": debug.get("stream_id"),
                "object_hash": debug.get("object_hash"),
                "type_counts": debug.get("type_counts", {}),
                "metrics_derived": len(metrics),
                "metric_keys": [m.key.value for m in metrics],
                # Stage 3.5 traceability: unit detection/conversion report
                "unit_normalization": unit_report.to_dict() if unit_report is not None else None,
            }
            if candidates is not None:
                raw_metrics["connector_styles_matched"] = candidates.connector_styles_matched
                raw_metrics["objects_by_broad_type"] = candidates.objects_by_broad_type
                raw_metrics["candidates"] = {
                    "area": {
                        "count": len(candidates.area_candidates),
                        "total_m2": round(
                            sum(c.value_m2 for c in candidates.area_candidates), 2
                        ),
                        "by_connector": _count_by_connector(candidates.area_candidates),
                        # Which IFC quantity paths matched successfully
                        "ifc_paths_matched": sorted({
                            c.source_field
                            for c in candidates.area_candidates
                            if c.connector_style == "ifc"
                        }),
                    },
                    "height": {
                        "count": len(candidates.height_candidates),
                        "max_m": round(
                            max(
                                (c.value_m for c in candidates.height_candidates),
                                default=0.0,
                            ),
                            2,
                        ),
                        "by_connector": _count_by_connector(
                            candidates.height_candidates
                        ),
                        "by_kind": {
                            kind: sum(
                                1 for c in candidates.height_candidates
                                if c.height_kind == kind
                            )
                            for kind in (
                                "absolute_elevation",
                                "computed_elevation",
                                "bbox_extent",
                                "storey_elevation",
                                "element_dimension",
                            )
                        },
                        "ifc_paths_matched": sorted({
                            c.source_field
                            for c in candidates.height_candidates
                            if c.connector_style == "ifc"
                        }),
                    },
                    "parking": {
                        "count": len(candidates.parking_candidates),
                        "by_connector": _count_by_connector(candidates.parking_candidates),
                    },
                }
                raw_metrics["extraction_notes"] = candidates.extraction_notes
                raw_metrics["metric_derivation"] = derivation_diagnostics

                # ── IFC-specific diagnostic summary ───────────────────────────
                # Collect a compact picture of which IFC types and quantity paths
                # were seen in the model, regardless of whether they yielded values.
                # This makes it practical to diagnose future zero-candidate cases.
                all_elements = objects.get("elements", [])
                ifc_types_seen: list[str] = []
                bq_keys_seen: set[str] = set()
                for e in all_elements[:5000]:   # cap to avoid excess CPU on huge models
                    ifc_t = str(e.get("ifcType") or e.get("type") or "")
                    if ifc_t.strip().lower().startswith("ifc"):
                        ifc_types_seen.append(ifc_t)
                    props = e.get("properties") or {}
                    bq = props.get("BaseQuantities") if isinstance(props, dict) else None
                    if isinstance(bq, dict):
                        bq_keys_seen.update(bq.keys())

                # Deduplicate preserving first-seen order, cap at 20
                seen_type_set: set[str] = set()
                unique_ifc_types: list[str] = []
                for t in ifc_types_seen:
                    tl = t.lower()
                    if tl not in seen_type_set:
                        seen_type_set.add(tl)
                        unique_ifc_types.append(t)
                        if len(unique_ifc_types) >= 20:
                            break

                raw_metrics["ifc_diagnostics"] = {
                    "sample_ifc_types": unique_ifc_types,
                    "base_quantities_keys_seen": sorted(bq_keys_seen),
                }

        if metrics:
            log.info(
                "derive_geometry_snapshot: %d metrics extracted — %s",
                len(metrics),
                ", ".join(f"{m.key.value}={m.value}" for m in metrics),
            )
        else:
            log.warning(
                "derive_geometry_snapshot: 0 metrics extracted for run=%s. "
                "raw_metrics reason: %s",
                run.id,
                raw_metrics.get("reason") or "see extraction_notes in raw_metrics",
            )

        row: dict[str, Any] = {
            "id":                   str(uuid4()),
            "project_id":           str(run.project_id),
            "run_id":               str(run.id),
            "speckle_model_ref_id": str(model_ref.id),
            # TODO: populate site_boundary from site_context.parcel_boundary once
            #       fetch_version_objects() returns real data and origin alignment
            #       is possible.
            "site_boundary":        None,
            # TODO: extract building_footprints [{objectId, polygon, level}] from
            #       lowest-level floor element outlines using shapely after real
            #       objects are available.
            "building_footprints":  [],
            # TODO: extract floors [{level, areaM2, objectIds}] from
            #       Objects.BuiltElements.Floor elements after real objects are available.
            "floors":               [],
            "metrics":              [m.model_dump() for m in metrics],
            "raw_metrics":          raw_metrics,
            "created_at":           now.isoformat(),
        }
        snapshot = await self._repo.create_geometry_snapshot(row)
        log.info(
            "Geometry snapshot created: id=%s run=%s metrics=%d",
            snapshot.id, run.id, len(metrics),
        )
        return snapshot


# ════════════════════════════════════════════════════════════
# SPECKLE SDK HELPERS
# Uses specklepy to fetch objects via the SDK's native transport,
# bypassing the /streams/{id}/objects/{hash} HTTP route that returns
# a 302 redirect on local Speckle server deployments.
# ════════════════════════════════════════════════════════════

def _configure_transport_session(transport: Any, token: str) -> None:
    """
    Ensures the specklepy ServerTransport's internal requests.Session will
    preserve the Bearer token on HTTP redirects.

    Why this is needed:
      The requests library strips the Authorization header when following a
      redirect to a different host or port (security default).  Some local
      Speckle server deployments redirect their objects REST endpoint (e.g.
      /streams/{id}/objects/{hash} → /objects/{id}/{hash}, or HTTP → HTTPS).
      Without this patch the redirected request is unauthenticated and the
      server returns 401 or an HTML login page instead of object data, which
      specklepy then surfaces as a confusing error.

    We re-apply the header on the underlying session so it is sent on every
    request — including redirects — regardless of host/port changes.
    The session attribute name is _session in specklepy 2.x; we guard the
    hasattr check so this is a no-op if the internal API changes.
    """
    session = getattr(transport, "_session", None)
    if session is None:
        log.debug(
            "_configure_transport_session: transport has no _session attribute "
            "— skipping redirect-auth patch (specklepy API may have changed)"
        )
        return
    session.headers.update({"Authorization": f"Bearer {token}"})
    log.debug(
        "_configure_transport_session: Bearer token applied to transport session "
        "— Authorization header will be preserved on redirects"
    )


def _get_speckle_client_options(server: str) -> tuple[str, bool, bool, bool]:
    """
    Derives SpeckleClient connection options from the configured server URL.

    Returns:
      (effective_host, use_ssl, verify_certificate, is_local_http_mode)
    """
    parsed = urlparse(server)
    scheme = (parsed.scheme or "").lower()
    hostname = (parsed.hostname or "").lower()

    use_ssl = scheme != "http"
    is_local_http_mode = not use_ssl and hostname in {"localhost", "127.0.0.1", "::1"}
    verify_certificate = not is_local_http_mode

    return server, use_ssl, verify_certificate, is_local_http_mode


def _resolve_referenced_object_via_graphql(
    server: str,
    token: str,
    stream_id: str,
    version_id: str,
) -> str:
    """
    Resolves a Speckle version/commit ID to its referencedObject hash via GraphQL.

    Uses requests (sync) since this runs inside asyncio.to_thread().
    Does NOT fall back — raises RuntimeError if the hash cannot be resolved so
    the caller can fail truthfully rather than using the wrong hash.

    GraphQL is already proven to work for this server (see get_model_versions).
    We avoid client.commit.get() entirely because the installed specklepy version
    may not expose a `commit` attribute on SpeckleClient.
    """
    import requests  # specklepy dependency — always available when specklepy is installed

    query = """
    query GetCommit($streamId: String!, $commitId: String!) {
      stream(id: $streamId) {
        commit(id: $commitId) {
          id
          referencedObject
        }
      }
    }
    """
    gql_url = f"{server.rstrip('/')}/graphql"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    log.info(
        "_resolve_referenced_object_via_graphql: resolving version_id=%s → referencedObject "
        "via GraphQL (stream=%s server=%s)",
        version_id, stream_id, server,
    )
    try:
        resp = requests.post(
            gql_url,
            json={"query": query, "variables": {"streamId": stream_id, "commitId": version_id}},
            headers=headers,
            timeout=30,
            verify=False if server.startswith("http://") else True,
        )
        resp.raise_for_status()
        data = resp.json()
        gql_errors = data.get("errors")
        if gql_errors:
            raise RuntimeError(f"GraphQL returned errors: {gql_errors}")
        referenced_object: str | None = (
            (data.get("data") or {})
            .get("stream", {})
            .get("commit", {})
            .get("referencedObject")
        )
        if not referenced_object:
            raise RuntimeError(
                f"GraphQL commit resolution returned no referencedObject for "
                f"version_id={version_id!r} in stream={stream_id!r}. "
                f"Full response: {data}"
            )
        log.info(
            "_resolve_referenced_object_via_graphql: SUCCESS — "
            "version_id=%s → referencedObject=%s (stream=%s)",
            version_id, referenced_object, stream_id,
        )
        return referenced_object
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(
            f"GraphQL commit resolution failed for version_id={version_id!r} "
            f"stream={stream_id!r}: {exc}"
        ) from exc


def _fetch_objects_with_specklepy(
    server: str,
    token: str,
    stream_id: str,
    version_id: str,
) -> tuple[str, list[dict[str, Any]]]:
    """
    Fetches and traverses a Speckle object tree using the specklepy SDK.

    This is a synchronous function — call via asyncio.to_thread() to avoid
    blocking the async event loop. specklepy uses the requests library (sync)
    internally for all network calls.

    Steps:
      1. Create SpeckleClient and authenticate with the token.
      2. Resolve version_id (commit ID) → referencedObject hash via GraphQL.
         GraphQL is used instead of client.commit.get() because the installed
         specklepy version may not expose a `commit` attribute on SpeckleClient.
         Resolution failure raises immediately — we do NOT fall back to using
         version_id directly as an object hash.
      3. Use ServerTransport + MemoryTransport + operations.receive() to fetch
         the full object tree. MemoryTransport is used as the local cache to
         avoid the SQLite threading warning that occurs when the default
         SQLiteTransport is garbage-collected in a different thread.
      4. Traverse the Base object tree via _collect_elements_from_base() and
         convert each node to a metric-extraction-ready dict via _base_to_metric_dict().

    Returns (object_hash, elements_list).
    Raises on authentication failure, commit-not-found, or network errors.
    """
    # Import inside the function so the import only loads when the token is set.
    # This also keeps specklepy out of the module-level import graph, making the
    # server start up correctly even if specklepy is not yet installed.
    from specklepy.api.client import SpeckleClient  # type: ignore[import-untyped]
    from specklepy.api import operations              # type: ignore[import-untyped]
    from specklepy.transports.server import ServerTransport  # type: ignore[import-untyped]
    from specklepy.transports.memory import MemoryTransport  # type: ignore[import-untyped]

    # ── Active-path markers (grep these in logs to confirm which path runs) ───
    log.info("USING SPECKLEPY FETCH PATH — server=%s stream=%s version=%s", server, stream_id, version_id)
    log.info("MANUAL HTTP OBJECT FETCH PATH DISABLED — specklepy SDK transport is the sole object retrieval path")

    effective_host, use_ssl, verify_certificate, is_local_http_mode = _get_speckle_client_options(server)
    log.info(
        "_fetch_objects_with_specklepy: SpeckleClient config - host=%s use_ssl=%s verify_certificate=%s",
        effective_host,
        use_ssl,
        verify_certificate,
    )
    if is_local_http_mode:
        log.info(
            "_fetch_objects_with_specklepy: local HTTP mode enabled for self-hosted Speckle "
            "(host=%s, use_ssl=False)",
            effective_host,
        )

    client = SpeckleClient(
        host=effective_host,
        use_ssl=use_ssl,
        verify_certificate=verify_certificate,
    )
    client.authenticate_with_token(token=token)
    log.info("_fetch_objects_with_specklepy: authenticated successfully against %s", effective_host)

    # ── Step 1: Resolve version_id → referencedObject hash via GraphQL ────────
    # We do NOT use client.commit.get() — the installed specklepy version may not
    # expose a `commit` attribute on SpeckleClient (API varies by version).
    # Failure here raises immediately; we never treat version_id as an object hash.
    object_hash = _resolve_referenced_object_via_graphql(server, token, stream_id, version_id)
    log.info(
        "_fetch_objects_with_specklepy: calling operations.receive() with "
        "referencedObject hash=%s (stream=%s)",
        object_hash, stream_id,
    )

    # ── Step 2: Fetch object tree via SDK transport ───────────────────────────
    # specklepy's ServerTransport uses a requests.Session internally.  Some local
    # Speckle server deployments return a 302 from their objects REST endpoint (e.g.
    # they redirect /streams/{id}/objects/{hash} to the browser UI or to HTTPS).
    # By default requests follows GET redirects but strips the Authorization header
    # when the redirect changes host or port.  We re-apply the Bearer token to the
    # transport's session so it survives any same-server redirect.
    #
    # MemoryTransport replaces the default SQLiteTransport for the local cache.
    # SQLiteTransport is NOT thread-safe across asyncio.to_thread boundaries: Python
    # raises "SQLite objects created in a thread can only be used in that same thread"
    # when the GC finalises the SQLite connection in a different OS thread.
    # MemoryTransport keeps everything in RAM within this thread call and is cleaned
    # up when this function returns — no cross-thread SQLite handles are left open.
    transport = ServerTransport(client=client, stream_id=stream_id)
    _configure_transport_session(transport, token)
    local_transport = MemoryTransport()

    try:
        root_obj = operations.receive(
            object_hash,
            remote_transport=transport,
            local_transport=local_transport,
        )
    except Exception as fetch_exc:
        exc_str = str(fetch_exc)
        if "302" in exc_str or "redirect" in exc_str.lower() or "found" in exc_str.lower():
            raise RuntimeError(
                f"Speckle server at {server!r} returned a redirect response when fetching "
                f"object hash {object_hash!r} for stream {stream_id!r}.  "
                f"This typically means the server's objects endpoint is redirecting to the "
                f"browser UI or to an HTTPS URL.  "
                f"Ensure SPECKLE_SERVER_URL in .env points to the correct API base URL "
                f"(e.g. http://127.0.0.1:3000 for a local deployment) and that the "
                f"backend container can reach that host.  "
                f"Original specklepy error: {fetch_exc}"
            ) from fetch_exc
        raise

    if root_obj is None:
        log.warning(
            "_fetch_objects_with_specklepy: operations.receive returned None "
            "for hash=%s stream=%s — model may be empty or hash is invalid",
            object_hash, stream_id,
        )
        return object_hash, []

    log.info(
        "_fetch_objects_with_specklepy: root object received (speckle_type=%s), "
        "traversing element tree...",
        getattr(root_obj, "speckle_type", "unknown"),
    )

    # ── Step 3: Flatten the tree into metric-extraction dicts ─────────────────
    elements = _collect_elements_from_base(root_obj)
    log.info(
        "_fetch_objects_with_specklepy: collected %d elements from object tree "
        "(stream=%s object=%s)",
        len(elements), stream_id, object_hash,
    )
    return object_hash, elements


def _collect_elements_from_base(root: Any, _depth: int = 0) -> list[dict[str, Any]]:
    """
    Recursively traverses a specklepy Base object tree and collects all nodes as
    flat dicts suitable for the metric extraction pipeline.

    Handles the nested element structures used by all major Speckle connectors:
      elements / @elements  — Revit, IFC, Civil3D, and Tekla connectors
      members  / @members   — Rhino connector
      children / @children  — older connector versions

    The `@` prefix marks detached (separately-stored) arrays. specklepy resolves
    these transparently via the transport, but some connector versions store them
    under the plain name without the prefix — we try both forms for safety.

    Depth is capped at 20 to prevent runaway recursion on malformed streams.
    """
    if _depth > 20 or root is None:
        return []

    result: list[dict[str, Any]] = []

    # Include this node if it carries a speckle_type (i.e. it is a typed element)
    if hasattr(root, "speckle_type"):
        result.append(_base_to_metric_dict(root))

    for key in ("elements", "@elements", "members", "@members", "children", "@children"):
        children = getattr(root, key, None)
        if children is None and key.startswith("@"):
            # Some connectors omit the @ prefix on the Python attribute
            children = getattr(root, key[1:], None)
        if isinstance(children, list):
            for child in children:
                if child is not None:
                    result.extend(_collect_elements_from_base(child, _depth + 1))

    return result


def _base_to_metric_dict(obj: Any) -> dict[str, Any]:
    """
    Shallow-converts a single specklepy Base object to a plain dict containing
    the fields needed for the multi-connector normalization pipeline.

    Fields captured:
      Core:        id, speckle_type, type, category, name, area, topElevation, height, units
      Revit:       parameters (param dict with .value sub-objects)
      IFC:         properties (property sets), quantities (quantity sets)
      Rhino/bbox:  layer, bbox (min/max Z for height proxy)
      Level:       level.elevation (for height proxy on Revit and IFC elements)

    Kept shallow intentionally. Nested Base sub-objects (level, parameters,
    properties, quantities, bbox) are handled one level deep.
    """
    d: dict[str, Any] = {
        "id":           getattr(obj, "id",           None),
        "speckle_type": getattr(obj, "speckle_type", None),
        "type":         getattr(obj, "type",         None),
        "category":     getattr(obj, "category",     None),
        # ifcType is the canonical IFC class name on direct-upload DataObjects
        # (e.g. "IFCSLAB", "IFCWALLSTANDARDCASE"). It is distinct from `type`
        # which connectors may leave empty or set to a display label.
        "ifcType":      getattr(obj, "ifcType",      None),
        "name":         getattr(obj, "name",         None),
        "area":         getattr(obj, "area",         None),
        "topElevation": getattr(obj, "topElevation", None),
        "height":       getattr(obj, "height",       None),
        "units":        getattr(obj, "units",        None),
    }

    # layer — Rhino connector stores semantic info in layer names
    layer = getattr(obj, "layer", None)
    if layer is not None:
        d["layer"] = str(layer)

    # level.elevation — height proxy for Revit and IFC elements
    level = getattr(obj, "level", None)
    if level is not None:
        if hasattr(level, "elevation"):
            d["level"] = {"elevation": getattr(level, "elevation", 0)}
        elif isinstance(level, dict):
            d["level"] = level

    # parameters — Revit connector exposes per-element parameters as a Base sub-object
    params = getattr(obj, "parameters", None)
    if params is not None:
        d["parameters"] = _convert_base_parameters(params)

    # properties — IFC connector property sets (Pset_SlabCommon, etc.)
    props = getattr(obj, "properties", None)
    if props is not None:
        d["properties"] = _extract_nested_dict(props)

    # quantities — IFC connector quantity sets (Qto_SlabBaseQuantities, etc.)
    qtys = getattr(obj, "quantities", None)
    if qtys is not None:
        d["quantities"] = _extract_nested_dict(qtys)

    # bbox — bounding box for height proxy (Rhino, some IFC/Revit connectors)
    bbox = getattr(obj, "bbox", None)
    if bbox is not None:
        d["bbox"] = _extract_bbox(bbox)

    return d


def _convert_base_parameters(params: Any) -> dict[str, Any]:
    """
    Converts a Revit parameters Base sub-object to the dict format expected
    by the normalization layer: {paramName: {"value": <scalar>}}.

    The Revit connector (v2 schema) exposes parameters as a Base object where
    each dynamic member is itself a Base object with a .value property (and
    other metadata like .name, .units, .applicationId).

    Falls through gracefully if params is already a plain dict (legacy path).
    """
    if isinstance(params, dict):
        return params

    result: dict[str, Any] = {}
    if not hasattr(params, "get_dynamic_member_names"):
        return result

    for name in params.get_dynamic_member_names():
        param = getattr(params, name, None)
        if param is None:
            continue
        if hasattr(param, "value"):
            result[name] = {"value": getattr(param, "value", None)}
        else:
            result[name] = param

    return result


def _extract_nested_dict(obj: Any, _depth: int = 0) -> dict[str, Any]:
    """
    Converts a Base sub-object (IFC property sets, quantity sets) to a plain
    nested dict. Capped at depth 3 to avoid performance issues on large models.
    Scalar values (int, float, str, bool, None) are returned as-is.
    """
    if _depth > 3 or obj is None:
        return {}
    if isinstance(obj, dict):
        return {k: _extract_nested_dict(v, _depth + 1) for k, v in obj.items()}
    if hasattr(obj, "get_dynamic_member_names"):
        result: dict[str, Any] = {}
        for name in obj.get_dynamic_member_names():
            val = getattr(obj, name, None)
            if isinstance(val, (int, float, str, bool)) or val is None:
                result[name] = val
            else:
                result[name] = _extract_nested_dict(val, _depth + 1)
        return result
    # Scalar — return wrapped so callers can distinguish missing vs zero
    return obj  # type: ignore[return-value]


def _extract_bbox(bbox: Any) -> dict[str, Any] | None:
    """
    Extracts min/max Z coordinates from a Speckle bounding box object.
    Used as a height proxy for Rhino and generic elements that lack formal
    elevation metadata.
    """
    if bbox is None:
        return None
    result: dict[str, float] = {}
    for key in ("min", "max", "minPt", "maxPt"):
        pt = getattr(bbox, key, None)
        if pt is None and isinstance(bbox, dict):
            pt = bbox.get(key)
        if pt is not None:
            z = getattr(pt, "z", None)
            if z is None and isinstance(pt, dict):
                z = pt.get("z")
            if isinstance(z, (int, float)):
                result[f"{key}_z"] = float(z)
    return result if result else None


# ════════════════════════════════════════════════════════════
# SEMANTIC CANDIDATES
# Internal typed structures for the normalization contract between
# raw object traversal and metric derivation.
#
# Each candidate preserves:
#   - source_obj_id   : Speckle object ID for traceability / viewer highlighting
#   - extracted value : the numeric value in metric units
#   - units           : original units string if known; None = assumed SI/metric
#   - confidence      : 0.0–1.0 score for prioritisation and debug
#   - source_field    : which property path produced the value
#   - connector_style : "revit" | "ifc" | "generic"
# ════════════════════════════════════════════════════════════

@dataclass
class AreaCandidate:
    """A floor/slab element with a derivable horizontal area (m²)."""
    source_obj_id: str
    value_m2: float
    units: str | None           # None = assumed metric
    confidence: float
    source_field: str
    connector_style: str        # "revit" | "ifc" | "generic"
    element_family: str = ""    # "slab" | "space" | ""; used to prevent slab+space double-count


@dataclass
class HeightCandidate:
    """A building element with a derivable vertical elevation or extent (m)."""
    source_obj_id: str
    value_m: float
    units: str | None
    confidence: float
    source_field: str
    connector_style: str
    height_kind: str = "absolute_elevation"
    # height_kind values (in priority order for building-height derivation):
    #
    # "absolute_elevation" — P1: absolute Z coordinate from the project datum.
    #     Sources: topElevation, RefElevation, bbox.max_z of individual elements.
    #     Takes the maximum across all P1 candidates as building height.
    #
    # "computed_elevation" — P1 (secondary): absolute elevation derived from
    #     level.elevation + element height. Reliable when level data is present.
    #
    # "bbox_extent" — P2: whole-building vertical extent from global bbox.
    #     Computed as max_z – min_z across ALL building-structural elements,
    #     with noise classes (furniture, MEP, annotations) excluded.
    #     A single synthetic candidate with source_obj_id="__global_bbox__".
    #
    # "storey_elevation" — P3: IfcBuildingStorey floor-level elevation.
    #     Building height estimated as storey span + avg floor-to-floor.
    #
    # "element_dimension" — P4 (weak fallback): element's own dimension field.
    #     Sources: height/overallHeight fields, BaseQuantities.Height, bbox
    #     extent of a single element. Represents one element's size, NOT the
    #     whole building. Clearly flagged as weak fallback in diagnostics.


@dataclass
class ParkingCandidate:
    """A parking-category element (count contributes to parking_spaces_provided)."""
    source_obj_id: str
    source_field: str
    connector_style: str


@dataclass
class NormalizedCandidates:
    """
    Output of the normalization layer: all semantic candidates extracted from
    the element pool, plus traceability/debug metadata.
    """
    area_candidates: list[AreaCandidate] = dc_field(default_factory=list)
    height_candidates: list[HeightCandidate] = dc_field(default_factory=list)
    parking_candidates: list[ParkingCandidate] = dc_field(default_factory=list)
    total_objects: int = 0
    objects_by_broad_type: dict[str, int] = dc_field(default_factory=dict)
    connector_styles_matched: list[str] = dc_field(default_factory=list)
    extraction_notes: list[str] = dc_field(default_factory=list)


# ════════════════════════════════════════════════════════════
# IFC CLASS SETS
# Known IFC class names (lowercase) used by the IFC extractor.
# The Speckle IFC connector may embed these in type, category, or
# speckle_type fields depending on version.
# ════════════════════════════════════════════════════════════

_IFC_FLOOR_CLASSES = frozenset({
    "ifcslab", "ifcplate", "ifcspace", "ifcfloor",
})
_IFC_STOREY_CLASSES = frozenset({
    "ifcbuildingstorey", "ifcstorey", "ifcbuildingstory",
})
_IFC_VERTICAL_CLASSES = frozenset({
    "ifcwall", "ifcwallstandardcase", "ifccurtainwall",
    "ifccolumn", "ifcbeam", "ifcmember", "ifcrailing",
})
_IFC_ROOF_CLASSES = frozenset({
    "ifcroof", "ifcroofing",
})
# Building-structural elements suitable for global-bbox height estimation.
# These are all classes whose bbox.max_z meaningfully contributes to building height.
_IFC_STRUCTURAL_FOR_BBOX = frozenset({
    "ifcwall", "ifcwallstandardcase", "ifccurtainwall",
    "ifccolumn", "ifcbeam", "ifcmember", "ifcrailing",
    "ifcslab", "ifcfloor", "ifcplate",
    "ifcroof", "ifcroofing",
    "ifcstair", "ifcstairflight",
    "ifcramp", "ifcrampflight",
    "ifcbuildingstorey",
    "ifcspace",
})
# Elements whose bbox data is likely noise and must be excluded from the
# global building-bbox height calculation.
_IFC_NOISE_CLASSES = frozenset({
    "ifcfurnishingelement", "ifcfurniture", "ifcchair", "ifctable", "ifcsofa",
    "ifclamp", "ifcannotation", "ifcvirtualelement",
    "ifcfastener", "ifcmechanicalfastener",
    "ifcsanitaryterminal",
    "ifcflowfitting", "ifcflowterminal", "ifcflowsegment",
    "ifcpipefitting", "ifcpipesegment",
    "ifcductsegment", "ifcductfitting",
    "ifccablesegment", "ifccablefitting",
    "ifcelectricdistributionboard", "ifcswitchingdevice", "ifclightfixture",
    "ifcproxy",
})


# ════════════════════════════════════════════════════════════
# NORMALIZATION LAYER
# Dispatcher: runs all connector-specific extractors over the element
# pool, deduplicates by source_obj_id (first match wins, higher-
# confidence extractors run first), and builds the NormalizedCandidates
# result with traceability metadata.
# ════════════════════════════════════════════════════════════

def _normalize_elements(elements: list[dict[str, Any]]) -> NormalizedCandidates:
    """
    Central normalization dispatcher.

    Runs three connector-specific extractors in priority order:
      1. Revit   — strong typing, Revit parameter dict, category strings
      2. IFC     — IFC class names, property sets, quantity sets
      3. Generic — name/layer hints, bbox fallback (Rhino and weakly typed)

    Candidates are deduplicated by source_obj_id: each object is claimed by
    the first extractor that produces a candidate for it. This means a Revit
    floor element is not double-counted by the IFC extractor even if it also
    has IFC-like fields.

    The NormalizedCandidates result carries extraction_notes describing what
    was found and what was missing — this becomes raw_metrics in the snapshot.
    """
    result = NormalizedCandidates(total_objects=len(elements))

    # Build broad type breakdown for raw_metrics reporting
    for elem in elements:
        t = str(elem.get("speckle_type") or elem.get("type") or "unknown").split(".")[-1]
        result.objects_by_broad_type[t] = result.objects_by_broad_type.get(t, 0) + 1

    # Run extractors (highest confidence first)
    rev_area, rev_height, rev_parking = _extract_revit_candidates(elements)
    ifc_area, ifc_height, ifc_parking = _extract_ifc_candidates(elements)
    gen_area, gen_height, gen_parking = _extract_generic_candidates(elements)

    # Merge with dedup by source_obj_id
    area_seen: set[str] = set()
    height_seen: set[str] = set()
    parking_seen: set[str] = set()

    for c in rev_area + ifc_area + gen_area:
        if c.source_obj_id not in area_seen:
            result.area_candidates.append(c)
            area_seen.add(c.source_obj_id)

    for c in rev_height + ifc_height + gen_height:
        if c.source_obj_id not in height_seen:
            result.height_candidates.append(c)
            height_seen.add(c.source_obj_id)

    # Stage 4 (P2): global building bbox — single synthetic candidate derived
    # from max_z − min_z across structural IFC elements, noise excluded.
    # Added after per-element dedup so it is never shadowed by a real element.
    global_bbox_candidate = _extract_global_bbox_height_candidate(elements)
    if global_bbox_candidate is not None:
        result.height_candidates.append(global_bbox_candidate)

    for c in rev_parking + ifc_parking + gen_parking:
        if c.source_obj_id not in parking_seen:
            result.parking_candidates.append(c)
            parking_seen.add(c.source_obj_id)

    # Record which connector styles contributed
    styles: set[str] = set()
    for lst in (result.area_candidates, result.height_candidates, result.parking_candidates):
        for c in lst:  # type: ignore[union-attr]
            styles.add(c.connector_style)
    result.connector_styles_matched = sorted(styles)

    # Build extraction notes
    notes = result.extraction_notes
    if rev_area:
        notes.append(f"Revit: {len(rev_area)} floor element(s) matched via Revit conventions")
    if ifc_area:
        notes.append(f"IFC: {len(ifc_area)} slab/space element(s) matched via IFC conventions")
    if gen_area:
        notes.append(f"Generic: {len(gen_area)} floor-like element(s) matched via name/layer hints")
    if not result.area_candidates:
        notes.append(
            "No area candidates found — no floor/slab elements recognized. "
            "Check that typed floor elements exist (Revit: Objects.BuiltElements.Floor; "
            "IFC: IfcSlab/IfcSpace; Generic: name/layer containing 'floor' or 'slab')"
        )
    if result.height_candidates:
        notes.append(
            f"Height candidates: {len(result.height_candidates)} total "
            f"(revit={len(rev_height)}, ifc={len(ifc_height)}, generic={len(gen_height)})"
        )
    else:
        notes.append(
            "No height candidates found — no elements with topElevation, "
            "level.elevation+height, bbox.max_z, or IFC quantity Height"
        )
    if result.parking_candidates:
        notes.append(
            f"Parking: {len(result.parking_candidates)} candidate(s) matched "
            f"(revit={len(rev_parking)}, ifc={len(ifc_parking)}, generic={len(gen_parking)})"
        )
    notes.append(
        "lot_coverage_pct not derivable — requires shapely + building footprint polygon "
        "(TODO: extract from lowest-level floor outlines)"
    )
    notes.append(
        "setback metrics not derivable — require shapely + parcel boundary polygon"
    )

    log.debug(
        "_normalize_elements: %d objects → %d area, %d height, %d parking candidates "
        "(connectors: %s)",
        len(elements),
        len(result.area_candidates),
        len(result.height_candidates),
        len(result.parking_candidates),
        result.connector_styles_matched or "none",
    )

    # ── Debug dump when extraction yields nothing ─────────────────────────────
    # Emit a compact sample of IFC-like objects so the root cause of zero
    # candidates can be diagnosed without adding extra instrumentation.
    if not result.area_candidates and not result.height_candidates:
        ifc_like = [
            e for e in elements
            if (
                str(e.get("ifcType") or "").strip()
                or str(e.get("type") or "").lower().startswith("ifc")
                or str(e.get("category") or "").lower().startswith("ifc")
                or bool(e.get("properties"))
                or bool(e.get("quantities"))
            )
        ]
        sample = ifc_like[:3]
        if sample:
            log.warning(
                "_normalize_elements: 0 area/height candidates despite %d IFC-like "
                "objects. Sample dump follows (3 of %d):",
                len(ifc_like), len(ifc_like),
            )
            for s in sample:
                props = s.get("properties") or {}
                bq_keys = (
                    list((props.get("BaseQuantities") or {}).keys())
                    if isinstance(props.get("BaseQuantities"), dict)
                    else []
                )
                log.warning(
                    "  id=%s ifcType=%r speckle_type=%r top_keys=%s "
                    "properties_keys=%s BaseQuantities_keys=%s",
                    s.get("id"),
                    s.get("ifcType"),
                    s.get("speckle_type"),
                    list(s.keys()),
                    list(props.keys())[:10],
                    bq_keys,
                )
        else:
            log.warning(
                "_normalize_elements: 0 area/height candidates and no IFC-like objects "
                "found in %d total elements. Sample broad types: %s",
                len(elements),
                dict(list(result.objects_by_broad_type.items())[:10]),
            )

    return result


# ════════════════════════════════════════════════════════════
# CONNECTOR-SPECIFIC EXTRACTORS
# Each extractor processes the full element pool and returns only the
# candidates it can confidently derive using its own conventions.
# Extractors do NOT call each other and do NOT filter by connector type
# exclusively — the dedup logic in _normalize_elements handles conflicts.
# ════════════════════════════════════════════════════════════

def _extract_revit_candidates(
    elements: list[dict[str, Any]],
) -> tuple[list[AreaCandidate], list[HeightCandidate], list[ParkingCandidate]]:
    """
    Extracts candidates using Revit-connector conventions.

    Recognition heuristics (any of these marks an element as Revit-origin):
      - speckle_type contains "Revit" or "Objects.BuiltElements"
      - element has a non-empty `parameters` dict (Revit-style param bag)

    Area extraction (floor elements):
      - speckle_type containing "Floor" → try area field, then Revit parameters
      - Parameters checked: HOST_AREA_COMPUTED, FLOOR_AREA, AREA
      Confidence: 0.9 (direct area field), 0.85 (Revit param)

    Height extraction (any Revit element):
      - topElevation field → direct elevation metric (confidence 0.9)
      - level.elevation + height → computed proxy (confidence 0.7)

    Parking extraction:
      - speckle_type contains "Parking" OR category == "parking"
    """
    area_candidates: list[AreaCandidate] = []
    height_candidates: list[HeightCandidate] = []
    parking_candidates: list[ParkingCandidate] = []

    for elem in elements:
        obj_id = str(elem.get("id") or "")
        speckle_type = str(elem.get("speckle_type") or "").lower()
        category = str(elem.get("category") or "").lower()

        # Revit-origin detection: speckle_type or parameters bag
        is_revit = (
            "revit" in speckle_type
            or "objects.builtelements" in speckle_type
            or bool(elem.get("parameters"))
        )
        if not is_revit:
            continue

        # ── Area candidates (floor elements) ──────────────────
        if _speckle_type_contains(elem, "Floor"):
            area, field = _try_extract_area_revit(elem)
            if area is not None and area > 0:
                area_candidates.append(AreaCandidate(
                    source_obj_id=obj_id,
                    value_m2=area,
                    units="m²",     # Revit connector outputs metric by default
                    confidence=0.9 if field == "area" else 0.85,
                    source_field=field,
                    connector_style="revit",
                ))

        # ── Height candidates ──────────────────────────────────
        top = elem.get("topElevation")
        if isinstance(top, (int, float)) and top > 0:
            height_candidates.append(HeightCandidate(
                source_obj_id=obj_id,
                value_m=float(top),
                units="m",
                confidence=0.9,
                source_field="topElevation",
                connector_style="revit",
                height_kind="absolute_elevation",
            ))
        else:
            # Fallback: level.elevation + element height
            level_elev = float((elem.get("level") or {}).get("elevation", 0) or 0)
            h = float(elem.get("height") or 0)
            combined = level_elev + h
            if combined > 0:
                height_candidates.append(HeightCandidate(
                    source_obj_id=obj_id,
                    value_m=combined,
                    units="m",
                    confidence=0.7,
                    source_field="level.elevation+height",
                    connector_style="revit",
                    height_kind="computed_elevation",
                ))

        # ── Parking candidates ─────────────────────────────────
        if _speckle_type_contains(elem, "Parking") or "parking" in category:
            parking_candidates.append(ParkingCandidate(
                source_obj_id=obj_id,
                source_field="speckle_type/category",
                connector_style="revit",
            ))

    return area_candidates, height_candidates, parking_candidates


def _try_extract_area_revit(elem: dict[str, Any]) -> tuple[float | None, str]:
    """
    Returns (area_m2, source_field) for a Revit floor element.
    Tries direct area field first, then Revit parameter bag.
    Returns (None, '') if no area is found.
    """
    area = elem.get("area")
    if isinstance(area, (int, float)):
        return float(area), "area"

    params = elem.get("parameters") or {}
    for param_key in ("HOST_AREA_COMPUTED", "FLOOR_AREA", "AREA"):
        param = params.get(param_key) or {}
        val = param.get("value") if isinstance(param, dict) else None
        if isinstance(val, (int, float)):
            return float(val), f"parameters.{param_key}.value"

    return None, ""


def _extract_ifc_candidates(
    elements: list[dict[str, Any]],
) -> tuple[list[AreaCandidate], list[HeightCandidate], list[ParkingCandidate]]:
    """
    Extracts candidates using IFC/direct-upload conventions.

    IFC models arrive in Speckle via two paths:
      A. Speckle IFC connector — maps IFC entities to Objects.BuiltElements.*
         (IfcSlab → Objects.BuiltElements.Floor, IfcWall → Objects.BuiltElements.Wall, etc.)
         IFC-specific data (property sets, quantity sets) is preserved in sub-objects.
      B. Direct upload / DataObject path — objects appear as generic DataObjects
         with IFC class names in type or category fields.

    Recognition heuristics (any of these marks an element as IFC-origin):
      - type or category field starts with "Ifc" (case-insensitive)
      - speckle_type contains "ifc"
      - element has `properties` or `quantities` sub-objects (IFC property/qty sets)

    Area extraction (slabs / spaces):
      - Direct area field (confidence 0.75)
      - Quantity sets: GrossArea, NetArea, NetFloorArea, GrossFloorArea (confidence 0.85)
      - Property sets: Pset_SlabCommon.GrossArea, Pset_SpaceCommon.NetFloorArea (confidence 0.85)

    Height extraction (walls, columns, beams):
      - topElevation, height fields (confidence 0.8)
      - level.elevation + height proxy (confidence 0.65)
      - Quantity set: Height, Length (confidence 0.75)
      - bbox.max_z - bbox.min_z (confidence 0.55)
      - Storey elevation for IfcBuildingStorey (confidence 0.6)

    Parking extraction:
      - "parking" in name/category (any IFC element)
    """
    area_candidates: list[AreaCandidate] = []
    height_candidates: list[HeightCandidate] = []
    parking_candidates: list[ParkingCandidate] = []

    for elem in elements:
        obj_id = str(elem.get("id") or "")
        speckle_type = str(elem.get("speckle_type") or "").lower()
        type_val = str(elem.get("type") or "").lower()
        category = str(elem.get("category") or "").lower()
        name = str(elem.get("name") or "").lower()
        # ifcType is the canonical IFC class on direct-upload DataObjects
        # (e.g. "IFCSLAB", "IFCWALLSTANDARDCASE") — checked before type/category
        ifc_type_field = str(elem.get("ifcType") or "").lower()

        # IFC-origin detection — check ifcType first (most reliable for direct uploads)
        ifc_class = _detect_ifc_class(speckle_type, type_val, category, ifc_type_field)
        has_ifc_hint = (
            bool(ifc_class)
            or "ifc" in speckle_type
            or "ifc" in type_val
            or "ifc" in category
            or "ifc" in ifc_type_field
            or bool(elem.get("properties"))
            or bool(elem.get("quantities"))
        )
        if not has_ifc_hint:
            continue

        # ── Area candidates (slabs, spaces, floors) ────────────
        is_floor_like = (
            ifc_class in _IFC_FLOOR_CLASSES
            or "slab" in ifc_type_field or "floor" in ifc_type_field
            or "space" in ifc_type_field or "plate" in ifc_type_field
            or "slab" in type_val or "slab" in category
            or "space" in type_val or "space" in category
            or _speckle_type_contains(elem, "Floor")
        )
        if is_floor_like:
            area, field = _try_extract_area_ifc(elem)
            if area is not None and area > 0:
                confidence = 0.85 if ("propert" in field or "quantit" in field) else 0.75
                # Classify element family so GFA aggregation can prefer slabs over spaces
                # and prevent counting the same floor plate twice.
                if (
                    ifc_class in {"ifcslab", "ifcfloor", "ifcplate"}
                    or any(kw in ifc_type_field for kw in ("slab", "floor", "plate"))
                    or any(kw in type_val for kw in ("slab", "floor"))
                    or _speckle_type_contains(elem, "Floor")
                ):
                    elem_family = "slab"
                elif (
                    ifc_class == "ifcspace"
                    or "space" in ifc_type_field
                    or "space" in type_val
                    or "space" in category
                ):
                    elem_family = "space"
                else:
                    elem_family = "slab"  # default for unclassified floor-like elements
                area_candidates.append(AreaCandidate(
                    source_obj_id=obj_id,
                    value_m2=area,
                    units=None,     # IFC typically outputs SI; preserve unknown for debug
                    confidence=confidence,
                    source_field=field,
                    connector_style="ifc",
                    element_family=elem_family,
                ))

        # ── Height candidates (walls, columns) ─────────────────
        is_vertical = (
            ifc_class in _IFC_VERTICAL_CLASSES
            or "wall" in ifc_type_field or "column" in ifc_type_field
            or "beam" in ifc_type_field or "member" in ifc_type_field
            or "curtainwall" in ifc_type_field or "railing" in ifc_type_field
            or "wall" in type_val or "column" in type_val
            or "beam" in type_val or "member" in type_val
        )
        is_storey = (
            ifc_class in _IFC_STOREY_CLASSES
            or "storey" in ifc_type_field or "story" in ifc_type_field
            or "storey" in type_val or "story" in type_val
        )

        if is_vertical:
            h, field = _try_extract_height_ifc(elem)
            if h is not None and h > 0:
                # Map field name → (height_kind, confidence).
                # Absolute/computed sources go to P1 tiers; element dimensions
                # go to P4 (weak fallback — element size, not building height).
                if field == "topElevation":
                    hkind, conf = "absolute_elevation", 0.80
                elif field == "level.elevation+height":
                    hkind, conf = "computed_elevation", 0.65
                elif field == "bbox.max_z":
                    # Per-element absolute Z — decent signal for walls/columns
                    hkind, conf = "absolute_elevation", 0.55
                elif field == "bbox.max_z-min_z":
                    # Per-element vertical extent — element dimension, not
                    # whole-building; will be superseded by global bbox (P2).
                    hkind, conf = "element_dimension", 0.35
                else:
                    # "overallHeight", "properties.BaseQuantities.Height",
                    # "properties.BaseQuantities.Length", "quantities.Height"
                    # etc. — element-dimension fields.  Weak fallback only.
                    hkind, conf = "element_dimension", 0.30
                height_candidates.append(HeightCandidate(
                    source_obj_id=obj_id,
                    value_m=h,
                    units=None,
                    confidence=conf,
                    source_field=field,
                    connector_style="ifc",
                    height_kind=hkind,
                ))
        if is_storey:
            elev = _try_extract_storey_elevation(elem)
            if elev is not None and elev >= 0:
                height_candidates.append(HeightCandidate(
                    source_obj_id=obj_id,
                    value_m=elev,
                    units=None,
                    confidence=0.6,
                    source_field="storey.elevation",
                    connector_style="ifc",
                    height_kind="storey_elevation",
                ))

        # ── Parking candidates ─────────────────────────────────
        if "parking" in name or "car park" in name or "carpark" in name or "parking" in category:
            parking_candidates.append(ParkingCandidate(
                source_obj_id=obj_id,
                source_field="name/category",
                connector_style="ifc",
            ))

    return area_candidates, height_candidates, parking_candidates


def _detect_ifc_class(
    speckle_type: str,
    type_val: str,
    category: str,
    ifc_type_val: str = "",
) -> str:
    """
    Returns the normalized (lowercase) IFC class name from the available fields,
    or '' if none is found.

    Field priority:
      1. ifc_type_val  — the `ifcType` attribute on direct-upload DataObjects
                         (e.g. "IFCSLAB", "IFCWALLSTANDARDCASE"). Most reliable.
      2. type_val      — may contain "IfcSlab" etc. on connector-mapped objects
      3. category      — fallback field sometimes used by older connectors
      4. speckle_type  — last resort; typically a Speckle SDK class name

    Case-insensitive: all inputs are already lowercased by callers.
    Handles dotted formats like "IFC.IfcSlab.Standard" — takes the first segment.
    """
    for val in (ifc_type_val, type_val, category, speckle_type):
        stripped = val.strip().lower()
        if stripped.startswith("ifc"):
            # Take only the first dotted segment to handle "IFC.IfcSlab.Standard" etc.
            return stripped.split(".")[0].split()[0]
    return ""


def _try_extract_area_ifc(elem: dict[str, Any]) -> tuple[float | None, str]:
    """
    Attempts to extract area (m²) from an IFC element.

    Field paths tried in order (highest confidence first):
      1. properties.Pset_SlabCommon.GrossArea / NetArea
      2. properties.Pset_SpaceCommon.NetFloorArea
      3. properties.Qto_SlabBaseQuantities.NetArea
      4. properties.Qto_FloorBaseQuantities.NetArea
      5. properties.Qto_SpaceBaseQuantities.NetFloorArea
      6. quantities.GrossArea / NetArea / NetFloorArea / GrossFloorArea
      7. Direct area field

    Returns (area_m2, source_field) or (None, '').
    """
    properties = elem.get("properties") or {}

    # ── BaseQuantities (direct IFC upload path) ────────────────────────────────
    # IFC models uploaded directly to Speckle (not via a connector) preserve the
    # IFC schema structure: properties.BaseQuantities.GrossArea, .NetArea, etc.
    # This must be checked before the Pset/Qto named sets below because those
    # sets are connector-mapped names and will not exist on direct-upload objects.
    base_quantities = properties.get("BaseQuantities")
    if isinstance(base_quantities, dict):
        for qty_key in ("GrossArea", "NetArea", "Area", "GrossFloorArea", "GrossFootprintArea"):
            val = base_quantities.get(qty_key)
            if isinstance(val, (int, float)):
                return float(val), f"properties.BaseQuantities.{qty_key}"

    # ── Named property / quantity sets (connector-mapped IFC path) ─────────────
    pset_checks: list[tuple[str, str]] = [
        ("Pset_SlabCommon",             "GrossArea"),
        ("Pset_SlabCommon",             "NetArea"),
        ("Pset_SpaceCommon",            "NetFloorArea"),
        ("Qto_SlabBaseQuantities",      "NetArea"),
        ("Qto_FloorBaseQuantities",     "NetArea"),
        ("Qto_SpaceBaseQuantities",     "NetFloorArea"),
        ("Pset_FloorCommon",            "GrossArea"),
    ]
    for pset_name, qty_key in pset_checks:
        pset = properties.get(pset_name)
        if isinstance(pset, dict):
            val = pset.get(qty_key)
            if isinstance(val, (int, float)):
                return float(val), f"properties.{pset_name}.{qty_key}"

    # ── Flat quantity dict (some connectors place quantities at top level) ─────
    quantities = elem.get("quantities") or {}
    for qty_key in ("GrossArea", "NetArea", "NetFloorArea", "GrossFloorArea", "TotalSurfaceArea"):
        val = _deep_get(quantities, qty_key)
        if isinstance(val, (int, float)):
            return float(val), f"quantities.{qty_key}"

    # Direct area field (lowest confidence for IFC — also caught by Revit extractor for typed floors)
    area = elem.get("area")
    if isinstance(area, (int, float)):
        return float(area), "area"

    return None, ""


def _try_extract_height_ifc(elem: dict[str, Any]) -> tuple[float | None, str]:
    """
    Attempts to extract a height value from an IFC wall/column/beam element.

    Sources are ordered with absolute-elevation sources FIRST, followed by
    computed elevations, and element-dimension fallbacks last.  The caller
    uses the returned source_field to classify the result into the correct
    height_kind tier.

    Priority order:
      1. topElevation               → absolute_elevation (absolute Z)
      2. level.elevation + height   → computed_elevation (absolute computed)
      3. bbox.max_z                 → absolute_elevation (per-element abs Z)
      4. overallHeight              → element_dimension  (element size)
      5. properties.BaseQuantities.Height / Length / Width
                                    → element_dimension
      6. quantities.Height / Length / Depth
                                    → element_dimension
      7. bbox.max_z - bbox.min_z    → element_dimension  (per-element extent)

    Returns (height_m, source_field) or (None, '').
    """
    # P1a: topElevation — absolute Z of top of this element
    top = elem.get("topElevation")
    if isinstance(top, (int, float)) and top > 0:
        return float(top), "topElevation"

    # P1b: level.elevation + height — computed absolute elevation
    h = float(elem.get("height") or 0)
    if h > 0:
        level_elev = float((elem.get("level") or {}).get("elevation", 0) or 0)
        return level_elev + h, "level.elevation+height"

    # P1c: bbox.max_z — absolute Z coordinate of element top from geometry
    bbox = elem.get("bbox") or {}
    if isinstance(bbox, dict):
        max_z = bbox.get("max_z")
        if isinstance(max_z, (int, float)) and max_z > 0:
            return float(max_z), "bbox.max_z"

    # P4: element-dimension fallbacks (weak — represent element size, not
    # building height).  Return these only when no absolute source exists.

    for field in ("overallHeight",):
        val = elem.get(field)
        if isinstance(val, (int, float)) and val > 0:
            return float(val), field

    # ── BaseQuantities (direct IFC upload path) ────────────────────────────
    # Walls/columns uploaded directly preserve Height, Length, Width in
    # properties.BaseQuantities — NOT a whole-building elevation.
    base_quantities = (elem.get("properties") or {}).get("BaseQuantities")
    if isinstance(base_quantities, dict):
        for qty_key in ("Height", "Length", "Width"):
            val = base_quantities.get(qty_key)
            if isinstance(val, (int, float)) and val > 0:
                return float(val), f"properties.BaseQuantities.{qty_key}"

    # ── Flat quantity dict (connector-mapped path) ─────────────────────────
    quantities = elem.get("quantities") or {}
    for qty_key in ("Height", "Length", "Depth"):
        val = _deep_get(quantities, qty_key)
        if isinstance(val, (int, float)) and val > 0:
            return float(val), f"quantities.{qty_key}"

    # bbox extent (per-element, weakest — single element vertical size)
    if isinstance(bbox, dict):
        max_z = bbox.get("max_z")
        min_z = bbox.get("min_z")
        if isinstance(max_z, (int, float)) and isinstance(min_z, (int, float)):
            extent = max_z - min_z
            if extent > 0:
                return extent, "bbox.max_z-min_z"

    return None, ""


def _try_extract_storey_elevation(elem: dict[str, Any]) -> float | None:
    """
    Extracts the floor-level elevation of an IfcBuildingStorey element.

    Checks (in order):
      1. elevation / RefElevation / refElevation — standard IFC storey fields
      2. properties.RefElevation / properties.Elevation — property-set fallback
      3. level.elevation — connector-mapped level object
    """
    for field in ("elevation", "RefElevation", "refElevation"):
        val = elem.get(field)
        if isinstance(val, (int, float)):
            return float(val)
    # Some connectors nest RefElevation inside a property dict
    props = elem.get("properties") or {}
    if isinstance(props, dict):
        for field in ("RefElevation", "Elevation"):
            val = props.get(field)
            if isinstance(val, (int, float)):
                return float(val)
    level = elem.get("level")
    if isinstance(level, dict):
        elev = level.get("elevation")
        if isinstance(elev, (int, float)):
            return float(elev)
    return None


def _collect_building_bbox(
    elements: list[dict[str, Any]],
) -> tuple[float | None, float | None, int, int]:
    """
    Scans the element pool to find global vertical extents for height P2.

    Only structural/architectural IFC elements are considered.
    Elements whose IFC class belongs to _IFC_NOISE_CLASSES (furniture,
    MEP, annotations, proxies, fixtures) are explicitly excluded so that
    stray geometry in the model does not corrupt the building-height estimate.

    Returns:
        (min_z, max_z, included_count, excluded_noise_count)
        min_z / max_z are None when no valid bbox data was found.
    """
    max_z_global: float | None = None
    min_z_global: float | None = None
    included = 0
    excluded_noise = 0

    for elem in elements:
        ifc_type_field = str(elem.get("ifcType") or "").lower()
        type_val = str(elem.get("type") or "").lower()
        speckle_type = str(elem.get("speckle_type") or "").lower()
        category = str(elem.get("category") or "").lower()

        ifc_class = _detect_ifc_class(
            speckle_type, type_val, category, ifc_type_field
        )

        # Only IFC-origin elements (have ifc class OR have property sets)
        has_ifc_hint = (
            bool(ifc_class)
            or any(
                src.startswith("ifc")
                for src in (ifc_type_field, type_val, category)
                if src
            )
            or bool(elem.get("properties"))
            or bool(elem.get("quantities"))
        )
        if not has_ifc_hint:
            continue

        # Exclude noise classes
        if ifc_class and ifc_class in _IFC_NOISE_CLASSES:
            excluded_noise += 1
            continue

        bbox = elem.get("bbox") or {}
        if not isinstance(bbox, dict):
            continue

        max_z = bbox.get("max_z")
        min_z = bbox.get("min_z")

        if isinstance(max_z, (int, float)):
            if max_z_global is None or max_z > max_z_global:
                max_z_global = float(max_z)
            included += 1
        if isinstance(min_z, (int, float)):
            if min_z_global is None or min_z < min_z_global:
                min_z_global = float(min_z)

    return min_z_global, max_z_global, included, excluded_noise


def _extract_global_bbox_height_candidate(
    elements: list[dict[str, Any]],
) -> "HeightCandidate | None":
    """
    Priority-2 height source: whole-building vertical extent from the global
    bounding box of building-structural IFC elements.

    Returns a single synthetic HeightCandidate with:
      source_obj_id = "__global_bbox__"
      height_kind   = "bbox_extent"
      value_m       = max_z − min_z across all included structural elements
      confidence    = 0.65

    Returns None when fewer than 3 structural elements have bbox data
    (not enough evidence to trust the global extent).
    """
    min_z, max_z, included_count, excluded_noise = _collect_building_bbox(
        elements
    )

    log.debug(
        "_extract_global_bbox_height_candidate: "
        "included=%d excluded_noise=%d min_z=%s max_z=%s",
        included_count, excluded_noise, min_z, max_z,
    )

    if included_count < 3 or max_z is None:
        log.debug(
            "_extract_global_bbox_height_candidate: skipped — "
            "not enough structural elements with bbox data (count=%d)",
            included_count,
        )
        return None

    min_z_safe = min_z if min_z is not None else 0.0
    extent = max_z - min_z_safe
    if extent <= 0:
        return None

    log.debug(
        "_extract_global_bbox_height_candidate: "
        "global_bbox height = %.2f m (max_z=%.2f min_z=%.2f, %d elements)",
        extent, max_z, min_z_safe, included_count,
    )
    return HeightCandidate(
        source_obj_id="__global_bbox__",
        value_m=round(extent, 4),
        units=None,
        confidence=0.65,
        source_field="global_bbox.max_z-min_z",
        connector_style="ifc",
        height_kind="bbox_extent",
    )


def _extract_generic_candidates(
    elements: list[dict[str, Any]],
) -> tuple[list[AreaCandidate], list[HeightCandidate], list[ParkingCandidate]]:
    """
    Extracts candidates from weakly-typed elements using name/layer hints.

    Applies to:
      - Rhino-origin models (Objects.Geometry.* types with layer names)
      - Any element not already matched by the Revit or IFC extractors
      - Direct Speckle uploads with minimal typing

    Strategy:
      Area:    name or layer contains "floor", "slab", or translations AND area > 0
      Height:  bbox.max_z present (absolute elevation proxy) OR topElevation field
      Parking: name or layer contains "parking", "car park", etc.

    Confidence: 0.5 (area), 0.4 (height via bbox), 0.5 (topElevation)
    These are intentionally lower than Revit/IFC to reflect the heuristic nature.

    Note: elements already handled by Revit or IFC extractors are skipped here
    to avoid low-confidence duplicates polluting the candidate pool.
    """
    area_candidates: list[AreaCandidate] = []
    height_candidates: list[HeightCandidate] = []
    parking_candidates: list[ParkingCandidate] = []

    # Keywords that hint at floor/slab elements across several languages
    _FLOOR_KEYWORDS = frozenset({
        "floor", "slab", "dalle", "platte", "nivel", "pavimento", "boden",
    })
    _PARKING_KEYWORDS = frozenset({
        "parking", "car park", "carpark", "stall", "parkplatz", "stationnement",
    })

    for elem in elements:
        obj_id = str(elem.get("id") or "")
        speckle_type = str(elem.get("speckle_type") or "").lower()
        type_val = str(elem.get("type") or "").lower()
        name = str(elem.get("name") or "").lower()
        layer = str(elem.get("layer") or "").lower()
        category = str(elem.get("category") or "").lower()

        # Skip elements already confidently identified by Revit or IFC extractors
        is_revit = (
            "revit" in speckle_type
            or "objects.builtelements" in speckle_type
            or bool(elem.get("parameters"))
        )
        ifc_type_field = str(elem.get("ifcType") or "").lower()
        ifc_class = _detect_ifc_class(speckle_type, type_val, category, ifc_type_field)
        is_ifc = (
            bool(ifc_class)
            or "ifc" in speckle_type or "ifc" in type_val or "ifc" in category
            or "ifc" in ifc_type_field
            or bool(elem.get("properties")) or bool(elem.get("quantities"))
        )
        if is_revit or is_ifc:
            continue

        combined_hint = f"{name} {layer} {category}"

        # ── Area candidates ────────────────────────────────────
        floor_hint = any(kw in combined_hint for kw in _FLOOR_KEYWORDS)
        if floor_hint:
            area = elem.get("area")
            if isinstance(area, (int, float)) and area > 0:
                area_candidates.append(AreaCandidate(
                    source_obj_id=obj_id,
                    value_m2=float(area),
                    units=None,     # unknown — flagged in notes
                    confidence=0.5,
                    source_field="area (name/layer hint)",
                    connector_style="generic",
                ))

        # ── Height candidates ──────────────────────────────────
        top_elev = elem.get("topElevation")
        if isinstance(top_elev, (int, float)) and top_elev > 0:
            height_candidates.append(HeightCandidate(
                source_obj_id=obj_id,
                value_m=float(top_elev),
                units=None,
                confidence=0.5,
                source_field="topElevation",
                connector_style="generic",
                height_kind="absolute_elevation",
            ))
        else:
            bbox = elem.get("bbox")
            if isinstance(bbox, dict):
                max_z = bbox.get("max_z")
                if isinstance(max_z, (int, float)) and max_z > 0:
                    height_candidates.append(HeightCandidate(
                        source_obj_id=obj_id,
                        value_m=float(max_z),
                        units=None,
                        confidence=0.4,
                        source_field="bbox.max_z",
                        connector_style="generic",
                        height_kind="absolute_elevation",
                    ))

        # ── Parking candidates ─────────────────────────────────
        if any(kw in combined_hint for kw in _PARKING_KEYWORDS):
            parking_candidates.append(ParkingCandidate(
                source_obj_id=obj_id,
                source_field="name/layer hint",
                connector_style="generic",
            ))

    return area_candidates, height_candidates, parking_candidates


# ════════════════════════════════════════════════════════════
# METRIC DERIVATION
# Pure function: aggregates normalized candidates into the
# GeometrySnapshotMetric list consumed by the compliance engine.
# ════════════════════════════════════════════════════════════

def _derive_metrics_from_candidates(
    candidates: NormalizedCandidates,
    parcel_area_m2: float | None,
) -> tuple[list[GeometrySnapshotMetric], dict[str, Any]]:
    """
    Derives V1 metrics from the normalized semantic candidates.

    Returns (metrics, derivation_diagnostics).  The diagnostics dict is stored
    verbatim in raw_metrics["metric_derivation"] for post-hoc traceability.

    GFA source-priority strategy (to prevent double-counting):
      1. Slab/floor family (IfcSlab, IfcFloor, IfcPlate) — physical floor plates
      2. Space family (IfcSpace) — fallback when no slab area available
      If both slab and space candidates exist, spaces are excluded with a note.

    Building-height source-priority strategy:
      Tier 1 — absolute elevations from non-storey elements
               (topElevation, level.elevation+height, bbox.max_z)
      Tier 2 — storey floor-level elevations: max_storey_elev + avg_floor_to_floor
      Tier 3 — element dimensions (wall Height, BaseQuantities.Height)
               WEAK FALLBACK — marked with a warning in computation_notes

    Metrics NOT derived (require shapely + footprint polygon):
      lot_coverage_pct, setback metrics
    """
    metrics: list[GeometrySnapshotMetric] = []
    diagnostics: dict[str, Any] = {}
    gfa: float | None = None

    # ── Gross Floor Area (source-priority to prevent double-counting) ───────────
    valid_area = [c for c in candidates.area_candidates if c.value_m2 > 0]
    gfa_diag: dict[str, Any] = {}

    if valid_area:
        slab_cands    = [c for c in valid_area if c.element_family == "slab"]
        space_cands   = [c for c in valid_area if c.element_family == "space"]
        other_cands   = [c for c in valid_area if c.element_family not in ("slab", "space")]

        gfa_diag["raw_counts_by_family"] = {
            "slab":    len(slab_cands),
            "space":   len(space_cands),
            "generic": len(other_cands),
        }

        if slab_cands:
            # Primary: use slab candidates; exclude spaces to avoid double-counting
            gfa_pool        = slab_cands + other_cands
            gfa_source      = "slab"
            gfa_diag["chosen_family"]        = "slab"
            if space_cands:
                gfa_diag["rejected_space_count"] = len(space_cands)
                gfa_diag["rejection_reason"] = (
                    f"Excluded {len(space_cands)} IfcSpace candidate(s) — "
                    "slab-based area preferred to prevent double-counting the same floor plate "
                    "as both IfcSlab and IfcSpace"
                )
        elif space_cands:
            # Fallback: no slabs found, use spaces
            gfa_pool   = space_cands + other_cands
            gfa_source = "space"
            gfa_diag["chosen_family"] = "space"
            gfa_diag["warning"] = (
                "No IfcSlab/IfcFloor candidates — GFA derived from IfcSpace areas. "
                "Verify source IFC contains slab elements."
            )
        else:
            # Generic fallback (Rhino / weakly typed)
            gfa_pool   = other_cands
            gfa_source = "generic"
            gfa_diag["chosen_family"] = "generic"

        if gfa_pool:
            gfa       = sum(c.value_m2 for c in gfa_pool)
            floor_ids = [c.source_obj_id for c in gfa_pool if c.source_obj_id]
            styles    = sorted({c.connector_style for c in gfa_pool})
            rejection_note = (
                f"; {len(space_cands)} IfcSpace candidate(s) excluded to prevent double-counting"
                if gfa_source == "slab" and space_cands
                else ""
            )
            metrics.append(GeometrySnapshotMetric(
                key=MetricKey.GROSS_FLOOR_AREA_M2,
                value=round(gfa, 2),
                units="m²",
                source_object_ids=floor_ids[:50],
                computation_notes=(
                    f"Sum of {len(gfa_pool)} {gfa_source} candidate(s) "
                    f"(connectors: {', '.join(styles)}){rejection_note}"
                ),
            ))
            log.debug("_derive_metrics: GFA = %.2f m² from %d %s candidates", gfa, len(gfa_pool), gfa_source)

    diagnostics["gfa"] = gfa_diag

    # ── Building Height (tiered source selection) ────────────────────────────────
    #
    # P1 — absolute_elevation / computed_elevation
    #       topElevation, level+height, bbox.max_z of individual elements
    # P2 — bbox_extent
    #       global max_z − min_z across all building-structural elements
    #       (noise-filtered; single synthetic candidate from _normalize_elements)
    # P3 — storey_elevation
    #       IfcBuildingStorey floor levels → span + avg floor-to-floor
    # P4 — element_dimension  (WEAK FALLBACK)
    #       wall Height, BaseQuantities.Height, bbox extent of one element
    valid_height = [c for c in candidates.height_candidates if c.value_m > 0]
    height_diag: dict[str, Any] = {}

    if valid_height:
        abs_pool = [
            c for c in valid_height
            if c.height_kind in ("absolute_elevation", "computed_elevation")
        ]
        bbox_pool = [
            c for c in valid_height
            if c.height_kind == "bbox_extent"
        ]
        storey_pool = [
            c for c in valid_height
            if c.height_kind == "storey_elevation"
        ]
        dim_pool = [
            c for c in valid_height
            if c.height_kind == "element_dimension"
        ]

        height_diag["total_candidates"] = len(valid_height)
        height_diag["by_kind"] = {
            "absolute_elevation": len(abs_pool),
            "bbox_extent": len(bbox_pool),
            "storey_elevation": len(storey_pool),
            "element_dimension": len(dim_pool),
        }

        chosen_height_m: float | None = None
        height_note: str = ""
        is_weak_fallback = False

        # P1 — absolute / computed elevations
        if abs_pool:
            best = max(abs_pool, key=lambda c: c.value_m)
            chosen_height_m = best.value_m
            height_note = (
                f"{best.source_field} (absolute elevation, "
                f"connector={best.connector_style}, "
                f"confidence={best.confidence:.2f}, "
                f"whole_building_source=True)"
            )
            height_diag["chosen_source_tier"] = "absolute_elevation"
            height_diag["chosen_source_kind"] = "absolute_elevation"
            height_diag["chosen_source"] = best.source_field
            height_diag["whole_building_source"] = True
            height_diag["rejected_kinds"] = [
                k for k, pool in (
                    ("bbox_extent", bbox_pool),
                    ("storey_elevation", storey_pool),
                    ("element_dimension", dim_pool),
                ) if pool
            ]

        # P2 — global building bbox extent
        elif bbox_pool:
            best = max(bbox_pool, key=lambda c: c.value_m)
            chosen_height_m = best.value_m
            height_note = (
                f"{best.source_field} = {best.value_m:.2f} m "
                f"(whole-building vertical extent from structural element "
                f"bboxes, noise excluded, "
                f"connector={best.connector_style}, "
                f"confidence={best.confidence:.2f})"
            )
            height_diag["chosen_source_tier"] = "bbox_building_extent"
            height_diag["chosen_source_kind"] = "bbox_extent"
            height_diag["chosen_source"] = best.source_field
            height_diag["whole_building_source"] = True
            height_diag["rejected_kinds"] = [
                k for k, pool in (
                    ("storey_elevation", storey_pool),
                    ("element_dimension", dim_pool),
                ) if pool
            ]

        # P3 — storey elevation based inference
        elif storey_pool:
            elevs = sorted(c.value_m for c in storey_pool)
            storey_count = len(elevs)
            storey_span = elevs[-1] - elevs[0]
            avg_ff = (
                storey_span / (storey_count - 1)
                if storey_count >= 2
                else 3.5  # typical floor-to-floor when only one storey found
            )
            # Building top ≈ span + one avg floor-to-floor for roof/top slab
            chosen_height_m = round(storey_span + avg_ff, 2)
            height_note = (
                f"storey.elevation: {storey_count} distinct storey(s), "
                f"span={storey_span:.2f}m + "
                f"avg_floor_to_floor={avg_ff:.2f}m "
                f"→ estimated_top={chosen_height_m:.2f}m"
            )
            height_diag["chosen_source_tier"] = "storey_elevation_estimated"
            height_diag["chosen_source_kind"] = "storey_elevation"
            height_diag["chosen_source"] = "storey.elevation"
            height_diag["whole_building_source"] = True
            height_diag["storey_count"] = storey_count
            height_diag["storey_elevations"] = elevs
            height_diag["storey_span_m"] = round(storey_span, 2)
            height_diag["avg_floor_to_floor_m"] = round(avg_ff, 2)
            height_diag["rejected_kinds"] = [
                k for k, pool in (
                    ("element_dimension", dim_pool),
                ) if pool
            ]
            log.info(
                "_derive_metrics: height from %d storey elevation(s) — "
                "span=%.2fm avg_ff=%.2fm estimated_top=%.2fm",
                storey_count, storey_span, avg_ff, chosen_height_m,
            )

        # P4 — element dimension (weak fallback)
        elif dim_pool:
            best = max(dim_pool, key=lambda c: c.value_m)
            chosen_height_m = best.value_m
            is_weak_fallback = True
            height_note = (
                f"WEAK FALLBACK: {best.source_field} "
                f"(element dimension — represents the height of a single "
                f"element, NOT the whole building). "
                f"No absolute elevation, global bbox, or storey data found. "
                f"Verify source model contains topElevation or storey "
                f"elevation data."
            )
            height_diag["chosen_source_tier"] = "weak_fallback_element_dimension"
            height_diag["chosen_source_kind"] = "element_dimension"
            height_diag["chosen_source"] = best.source_field
            height_diag["whole_building_source"] = False
            height_diag["warning"] = (
                f"Building height derived from element dimension field "
                f"({best.source_field}). "
                f"This is a single element's size, not the whole building. "
                f"Low confidence."
            )
            log.warning(
                "_derive_metrics: building height WEAK FALLBACK — "
                "using element dimension %s=%.2fm. "
                "No absolute elevation or global bbox data found.",
                best.source_field, best.value_m,
            )

        if chosen_height_m is not None and chosen_height_m > 0:
            # Include source object IDs for non-weak-fallback tiers (for
            # viewer highlighting).  Skip synthetic global-bbox ID.
            top_ids = (
                [
                    c.source_obj_id
                    for c in valid_height
                    if (
                        abs(c.value_m - chosen_height_m) < 0.01
                        and c.source_obj_id
                        and not c.source_obj_id.startswith("__")
                    )
                ][:10]
                if not is_weak_fallback
                else []
            )
            metrics.append(GeometrySnapshotMetric(
                key=MetricKey.BUILDING_HEIGHT_M,
                value=round(chosen_height_m, 2),
                units="m",
                source_object_ids=top_ids,
                computation_notes=height_note,
            ))
            log.debug(
                "_derive_metrics: building height = %.2f m "
                "(tier=%s source=%s whole_building=%s)",
                chosen_height_m,
                height_diag.get("chosen_source_tier", "unknown"),
                height_diag.get("chosen_source", "unknown"),
                height_diag.get("whole_building_source", "?"),
            )

    diagnostics["height"] = height_diag

    # ── FAR ────────────────────────────────────────────────────────────────────
    if gfa is not None and parcel_area_m2 and parcel_area_m2 > 0:
        far = gfa / parcel_area_m2
        metrics.append(GeometrySnapshotMetric(
            key=MetricKey.FAR,
            value=round(far, 4),
            units=None,
            source_object_ids=[],
            computation_notes=f"GFA {gfa:.1f} m² ÷ parcel {parcel_area_m2:.1f} m²",
        ))
        log.debug("_derive_metrics: FAR = %.4f", far)
    elif gfa is not None and not parcel_area_m2:
        log.debug(
            "_derive_metrics: FAR not derived — parcel_area_m2 missing from site_context"
        )

    # ── Parking spaces ─────────────────────────────────────────────────────────
    if candidates.parking_candidates:
        p_ids  = [c.source_obj_id for c in candidates.parking_candidates if c.source_obj_id]
        styles = sorted({c.connector_style for c in candidates.parking_candidates})
        metrics.append(GeometrySnapshotMetric(
            key=MetricKey.PARKING_SPACES_PROVIDED,
            value=float(len(candidates.parking_candidates)),
            units="spaces",
            source_object_ids=p_ids[:50],
            computation_notes=(
                f"Count of {len(candidates.parking_candidates)} parking candidates "
                f"(connectors: {', '.join(styles)})"
            ),
        ))
        log.debug("_derive_metrics: %d parking candidates", len(candidates.parking_candidates))

    log.debug("_derive_metrics: lot_coverage_pct → MISSING — requires shapely + footprint polygon")
    log.debug("_derive_metrics: setback metrics → MISSING — require shapely + parcel boundary polygon")

    return metrics, diagnostics


# ════════════════════════════════════════════════════════════
# EXTRACTION HELPERS
# Shared utilities used across the normalization and metric derivation layers.
# ════════════════════════════════════════════════════════════

def _get_elements_from_objects(objects: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Unpacks the element list from the fetch_version_objects wrapper, or traverses
    a legacy root-object dict format.

    This is the first step of the normalization pipeline after fetch.
    """
    if objects.get("__archai_objects_wrapper"):
        return [e for e in objects.get("elements", []) if isinstance(e, dict)]
    return _flatten_speckle_elements(objects)


def _count_by_connector(candidates: list) -> dict[str, int]:
    """Returns a count breakdown of candidates by connector_style."""
    result: dict[str, int] = {}
    for c in candidates:
        style = c.connector_style
        result[style] = result.get(style, 0) + 1
    return result


def _deep_get(d: Any, key: str) -> Any:
    """
    Gets a value from a nested dict by key, first match wins (BFS traversal).
    Returns None if the key is not found or d is not a dict.
    """
    if not isinstance(d, dict):
        return None
    if key in d:
        return d[key]
    for v in d.values():
        if isinstance(v, dict):
            result = _deep_get(v, key)
            if result is not None:
                return result
    return None


def _flatten_speckle_elements(
    obj: dict[str, Any], _depth: int = 0
) -> list[dict[str, Any]]:
    """
    Recursively collects all Speckle element dicts from a root object tree.

    Used for the legacy dict input format (manual tests, future direct-dict paths).
    When fetch_version_objects() returns the __archai_objects_wrapper format,
    this function is NOT called — the flat list from _collect_elements_from_base
    is used directly via _get_elements_from_objects().

    Depth is capped at 20 to prevent runaway recursion on malformed streams.
    """
    result: list[dict[str, Any]] = []
    if not isinstance(obj, dict) or _depth > 20:
        return result

    result.append(obj)

    for key in ("elements", "@elements", "members", "@members", "children", "@children"):
        children = obj.get(key)
        if isinstance(children, list):
            for child in children:
                if isinstance(child, dict):
                    result.extend(_flatten_speckle_elements(child, _depth + 1))

    return result


def _speckle_type_contains(elem: dict[str, Any], fragment: str) -> bool:
    """True if the element's speckle_type string contains the given fragment (case-insensitive)."""
    speckle_type = elem.get("speckle_type") or elem.get("type") or ""
    return fragment.lower() in str(speckle_type).lower()


def _extract_floor_area(floor: dict[str, Any]) -> float | None:
    """
    Extracts area (m²) from a Speckle floor element.

    Preserved for backward compatibility with any direct callers.
    The normalization pipeline uses _try_extract_area_revit() and
    _try_extract_area_ifc() internally.

    Connector-specific paths tried in order:
      1. Direct `area` field — Rhino, Civil3D, and IFC connectors
      2. parameters["HOST_AREA_COMPUTED"].value — Revit connector (floors)
      3. parameters["FLOOR_AREA"].value — Revit connector (alternate param name)
    """
    area = floor.get("area")
    if isinstance(area, (int, float)):
        return float(area)

    params = floor.get("parameters") or {}
    for param_key in ("HOST_AREA_COMPUTED", "FLOOR_AREA"):
        param = params.get(param_key) or {}
        val = param.get("value") if isinstance(param, dict) else None
        if isinstance(val, (int, float)):
            return float(val)

    return None


# ════════════════════════════════════════════════════════════
# LEGACY WRAPPER
# _extract_metrics_from_objects is preserved so any tests or callers
# that reference it directly continue to work. It now delegates to
# the normalization pipeline rather than containing its own extraction
# logic.
# ════════════════════════════════════════════════════════════

def _extract_metrics_from_objects(
    objects: dict[str, Any],
    parcel_area_m2: float | None,
) -> list[GeometrySnapshotMetric]:
    """
    Derives V1 metrics from the Speckle object data.

    This function is preserved for backward compatibility. Internally it delegates
    to the multi-connector normalization pipeline:
        _get_elements_from_objects → _normalize_elements → _derive_metrics_from_candidates

    For rich debug info from candidates, use derive_geometry_snapshot() which
    accesses NormalizedCandidates directly.

    Handles two input formats:
      1. Wrapper dict  {"__archai_objects_wrapper": True, "elements": [flat_list]}
         → returned by fetch_version_objects() when specklepy fetch succeeds.
      2. Root object dict  {"speckle_type": ..., "elements": [...], ...}
         → legacy / manual test input; traversed via _flatten_speckle_elements.
      3. Empty dict {} → returns [] (token not configured or fetch failed).
    """
    if not objects:
        return []

    all_elements = _get_elements_from_objects(objects)
    log.debug(
        "_extract_metrics_from_objects: %d elements in pool (wrapper=%s)",
        len(all_elements), objects.get("__archai_objects_wrapper", False),
    )
    candidates = _normalize_elements(all_elements)
    metrics, _ = _derive_metrics_from_candidates(candidates, parcel_area_m2)

    log.debug(
        "_extract_metrics_from_objects: %d elements → %d metrics (%s)",
        len(all_elements),
        len(metrics),
        ", ".join(m.key.value for m in metrics) or "none",
    )
    return metrics
