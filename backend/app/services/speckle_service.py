"""
backend/app/services/speckle_service.py

SpeckleService — model version selection, object fetch, and geometry snapshot derivation.

V1 scope:
  - SpeckleModelRef record creation
  - Geometry snapshot derivation with a full metric extraction pipeline
  - Metrics produced when real objects are available:
      gross_floor_area_m2, building_height_m, far, parking_spaces_provided
  - Metrics NOT yet derived (require shapely + parcel boundary polygon):
      front_setback_m, side_setback_left_m, side_setback_right_m, rear_setback_m,
      lot_coverage_pct
      → These resolve as missing_input in the compliance engine until shapely is added.
  - FAR is derived in Python from GFA + site_context.parcel_area_m2 (no shapely needed).

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
    "metric extraction", "fetch_skipped"
"""

from __future__ import annotations

import asyncio
import logging
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
        format suitable for _extract_metrics_from_objects.

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
             so _extract_metrics_from_objects works without modification.

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
          2. _extract_metrics_from_objects() — pure extraction from element pool
          3. FAR = GFA / parcel_area_m2 (no shapely needed, done inside extract fn)
          4. raw_metrics populated with debug/diagnostic info
          5. Persist and return the snapshot

        Callers must delete any existing snapshots for this run before calling this
        method (idempotency is the caller's responsibility — see the route handler).
        """
        now = datetime.now(timezone.utc)
        objects = await self.fetch_version_objects(model_ref.stream_id, model_ref.version_id)
        parcel_area_m2 = site_context.parcel_area_m2 if site_context else None
        metrics = _extract_metrics_from_objects(objects, parcel_area_m2)

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
                raw_metrics.get("reason") or "see type_counts in raw_metrics",
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
    flat dicts suitable for _extract_metrics_from_objects.

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
    only the fields needed for _extract_metrics_from_objects:
      id, speckle_type, type, category, area,
      topElevation, height, level (with elevation), parameters (Revit param dict).

    Kept shallow intentionally to avoid unbounded recursion on deep object graphs.
    Nested Base sub-objects (level, parameters) are handled one level deep.
    """
    d: dict[str, Any] = {
        "id":           getattr(obj, "id",           None),
        "speckle_type": getattr(obj, "speckle_type", None),
        "type":         getattr(obj, "type",         None),
        "category":     getattr(obj, "category",     None),
        "area":         getattr(obj, "area",         None),
        "topElevation": getattr(obj, "topElevation", None),
        "height":       getattr(obj, "height",       None),
    }

    # level.elevation — needed for building height proxy computation
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

    return d


def _convert_base_parameters(params: Any) -> dict[str, Any]:
    """
    Converts a Revit parameters Base sub-object to the dict format expected
    by _extract_floor_area: {paramName: {"value": <scalar>}}.

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


# ════════════════════════════════════════════════════════════
# METRIC EXTRACTION
# Parses the Speckle element pool to produce GeometrySnapshotMetric entries.
# All functions are pure (no I/O). They operate on the dict returned by
# fetch_version_objects() and return [] when that dict is empty.
# ════════════════════════════════════════════════════════════

def _extract_metrics_from_objects(
    objects: dict[str, Any],
    parcel_area_m2: float | None,
) -> list[GeometrySnapshotMetric]:
    """
    Derives V1 metrics from the Speckle object data.

    Handles two input formats:
      1. Wrapper dict  {"__archai_objects_wrapper": True, "elements": [flat_list]}
         → returned by fetch_version_objects() when specklepy fetch succeeds.
         The flat list is used directly (no recursion needed).
      2. Root object dict  {"speckle_type": ..., "elements": [...], ...}
         → legacy / manual test input.
         Traversed recursively via _flatten_speckle_elements.
      3. Empty dict {} → all rules become missing_input (token not configured).

    Speckle type conventions (SpeckleSystems/Objects kit, v2.x, all connectors):
      Objects.BuiltElements.Floor           — area (m²), elevation
      Objects.BuiltElements.Revit.RevitFloor — area via parameters.HOST_AREA_COMPUTED
      Objects.BuiltElements.Wall            — topElevation (height proxy)
      Objects.BuiltElements.Parking         — presence → parking_spaces_provided

    Metrics NOT derived here (require shapely + parcel boundary polygon):
      front_setback_m, side_setback_left_m, side_setback_right_m, rear_setback_m
        → TODO: extract building footprint polygon from lowest-level floor element
                outlines using shapely. Compute minimum distance from each footprint
                edge to the corresponding parcel boundary edge.
      lot_coverage_pct
        → TODO: footprint_polygon.area / parcel_area_m2 * 100 using shapely after
                extracting the ground-floor footprint polygon.
    """
    if not objects:
        return []

    # Unpack wrapper dict (specklepy path) vs traverse root object (legacy path)
    if objects.get("__archai_objects_wrapper"):
        all_elements: list[dict[str, Any]] = [
            e for e in objects.get("elements", [])
            if isinstance(e, dict)
        ]
        log.debug(
            "_extract_metrics_from_objects: using pre-flattened pool of %d objects",
            len(all_elements),
        )
    else:
        all_elements = _flatten_speckle_elements(objects)
        log.debug(
            "_extract_metrics_from_objects: traversed root object, found %d elements",
            len(all_elements),
        )

    metrics: list[GeometrySnapshotMetric] = []

    # ── Gross Floor Area (m²) ──────────────────────────────────
    # Source: Objects.BuiltElements.Floor → area field (m²).
    # Revit connector exposes area via parameters["HOST_AREA_COMPUTED"].value.
    floor_elems = [e for e in all_elements if _speckle_type_contains(e, "Floor")]
    floor_areas: list[float] = []
    floor_ids: list[str] = []
    for floor in floor_elems:
        area = _extract_floor_area(floor)
        if area and area > 0:
            floor_areas.append(area)
            if obj_id := floor.get("id"):
                floor_ids.append(str(obj_id))

    gfa: float | None = sum(floor_areas) if floor_areas else None
    if gfa is not None:
        metrics.append(GeometrySnapshotMetric(
            key=MetricKey.GROSS_FLOOR_AREA_M2,
            value=round(gfa, 2),
            units="m²",
            source_object_ids=floor_ids,
            computation_notes=f"Sum of {len(floor_areas)} floor element areas",
        ))
        log.debug(
            "_extract_metrics_from_objects: GFA = %.2f m² from %d floor elements",
            gfa, len(floor_areas),
        )
    else:
        log.debug(
            "_extract_metrics_from_objects: no floor elements with area found "
            "(floor_elems=%d, with_area=0)",
            len(floor_elems),
        )

    # ── Building Height (m) ────────────────────────────────────
    # Proxy: max topElevation across all building elements.
    # Revit connector sets topElevation on walls, columns, and structural framing.
    # TODO: For precision, compute max Z of Objects.BuiltElements.Roof bounding box
    #       minus the lowest slab elevation. Requires bbox data (available as `bbox`
    #       on most Revit connector outputs) once fetch_version_objects() is live.
    max_top: float | None = None
    height_ids: list[str] = []
    for elem in all_elements:
        top = elem.get("topElevation")
        if top is None:
            level_elev = float((elem.get("level") or {}).get("elevation", 0) or 0)
            h = float(elem.get("height") or 0)
            top = level_elev + h if (level_elev or h) else None
        if isinstance(top, (int, float)) and top > 0:
            if max_top is None or top > max_top:
                max_top = float(top)
                height_ids = []
            if top == max_top and (obj_id := elem.get("id")):
                height_ids.append(str(obj_id))

    if max_top is not None:
        metrics.append(GeometrySnapshotMetric(
            key=MetricKey.BUILDING_HEIGHT_M,
            value=round(max_top, 2),
            units="m",
            source_object_ids=height_ids[:10],
            computation_notes="Max topElevation across building elements (proxy)",
        ))
        log.debug(
            "_extract_metrics_from_objects: building height = %.2f m",
            max_top,
        )

    # ── FAR (floor area ratio) ─────────────────────────────────
    # FAR = GFA / parcel_area_m2.
    # Parcel area comes from site_context (not from the model), so FAR is computable
    # as soon as floor areas are known from the model and parcel area is in site_context.
    if gfa is not None and parcel_area_m2 and parcel_area_m2 > 0:
        far = gfa / parcel_area_m2
        metrics.append(GeometrySnapshotMetric(
            key=MetricKey.FAR,
            value=round(far, 4),
            units=None,
            source_object_ids=floor_ids,
            computation_notes=f"GFA {gfa:.1f} m² ÷ parcel {parcel_area_m2:.1f} m²",
        ))
        log.debug("_extract_metrics_from_objects: FAR = %.4f", far)

    # ── Parking spaces provided ────────────────────────────────
    # Source: Objects.BuiltElements.Parking or elements with category="Parking".
    # The Revit connector sets speckle_type = "Objects.BuiltElements.Revit.RevitElement"
    # and category = "Parking" for parking stall family instances.
    parking_elems = [
        e for e in all_elements
        if _speckle_type_contains(e, "Parking")
        or "parking" in str(e.get("category", "")).lower()
    ]
    if parking_elems:
        p_ids = [str(e["id"]) for e in parking_elems if "id" in e]
        metrics.append(GeometrySnapshotMetric(
            key=MetricKey.PARKING_SPACES_PROVIDED,
            value=float(len(parking_elems)),
            units="spaces",
            source_object_ids=p_ids[:50],
            computation_notes="Count of parking-category objects in model",
        ))
        log.debug(
            "_extract_metrics_from_objects: %d parking elements found",
            len(parking_elems),
        )

    log.debug(
        "_extract_metrics_from_objects: %d elements → %d metrics derived (%s)",
        len(all_elements),
        len(metrics),
        ", ".join(m.key.value for m in metrics) or "none",
    )
    return metrics


def _flatten_speckle_elements(
    obj: dict[str, Any], _depth: int = 0
) -> list[dict[str, Any]]:
    """
    Recursively collects all Speckle element dicts from a root object tree.

    Used for the legacy dict input format (manual tests, future direct-dict paths).
    When fetch_version_objects() returns the __archai_objects_wrapper format,
    this function is NOT called — the flat list from _collect_elements_from_base
    is used directly.

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
        val = param.get("value")
        if isinstance(val, (int, float)):
            return float(val)

    return None
