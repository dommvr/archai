"""
backend/tests/test_suggested_docs_contract.py

Contract tests for the suggested-docs feature integration.

These tests verify:
1. SiteContext schema exposes the fields that the suggested-docs frontend
   feature depends on (municipality, parcel_id, address).
2. IngestSiteRequest / ManualSiteOverrides expose municipality so it can be
   forwarded to /api/site-context/suggested-docs.

Note: district (powiat) and province (województwo) are added by migration
20240301000019 and are present in the frontend Zod schema and the database
but are NOT yet reflected in backend/app/core/schemas.py. The TODO to add
them is tracked in the migration notes. The tests below document that gap.

No network, no database, no FastAPI required.

Run with:
    cd backend
    pytest tests/test_suggested_docs_contract.py -v
"""

from __future__ import annotations

import typing

from app.core.schemas import (
    IngestSiteRequest,
    ManualSiteOverrides,
    SiteContext,
)


def _is_optional(annotation: object) -> bool:
    """Return True if the annotation is Optional[X] / X | None.

    Handles both the legacy typing.Union form and the Python 3.10+
    types.UnionType (X | None) form.
    """
    import types as _types
    origin = getattr(annotation, "__origin__", None)
    args = getattr(annotation, "__args__", ())
    # typing.Union[X, None]  (Python < 3.10 or explicit Optional[X])
    if origin is typing.Union and type(None) in args:
        return True
    # X | None  (Python 3.10+ union syntax — produces types.UnionType)
    if isinstance(annotation, _types.UnionType) and type(None) in args:
        return True
    return False


# ── SiteContext field contract ───────────────────────────────────────────────


class TestSiteContextContract:
    """SiteContext exposes the fields the suggested-docs feature depends on."""

    def test_municipality_field_exists(self):
        """municipality is the primary gmina key for suggested-docs queries."""
        assert "municipality" in SiteContext.model_fields

    def test_address_field_exists(self):
        """address is the fallback key when municipality is absent."""
        assert "address" in SiteContext.model_fields

    def test_parcel_id_field_exists(self):
        """parcel_id is forwarded as supplemental context."""
        assert "parcel_id" in SiteContext.model_fields

    def test_jurisdiction_code_field_exists(self):
        """jurisdiction_code is forwarded when parcel_id is absent."""
        assert "jurisdiction_code" in SiteContext.model_fields

    def test_district_province_gap(self):
        """
        district (powiat) and province (województwo) exist in the frontend
        Zod schema (migration 20240301000019) but are NOT yet in the Python
        schema. This test documents that gap so it is visible in CI.

        TODO: once backend/app/core/schemas.py is updated to include these
        columns, replace this test with nullable assertions.
        """
        missing = [
            f for f in ("district", "province")
            if f not in SiteContext.model_fields
        ]
        assert missing == ["district", "province"], (
            "district/province are now in the Python schema — remove this "
            "gap test and add proper Optional[str] assertions instead."
        )

    def test_municipality_is_nullable(self):
        """
        municipality is Optional[str] — many parcels lack a resolved gmina
        until the ULDK call returns. The suggested-docs route falls back to
        the address field in that case.
        """
        field = SiteContext.model_fields["municipality"]
        assert _is_optional(field.annotation), (
            "SiteContext.municipality should be Optional[str]."
        )

    def test_parcel_id_is_nullable(self):
        """parcel_id is Optional[str] — not all contexts have a parcel."""
        field = SiteContext.model_fields["parcel_id"]
        assert _is_optional(field.annotation), (
            "SiteContext.parcel_id should be Optional[str]."
        )


# ── IngestSiteRequest / ManualSiteOverrides ──────────────────────────────────


class TestIngestSiteRequestContract:
    """IngestSiteRequest can carry the overrides the frontend sends."""

    def test_manual_overrides_field_exists(self):
        assert "manual_overrides" in IngestSiteRequest.model_fields

    def test_manual_overrides_has_municipality(self):
        """
        ManualSiteOverrides.municipality is required — it is the primary
        gmina key forwarded to the suggested-docs query builder.
        """
        assert "municipality" in ManualSiteOverrides.model_fields

    def test_address_field_exists_on_ingest_request(self):
        """address on IngestSiteRequest is the fallback for suggested-docs."""
        assert "address" in IngestSiteRequest.model_fields
