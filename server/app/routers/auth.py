from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_access_token, require_auth, verify_credentials
from app.config import Settings, get_settings
from app.constants import DEFAULT_USER_ID
from app.database import get_session
from app.errors import ApiError
from app.schemas import (
    AuthLogin,
    AuthLogoutRequest,
    AuthRefreshRequest,
    AuthTokenResponse,
    AuthUserResponse,
)
from app.services import create_refresh_token, revoke_refresh_token, rotate_refresh_token

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def current_user(settings: Settings) -> AuthUserResponse:
    return AuthUserResponse(
        id=DEFAULT_USER_ID,
        username=settings.auth_username,
        display_name=settings.auth_display_name,
    )


@router.post("/login", response_model=AuthTokenResponse)
async def login(
    payload: AuthLogin,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if not verify_credentials(payload.username, payload.password, settings):
        raise ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误")
    refresh_token, raw_refresh_token = create_refresh_token(session, settings)
    await session.commit()
    token, expires_at = create_access_token(settings)
    return AuthTokenResponse(
        access_token=token,
        expires_in=settings.auth_token_ttl_seconds,
        expires_at=expires_at,
        refresh_token=raw_refresh_token,
        refresh_expires_at=refresh_token.expires_at,
        user=current_user(settings),
    )


@router.post("/refresh", response_model=AuthTokenResponse)
async def refresh(
    payload: AuthRefreshRequest,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    refresh_token, raw_refresh_token = await rotate_refresh_token(
        session,
        payload.refresh_token,
        settings,
    )
    token, expires_at = create_access_token(settings)
    return AuthTokenResponse(
        access_token=token,
        expires_in=settings.auth_token_ttl_seconds,
        expires_at=expires_at,
        refresh_token=raw_refresh_token,
        refresh_expires_at=refresh_token.expires_at,
        user=current_user(settings),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: AuthLogoutRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    await revoke_refresh_token(session, payload.refresh_token)


@router.get("/me", response_model=AuthUserResponse)
async def me(
    _: Annotated[dict[str, Any], Depends(require_auth)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    return current_user(settings)
