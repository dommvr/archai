"""
backend/app/core/auth.py

Supabase JWT validation.

The Next.js route forwards the user's Supabase access token as
  Authorization: Bearer <token>
FastAPI validates it using one of two paths, chosen by the `alg` header claim:

  PRIMARY  — Asymmetric (ES256 / RS256)
    Active signing algorithm for Supabase projects on the newer key format.
    Public keys are fetched from the Supabase JWKS endpoint and cached in
    memory by PyJWKClient. Cache is invalidated automatically on a `kid` miss
    (i.e. after a key rotation). No secret needs to be deployed.

    JWKS URL (default): {SUPABASE_URL}/auth/v1/.well-known/jwks.json
    Override via: SUPABASE_JWKS_URL env var.

  FALLBACK — HS256 shared secret
    Retained for legacy tokens during key-rotation transitions.
    Active only when SUPABASE_JWT_SECRET is present in the environment.
    On fresh deployments leave SUPABASE_JWT_SECRET unset to hard-disable.

Architecture notes:
  - AuthenticatedUser output shape is unchanged; downstream code is unaffected.
  - extract_bearer_token is unchanged; dependencies.py is unaffected.
  - Never forward the service-role key to the client. That key is only used
    in the repository layer for server-side Supabase DB access.
"""

from __future__ import annotations

import functools
import logging

import jwt
from fastapi import HTTPException, status
from jwt import ExpiredSignatureError, InvalidTokenError, PyJWKClient

from app.core.config import settings

log = logging.getLogger(__name__)


# ── Public types ──────────────────────────────────────────────


class AuthenticatedUser:
    """Minimal user object extracted from a validated Supabase JWT."""

    def __init__(self, user_id: str, email: str | None = None) -> None:
        self.user_id = user_id
        self.email = email

    def __repr__(self) -> str:
        return f"AuthenticatedUser(user_id={self.user_id!r})"


# ── JWKS client singleton ─────────────────────────────────────


@functools.lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    """
    Return the module-level JWKS client, initialised exactly once.

    PyJWKClient fetches and caches the JWKS on first use, then re-fetches
    automatically whenever a `kid` is not found in the local cache (key
    rotation).  lru_cache makes this construction thread-safe without an
    explicit lock.
    """
    url = settings.jwks_url
    log.info("Initialising JWKS client → %s", url)
    return PyJWKClient(url, cache_jwk_set=True, cache_keys=True)


# ── Public entry points ───────────────────────────────────────


def validate_supabase_jwt(token: str) -> AuthenticatedUser:
    """
    Decode and validate a Supabase access token.

    Routing by `alg` claim in the JWT header:
      ES256 / RS256  → asymmetric JWKS path   (primary)
      HS256          → shared-secret path      (legacy fallback)

    Raises HTTPException 401 on any validation failure so that FastAPI
    returns a properly formatted error response.
    """
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError as exc:
        log.warning("JWT header parse failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    alg = header.get("alg", "")

    if alg in ("ES256", "RS256"):
        payload = _verify_asymmetric(token, alg)
    elif alg == "HS256":
        payload = _verify_hs256(token)
    else:
        log.warning("JWT rejected — unsupported algorithm: %r", alg)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Unsupported JWT algorithm: {alg}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing sub claim",
        )

    return AuthenticatedUser(
        user_id=user_id,
        email=payload.get("email"),
    )


def extract_bearer_token(authorization: str | None) -> str:
    """
    Parse 'Bearer <token>' from the Authorization header value.
    Raises 401 if the header is missing or malformed.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header missing",
            headers={"WWW-Authenticate": "Bearer"},
        )
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must be 'Bearer <token>'",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


# ── Private verification helpers ──────────────────────────────


def _verify_asymmetric(token: str, alg: str) -> dict:
    """
    Verify an ES256 or RS256 Supabase token via the JWKS endpoint.

    PyJWKClient matches the JWT's `kid` header to the correct public key
    from the cached JWKS.  On a cache miss it re-fetches automatically, so
    key rotations are handled without a restart.
    """
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=[alg],
            audience="authenticated",
            options={"verify_exp": True, "verify_aud": True},
        )
    except ExpiredSignatureError:
        log.info("Asymmetric JWT rejected — expired")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except InvalidTokenError as exc:
        log.warning("Asymmetric JWT validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _verify_hs256(token: str) -> dict:
    """
    Verify a legacy HS256 Supabase token using SUPABASE_JWT_SECRET.

    Returns 401 immediately if the secret is not configured, which
    hard-disables this path on deployments that have fully migrated to
    asymmetric signing.
    """
    if not settings.supabase_jwt_secret:
        log.warning(
            "HS256 token received but SUPABASE_JWT_SECRET is not set; "
            "legacy fallback is disabled — set SUPABASE_JWT_SECRET to enable"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Legacy token type not accepted",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={"verify_exp": True, "verify_aud": True},
        )
    except ExpiredSignatureError:
        log.info("HS256 JWT rejected — expired")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except InvalidTokenError as exc:
        log.warning("HS256 JWT validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
