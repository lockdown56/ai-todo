from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import DEFAULT_USER_ID
from app.database import get_session
from app.errors import ApiError
from app.models import Tag
from app.repositories import get_tag
from app.schemas import TagCreate, TagResponse, TagUpdate

router = APIRouter(prefix="/api/v1/tags", tags=["tags"])


async def ensure_unique_name(
    session: AsyncSession, name: str, *, excluding: UUID | None = None
) -> None:
    query = select(Tag.id).where(
        Tag.user_id == DEFAULT_USER_ID,
        func.lower(Tag.name) == name.lower(),
    )
    if excluding:
        query = query.where(Tag.id != excluding)
    if await session.scalar(query):
        raise ApiError(409, "TAG_NAME_CONFLICT", "标签名称已存在")


async def require_tag(session: AsyncSession, tag_id: UUID) -> Tag:
    tag = await get_tag(session, tag_id)
    if tag is None:
        raise ApiError(404, "TAG_NOT_FOUND", "标签不存在")
    return tag


@router.get("", response_model=list[TagResponse])
async def get_tags(session: AsyncSession = Depends(get_session)):
    return (
        await session.scalars(
            select(Tag).where(Tag.user_id == DEFAULT_USER_ID).order_by(func.lower(Tag.name), Tag.id)
        )
    ).all()


@router.post("", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def create_tag(payload: TagCreate, session: AsyncSession = Depends(get_session)):
    await ensure_unique_name(session, payload.name)
    tag = Tag(
        user_id=DEFAULT_USER_ID,
        name=payload.name,
        color=payload.color.upper(),
    )
    session.add(tag)
    await session.commit()
    await session.refresh(tag)
    return tag


@router.patch("/{tag_id}", response_model=TagResponse)
async def update_tag(
    tag_id: UUID,
    payload: TagUpdate,
    session: AsyncSession = Depends(get_session),
):
    tag = await require_tag(session, tag_id)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        await ensure_unique_name(session, changes["name"], excluding=tag.id)
    if "color" in changes:
        changes["color"] = changes["color"].upper()
    for key, value in changes.items():
        setattr(tag, key, value)
    await session.commit()
    await session.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(tag_id: UUID, session: AsyncSession = Depends(get_session)):
    tag = await require_tag(session, tag_id)
    await session.delete(tag)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
