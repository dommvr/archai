"""
backend/app/services/site_data_provider.py

SiteDataProviderService — normalises address/site inputs into a SiteContext row.

Adapter strategy (V1):
  - Geocoding:     Nominatim (OpenStreetMap) — no API key required
  - Parcel data:   open-data stub → Regrid (paid) when REGRID_API_KEY is set
  - Zoning data:   manual-override first → Zoneomics (paid) when ZONEOMICS_API_KEY is set

Mirrors: SiteDataProviderServiceContract in lib/precheck/services.ts
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import httpx

from app.core.config import settings
from app.core.schemas import (
    Applicability,
    IngestSiteRequest,
    LatLng,
    Polygon,
    PrecheckRunStatus,
    SiteContext,
)
from app.repositories.precheck_repository import PrecheckRepository

log = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {"User-Agent": "ArchAI-Precheck/1.0 (contact@archai.app)"}


class SiteDataProviderService:
    """
    Mirrors SiteDataProviderServiceContract from lib/precheck/services.ts.
    """

    def __init__(self, repo: PrecheckRepository) -> None:
        self._repo = repo

    # ── geocode_address ───────────────────────────────────────

    async def geocode_address(self, address: str) -> LatLng | None:
        """
        V1: Nominatim (OpenStreetMap) geocoder — free, no API key.
        TODO: swap to Google Maps Platform or HERE Maps for higher accuracy.
        """
        try:
            async with httpx.AsyncClient(headers=NOMINATIM_HEADERS, timeout=10) as client:
                resp = await client.get(
                    NOMINATIM_URL,
                    params={"q": address, "format": "json", "limit": 1},
                )
                resp.raise_for_status()
                results = resp.json()
                if not results:
                    return None
                return LatLng(lat=float(results[0]["lat"]), lng=float(results[0]["lon"]))
        except Exception:
            log.warning("Geocoding failed for address=%r", address, exc_info=True)
            return None

    # ── get_parcel_by_point ───────────────────────────────────

    async def get_parcel_by_point(self, lat: float, lng: float) -> dict[str, Any] | None:
        """
        Returns raw parcel data for a coordinate.

        V1: Returns None — no open parcel data API is used by default.
        TODO: Integrate Regrid API (set REGRID_API_KEY) for national parcel coverage.
              Endpoint: GET https://app.regrid.com/api/v1/parcel/point?lat=&lon=&token=
        """
        if settings.regrid_api_key:
            # TODO: Regrid integration
            # async with httpx.AsyncClient() as client:
            #     resp = await client.get(
            #         "https://app.regrid.com/api/v1/parcel/point",
            #         params={"lat": lat, "lon": lng, "token": settings.regrid_api_key},
            #     )
            #     return resp.json().get("results", [None])[0]
            pass

        log.info("No parcel provider configured — parcel data will be empty for (%.6f, %.6f)", lat, lng)
        return None

    # ── get_zoning_by_parcel ──────────────────────────────────

    async def get_zoning_by_parcel(self, parcel_id: str) -> dict[str, Any] | None:
        """
        Returns raw zoning data for a parcel ID.

        V1: Returns None — no open zoning data API is used by default.
        TODO: Integrate Zoneomics API (set ZONEOMICS_API_KEY).
              Endpoint: GET https://zoneomics.com/api/v1/parcel/{parcel_id}
        TODO: Integrate city-specific open-data zoning GIS feeds, e.g.:
              NYC: https://data.cityofnewyork.us/City-Government/Zoning-Districts/kmep-waad
              LA:  https://data.lacity.org/A-Well-Run-City/Zoning-Code/2rrk-jymt
        """
        if settings.zoneomics_api_key:
            # TODO: Zoneomics integration
            pass

        return None

    # ── normalize_site_context ────────────────────────────────

    async def normalize_site_context(
        self,
        run_id: UUID | None,
        project_id: UUID,
        request: IngestSiteRequest,
    ) -> SiteContext:
        """
        Combines external provider data with manual overrides into a SiteContext row.

        Resolution order (highest priority wins):
          1. manual_overrides fields
          2. parcel/zoning provider data
          3. geocoder-derived data

        Persists to site_contexts table and returns the result.
        """
        overrides = request.manual_overrides

        # ── Step 1: geocode to get centroid if not provided ───
        centroid = request.centroid
        if centroid is None and request.address:
            centroid = await self.geocode_address(request.address)

        # ── Step 2: fetch parcel data by point ────────────────
        parcel_raw: dict[str, Any] | None = None
        if centroid:
            parcel_raw = await self.get_parcel_by_point(centroid.lat, centroid.lng)

        # ── Step 3: fetch zoning by parcel ────────────────────
        zoning_raw: dict[str, Any] | None = None
        parcel_id_str: str | None = None
        if parcel_raw:
            parcel_id_str = parcel_raw.get("id") or parcel_raw.get("parcel_id")
            if parcel_id_str:
                zoning_raw = await self.get_zoning_by_parcel(parcel_id_str)

        # ── Step 4: resolve final field values ────────────────
        # Manual overrides take priority over provider data.
        municipality    = (overrides and overrides.municipality)    or _extract(parcel_raw, "municipality")
        jurisdiction    = (overrides and overrides.jurisdiction_code) or _extract(zoning_raw, "jurisdiction_code")
        zoning_district = (overrides and overrides.zoning_district) or _extract(zoning_raw, "zoning_district")
        parcel_area_m2  = (overrides and overrides.parcel_area_m2)  or _to_float(_extract(parcel_raw, "area_sqm"))

        # ── Step 5: persist ───────────────────────────────────
        now = datetime.now(timezone.utc).isoformat()
        row: dict[str, Any] = {
            "id":               str(uuid4()),
            "project_id":       str(project_id),
            "address":          request.address,
            "municipality":     municipality,
            "jurisdiction_code": jurisdiction,
            "zoning_district":  zoning_district,
            "overlays":         [],   # TODO: populate from zoning provider
            "parcel_id":        parcel_id_str,
            "parcel_area_m2":   parcel_area_m2,
            "centroid":         centroid.model_dump() if centroid else None,
            "parcel_boundary":  (
                request.parcel_boundary.model_dump() if request.parcel_boundary
                else _extract_polygon(parcel_raw)
            ),
            "source_provider":  "nominatim+manual",
            "raw_source_data":  {"parcel": parcel_raw, "zoning": zoning_raw},
            "created_at":       now,
            "updated_at":       now,
        }

        site_context = await self._repo.upsert_site_context(row)
        log.info("Site context created: id=%s for run=%s", site_context.id, run_id)
        return site_context


# ── Helpers ───────────────────────────────────────────────────

def _extract(d: dict | None, key: str) -> str | None:
    if not d:
        return None
    return d.get(key)


def _to_float(v: Any) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _extract_polygon(d: dict | None) -> dict | None:
    """Attempt to extract a GeoJSON polygon from a parcel data dict."""
    if not d:
        return None
    return d.get("geometry") or d.get("boundary")
