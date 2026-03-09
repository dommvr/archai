"""
backend/app/core/auth.py

Supabase JWT validation.

The Next.js frontend passes the user's Supabase access token in the
Authorization: Bearer header. FastAPI validates it using the shared
SUPABASE_JWT_SECRET to confirm the request is from an authenticated user.

Never forward the service-role key to the client. The service-role key is
only used for server-side Supabase operations in the repository layer.
"""

from __future__ import annotations

import jwt
from fastapi import HTTPException, status
from jwt import ExpiredSignatureError, InvalidTokenError

from app.core.config import settings


class AuthenticatedUser:
    """Minimal user object extracted from a validated Supabase JWT."""

    def __init__(self, user_id: str, email: str | None = None) -> None:
        self.user_id = user_id
        self.email = email

    def __repr__(self) -> str:
        return f"AuthenticatedUser(user_id={self.user_id!r})"


def validate_supabase_jwt(token: str) -> AuthenticatedUser:
    """
    Decode and validate a Supabase JWT.

    Supabase issues HS256 JWTs signed with the project's JWT secret.
    The `aud` claim is "authenticated" for logged-in users.

    Raises HTTPException(401) on any validation failure.
    """
    try:
        payload: dict = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={
                "verify_exp": True,
                "verify_aud": True,
            },
        )
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
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
