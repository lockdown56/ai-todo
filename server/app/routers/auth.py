from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.auth import create_access_token, require_auth, verify_credentials
from app.config import Settings, get_settings
from app.constants import DEFAULT_USER_ID
from app.errors import ApiError
from app.schemas import AuthLogin, AuthTokenResponse, AuthUserResponse

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
):
    if not verify_credentials(payload.username, payload.password, settings):
        raise ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误")
    token, expires_at = create_access_token(settings)
    return AuthTokenResponse(
        access_token=token,
        expires_in=settings.auth_token_ttl_seconds,
        expires_at=expires_at,
        user=current_user(settings),
    )


@router.get("/me", response_model=AuthUserResponse)
async def me(
    _: Annotated[dict[str, Any], Depends(require_auth)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    return current_user(settings)
