"""
backend/app/core/dependencies.py

FastAPI dependency-injection wiring.

Services are instantiated once at startup and cached on app.state.
Route handlers receive them via Depends() — keeping handlers thin.
"""

from __future__ import annotations

from fastapi import Depends, Header, Request

from app.core.auth import AuthenticatedUser, extract_bearer_token, validate_supabase_jwt
from app.repositories.precheck_repository import PrecheckRepository
from app.services.compliance_engine import ComplianceEngineService
from app.services.document_ingestion import DocumentIngestionService
from app.services.realtime_publisher import RealtimePublisher
from app.services.rule_extraction import RuleExtractionService
from app.services.site_data_provider import SiteDataProviderService
from app.services.speckle_service import SpeckleService


# ── Auth dependency ───────────────────────────────────────────

async def get_current_user(
    authorization: str | None = Header(default=None),
) -> AuthenticatedUser:
    """Validates the Supabase JWT and returns the authenticated user."""
    token = extract_bearer_token(authorization)
    return validate_supabase_jwt(token)


# ── Repository dependency ─────────────────────────────────────

async def get_repository(request: Request) -> PrecheckRepository:
    """Returns the shared PrecheckRepository (backed by the app-state Supabase client)."""
    return PrecheckRepository(client=request.app.state.supabase)


# ── Service dependencies ──────────────────────────────────────

async def get_site_data_provider(
    repo: PrecheckRepository = Depends(get_repository),
) -> SiteDataProviderService:
    return SiteDataProviderService(repo=repo)


async def get_document_ingestion(
    request: Request,
    repo: PrecheckRepository = Depends(get_repository),
) -> DocumentIngestionService:
    return DocumentIngestionService(repo=repo, supabase=request.app.state.supabase)


async def get_rule_extraction(
    repo: PrecheckRepository = Depends(get_repository),
) -> RuleExtractionService:
    return RuleExtractionService(repo=repo)


async def get_speckle_service(
    repo: PrecheckRepository = Depends(get_repository),
) -> SpeckleService:
    return SpeckleService(repo=repo)


async def get_compliance_engine(
    repo: PrecheckRepository = Depends(get_repository),
) -> ComplianceEngineService:
    return ComplianceEngineService(repo=repo)


async def get_realtime_publisher(
    repo: PrecheckRepository = Depends(get_repository),
) -> RealtimePublisher:
    return RealtimePublisher(repo=repo)
