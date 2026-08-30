from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import DEFAULT_USER_ID
from app.database import get_session
from app.errors import ApiError
from app.models import SmartList, SmartListSource, Task, TaskList
from app.repositories import get_smart_list, next_sort_order
from app.schemas import SmartListCreate, SmartListResponse, SmartListUpdate
from app.services import apply_smart_list_filters, require_tags

router = APIRouter(prefix="/api/v1/smart-lists", tags=["smart-lists"])


async def require_smart_list(session: AsyncSession, smart_list_id: UUID) -> SmartList:
    smart_list = await get_smart_list(session, smart_list_id)
    if smart_list is None:
        raise ApiError(404, "SMART_LIST_NOT_FOUND", "智能清单不存在")
    return smart_list


async def validate_sources(session: AsyncSession, source_ids: list[UUID]) -> list[UUID]:
    unique_ids = list(dict.fromkeys(source_ids))
    found = set(
        await session.scalars(
            select(TaskList.id).where(
                TaskList.user_id == DEFAULT_USER_ID,
                TaskList.id.in_(unique_ids),
                TaskList.deleted_at.is_(None),
            )
        )
    )
    if len(found) != len(unique_ids):
        raise ApiError(422, "LIST_NOT_FOUND", "一个或多个来源清单不存在")
    return unique_ids


async def validate_filters(session: AsyncSession, filters: dict) -> None:
    await require_tags(session, [UUID(value) for value in filters.get("tag_ids", [])])


def serialize(smart_list: SmartList, task_count: int = 0) -> SmartListResponse:
    return SmartListResponse(
        id=smart_list.id,
        name=smart_list.name,
        color=smart_list.color,
        sort_order=smart_list.sort_order,
        source_list_ids=[source.list_id for source in smart_list.sources],
        filters=smart_list.filters,
        task_count=task_count,
        created_at=smart_list.created_at,
        updated_at=smart_list.updated_at,
    )


@router.get("", response_model=list[SmartListResponse])
async def get_smart_lists(session: AsyncSession = Depends(get_session)):
    smart_lists = list(
        await session.scalars(
            select(SmartList)
            .where(SmartList.user_id == DEFAULT_USER_ID)
            .order_by(SmartList.sort_order, SmartList.id)
        )
    )
    result = []
    for smart_list in smart_lists:
        count = await session.scalar(
            apply_smart_list_filters(
                select(func.count(Task.id)).where(Task.user_id == DEFAULT_USER_ID), smart_list
            )
        )
        result.append(serialize(smart_list, int(count or 0)))
    return result


@router.get("/{smart_list_id}", response_model=SmartListResponse)
async def get_smart_list_detail(smart_list_id: UUID, session: AsyncSession = Depends(get_session)):
    return serialize(await require_smart_list(session, smart_list_id))


@router.post("", response_model=SmartListResponse, status_code=status.HTTP_201_CREATED)
async def create_smart_list(payload: SmartListCreate, session: AsyncSession = Depends(get_session)):
    source_ids = await validate_sources(session, payload.source_list_ids)
    filters = payload.filters.model_dump(mode="json")
    await validate_filters(session, filters)
    smart_list = SmartList(
        user_id=DEFAULT_USER_ID,
        name=payload.name,
        color=payload.color.upper(),
        sort_order=await next_sort_order(session, SmartList, SmartList.user_id == DEFAULT_USER_ID),
        filters=filters,
        sources=[SmartListSource(list_id=list_id) for list_id in source_ids],
    )
    session.add(smart_list)
    await session.commit()
    return serialize(await require_smart_list(session, smart_list.id))


@router.patch("/{smart_list_id}", response_model=SmartListResponse)
async def update_smart_list(
    smart_list_id: UUID,
    payload: SmartListUpdate,
    session: AsyncSession = Depends(get_session),
):
    smart_list = await require_smart_list(session, smart_list_id)
    changes = payload.model_dump(exclude_unset=True)
    source_ids = changes.pop("source_list_ids", None)
    filters = changes.pop("filters", None)
    if source_ids is not None:
        source_ids = await validate_sources(session, source_ids)
        smart_list.sources = [SmartListSource(list_id=list_id) for list_id in source_ids]
    if filters is not None:
        normalized = payload.filters.model_dump(mode="json")
        await validate_filters(session, normalized)
        smart_list.filters = normalized
    if "color" in changes:
        changes["color"] = changes["color"].upper()
    for key, value in changes.items():
        setattr(smart_list, key, value)
    await session.commit()
    return serialize(await require_smart_list(session, smart_list.id))


@router.delete("/{smart_list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_smart_list(smart_list_id: UUID, session: AsyncSession = Depends(get_session)):
    smart_list = await require_smart_list(session, smart_list_id)
    await session.delete(smart_list)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
