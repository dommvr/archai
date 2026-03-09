"""
ArchAI FastAPI backend — Tool 1: Smart Zoning & Code Checker + Permit Pre-Check
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from supabase._async.client import AsyncClient, create_client

from app.core.config import settings
from app.api.routes.precheck import router as precheck_router, project_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger("archai.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise shared resources on startup and tear them down on shutdown."""
    logger.info("Starting ArchAI backend…")

    # Supabase async client — service-role key for server-side DB access.
    # All route handlers receive it via Depends(get_repository).
    supabase: AsyncClient = await create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
    )
    app.state.supabase = supabase
    logger.info("Supabase async client ready")

    yield

    # Graceful shutdown — supabase-py has no explicit close(), but
    # the underlying httpx transport will be garbage-collected.
    logger.info("ArchAI backend shutting down")


app = FastAPI(
    title="ArchAI API",
    description="Backend services for the ArchAI platform — Tool 1: Permit Pre-Check",
    version="0.1.0",
    lifespan=lifespan,
    # Docs only enabled when LOG_LEVEL=debug (proxy for development mode).
    # Set LOG_LEVEL=info in production and the Swagger/ReDoc UIs disappear.
    docs_url="/docs" if settings.log_level.lower() == "debug" else None,
    redoc_url="/redoc" if settings.log_level.lower() == "debug" else None,
)

# ---------------------------------------------------------------------------
# CORS
# Tightened to the Next.js frontend origin in production.
# In development the frontend runs on localhost:3000.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_frontend_url],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

# ---------------------------------------------------------------------------
# Routers
# precheck_router  → /precheck/...   (run-scoped operations)
# project_router   → /projects/...   (project-scoped list operations)
# ---------------------------------------------------------------------------
app.include_router(precheck_router)
app.include_router(project_router)


@app.get("/health", tags=["infra"])
async def health_check():
    """Lightweight liveness probe for container orchestration / uptime monitors."""
    return {"status": "ok", "version": app.version}
