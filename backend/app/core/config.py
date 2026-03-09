"""
backend/app/core/config.py

Application settings loaded from environment variables.
Uses pydantic-settings so .env files are automatically respected.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Supabase ──────────────────────────────────────────────
    supabase_url: str
    supabase_service_role_key: str
    # Used to validate incoming Supabase JWTs from the Next.js frontend.
    # Find in: Supabase Dashboard → Settings → API → JWT Settings → JWT Secret
    supabase_jwt_secret: str

    # ── App ───────────────────────────────────────────────────
    app_frontend_url: str = "http://localhost:3000"
    app_port: int = 8000
    log_level: str = "info"

    # ── Storage ───────────────────────────────────────────────
    documents_storage_bucket: str = "precheck-documents"

    # ── Site Data Providers ───────────────────────────────────
    # V1: Nominatim (OpenStreetMap) requires no API key.
    # Set these to switch to paid providers.
    regrid_api_key: str | None = None        # parcel data
    zoneomics_api_key: str | None = None     # zoning data

    # ── Embeddings ────────────────────────────────────────────
    # TODO: set when pgvector + OpenAI are wired
    openai_api_key: str | None = None
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536

    # ── LLM Rule Extraction ───────────────────────────────────
    # TODO: set when LangGraph agent is wired
    llm_model: str = "gpt-4o-mini"
    rule_extraction_confidence_threshold: float = 0.6

    # ── Speckle ───────────────────────────────────────────────
    # TODO: set when Speckle integration is active
    speckle_server_url: str = "https://app.speckle.systems"
    speckle_token: str | None = None


# Singleton — import this everywhere
settings = Settings()  # type: ignore[call-arg]
