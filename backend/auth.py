"""Cognito ID-token verification.

When Settings.auth_required is true, `current_sub` validates the Bearer token
against the Cognito pool's JWKS and returns the authenticated user's `sub`.
When it's false (tests, local dev), it returns None and the caller falls back
to a request-supplied candidate id.
"""
from functools import lru_cache

import jwt
from jwt import PyJWKClient
from fastapi import HTTPException, Request

from config.settings import Settings


@lru_cache
def _settings() -> Settings:
    return Settings()


@lru_cache
def _jwk_client(jwks_uri: str) -> PyJWKClient:
    return PyJWKClient(jwks_uri)


def _issuer(s: Settings) -> str:
    return f"https://cognito-idp.{s.cognito_region}.amazonaws.com/{s.cognito_user_pool_id}"


def current_sub(request: Request) -> str | None:
    """Return the verified Cognito sub, or None when auth is disabled."""
    s = _settings()
    if not s.auth_required:
        return None

    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = header[len("Bearer ") :]

    issuer = _issuer(s)
    try:
        signing_key = _jwk_client(f"{issuer}/.well-known/jwks.json").get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=s.cognito_client_id,
            issuer=issuer,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    if claims.get("token_use") != "id" or "sub" not in claims:
        raise HTTPException(status_code=401, detail="Wrong token type")
    return claims["sub"]
