from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.constants import DEFAULT_USER_ID
from app.database import get_session
from app.errors import ApiError
from app.services import API_KEY_PREFIX, verify_api_key

bearer_scheme = HTTPBearer(auto_error=False)


def _encode_segment(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode_segment(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def create_access_token(settings: Settings) -> tuple[str, datetime]:
    issued_at = datetime.now(UTC)
    expires_at = issued_at + timedelta(seconds=settings.auth_token_ttl_seconds)
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(DEFAULT_USER_ID),
        "username": settings.auth_username,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    header_segment = _encode_segment(
        json.dumps(header, separators=(",", ":"), sort_keys=True).encode()
    )
    payload_segment = _encode_segment(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    )
    signing_input = f"{header_segment}.{payload_segment}"
    signature = hmac.new(
        settings.auth_jwt_secret.encode(),
        signing_input.encode(),
        hashlib.sha256,
    ).digest()
    return f"{signing_input}.{_encode_segment(signature)}", expires_at


def decode_access_token(token: str, settings: Settings) -> dict[str, Any]:
    try:
        header_segment, payload_segment, signature_segment = token.split(".")
        signing_input = f"{header_segment}.{payload_segment}"
        expected_signature = hmac.new(
            settings.auth_jwt_secret.encode(),
            signing_input.encode(),
            hashlib.sha256,
        ).digest()
        signature = _decode_segment(signature_segment)
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError
        header = json.loads(_decode_segment(header_segment))
        payload = json.loads(_decode_segment(payload_segment))
        if header != {"alg": "HS256", "typ": "JWT"}:
            raise ValueError
        if payload.get("sub") != str(DEFAULT_USER_ID):
            raise ValueError
        if payload.get("username") != settings.auth_username:
            raise ValueError
        if not isinstance(payload.get("exp"), int):
            raise ValueError
    except (
        ValueError,
        TypeError,
        KeyError,
        UnicodeDecodeError,
        binascii.Error,
        json.JSONDecodeError,
    ):
        raise ApiError(401, "INVALID_TOKEN", "登录凭据无效或已失效") from None

    if payload["exp"] <= int(datetime.now(UTC).timestamp()):
        raise ApiError(401, "TOKEN_EXPIRED", "登录已过期，请重新登录")
    return payload


def verify_credentials(username: str, password: str, settings: Settings) -> bool:
    username_valid = hmac.compare_digest(username, settings.auth_username)
    password_valid = hmac.compare_digest(password, settings.auth_password)
    return username_valid & password_valid


async def require_auth(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise ApiError(401, "AUTH_REQUIRED", "请先登录")
    token = credentials.credentials
    if token.startswith(API_KEY_PREFIX):
        api_key = await verify_api_key(session, token)
        return {
            "credential_type": "api_key",
            "sub": str(api_key.user_id),
            "api_key_id": str(api_key.id),
        }
    payload = decode_access_token(token, settings)
    payload["credential_type"] = "jwt"
    return payload


async def require_jwt_auth(
    payload: Annotated[dict[str, Any], Depends(require_auth)],
) -> dict[str, Any]:
    if payload.get("credential_type") != "jwt":
        raise ApiError(403, "API_KEY_NOT_ALLOWED", "此接口不允许使用 API Key")
    return payload
