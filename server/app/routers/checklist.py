from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.errors import ApiError
from app.models import ChecklistItem
from app.repositories import get_checklist_item, next_sort_order
from app.schemas import (
    ChecklistCreate,
    ChecklistReorder,
    ChecklistResponse,
    ChecklistUpdate,
)
from app.services import require_task

router = APIRouter(prefix="/api/v1/tasks/{task_id}/items", tags=["checklist"])


async def require_item(session: AsyncSession, task_id: UUID, item_id: UUID) -> ChecklistItem:
    item = await get_checklist_item(session, task_id, item_id)
    if item is None:
        raise ApiError(404, "CHECKLIST_ITEM_NOT_FOUND", "检查项不存在")
    return item


@router.post("", response_model=ChecklistResponse, status_code=status.HTTP_201_CREATED)
async def create_item(
    task_id: UUID,
    payload: ChecklistCreate,
    session: AsyncSession = Depends(get_session),
):
    await require_task(session, task_id)
    item = ChecklistItem(
        task_id=task_id,
        title=payload.title,
        sort_order=await next_sort_order(session, ChecklistItem, ChecklistItem.task_id == task_id),
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ChecklistResponse)
async def update_item(
    task_id: UUID,
    item_id: UUID,
    payload: ChecklistUpdate,
    session: AsyncSession = Depends(get_session),
):
    item = await require_item(session, task_id, item_id)
    changes = payload.model_dump(exclude_unset=True)
    if "is_completed" in changes and changes["is_completed"] != item.is_completed:
        item.completed_at = datetime.now(UTC) if changes["is_completed"] else None
    for key, value in changes.items():
        setattr(item, key, value)
    await session.commit()
    await session.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    task_id: UUID,
    item_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    item = await require_item(session, task_id, item_id)
    await session.delete(item)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/reorder", response_model=list[ChecklistResponse])
async def reorder_items(
    task_id: UUID,
    payload: ChecklistReorder,
    session: AsyncSession = Depends(get_session),
):
    await require_task(session, task_id)
    items = list(
        (
            await session.scalars(
                select(ChecklistItem)
                .where(ChecklistItem.task_id == task_id)
                .order_by(ChecklistItem.sort_order)
            )
        ).all()
    )
    existing_ids = {item.id for item in items}
    if len(payload.item_ids) != len(set(payload.item_ids)) or set(payload.item_ids) != existing_ids:
        raise ApiError(422, "INVALID_ITEM_ORDER", "必须提交全部检查项且不能重复")
    by_id = {item.id: item for item in items}
    for index, item_id in enumerate(payload.item_ids, start=1):
        item = by_id[item_id]
        item.sort_order = index * 1024
    await session.commit()
    return (
        await session.scalars(
            select(ChecklistItem)
            .where(ChecklistItem.task_id == task_id)
            .order_by(ChecklistItem.sort_order)
        )
    ).all()
