from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_jwt_auth
from app.database import get_session
from app.errors import ApiError
from app.schemas import ApiKeyCreate, ApiKeyCreatedResponse, ApiKeyResponse
from app.services import create_api_key, get_api_key, list_api_keys

router = APIRouter(
    prefix="/api/v1/api-keys",
    tags=["api-keys"],
    dependencies=[Depends(require_jwt_auth)],
)


@router.post("", response_model=ApiKeyCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key_endpoint(
    body: ApiKeyCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ApiKeyCreatedResponse:
    api_key, raw = create_api_key(session, body.name)
    await session.commit()
    await session.refresh(api_key)
    return ApiKeyCreatedResponse(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        last_used_at=api_key.last_used_at,
        expires_at=api_key.expires_at,
        created_at=api_key.created_at,
        api_key=raw,
    )


@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys_endpoint(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ApiKeyResponse]:
    keys = await list_api_keys(session)
    return [ApiKeyResponse.model_validate(key) for key in keys]


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key_endpoint(
    key_id: UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    api_key = await get_api_key(session, key_id)
    if api_key is None:
        raise ApiError(404, "API_KEY_NOT_FOUND", "API Key 不存在")
    await session.delete(api_key)
    await session.commit()
