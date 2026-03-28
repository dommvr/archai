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

    # ── JWT verification ──────────────────────────────────────
    # Primary path (ES256 / RS256): no secret required — public keys are
    # fetched from the JWKS endpoint derived from supabase_url.
    #
    # Override the JWKS URL if your setup uses a non-standard path:
    #   SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json
    supabase_jwks_url: str | None = None

    # Legacy fallback (HS256): set this only if you still have tokens signed
    # with the old shared-secret key and need a transition window.
    # Leave unset on new deployments to hard-disable the HS256 path.
    # Find in: Supabase Dashboard → Settings → API → JWT Settings → JWT Secret
    supabase_jwt_secret: str | None = None

    @property
    def jwks_url(self) -> str:
        """
        Resolve the JWKS endpoint URL.
        Uses the explicit override if set, otherwise derives from supabase_url.
        Standard Supabase path: {project_url}/auth/v1/.well-known/jwks.json
        """
        if self.supabase_jwks_url:
            return self.supabase_jwks_url
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

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
    llm_model: str = "gpt-5.4"
    # Cheaper/faster model used for chunk classification only.
    # Override with CLASSIFICATION_MODEL env var to use a different model
    # than the full extraction pass (e.g. "gpt-4o-mini" for lower cost).
    classification_model: str = "gpt-5.4-mini"
    rule_extraction_confidence_threshold: float = 0.6

    # ── Copilot storage ───────────────────────────────────────
    # Supabase Storage bucket for Copilot file/screenshot attachments.
    # Create bucket "copilot-attachments" in Supabase Storage dashboard
    # with RLS enabled before using the attachment upload flow.
    copilot_attachments_bucket: str = "copilot-attachments"

    # ── Speckle ───────────────────────────────────────────────
    # TODO: set when Speckle integration is active
    speckle_server_url: str = "https://app.speckle.systems"
    speckle_token: str | None = None


# Singleton — import this everywhere
settings = Settings()  # type: ignore[call-arg]
