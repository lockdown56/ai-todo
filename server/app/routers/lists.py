from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import DEFAULT_USER_ID
from app.database import get_session
from app.models import Task, TaskList
from app.repositories import next_sort_order
from app.schemas import ListCreate, ListResponse, ListUpdate
from app.services import (
    archive_list,
    delete_list,
    require_group,
    require_list,
    restore_list,
    unarchive_list,
)

router = APIRouter(prefix="/api/v1/lists", tags=["lists"])


def serialize_list(task_list: TaskList, task_count: int = 0) -> ListResponse:
    return ListResponse.model_validate(task_list).model_copy(update={"task_count": task_count})


def _task_count_subquery():
    return (
        select(Task.list_id, func.count(Task.id).label("task_count"))
        .where(
            Task.user_id == DEFAULT_USER_ID,
            Task.deleted_at.is_(None),
            Task.status == 0,
        )
        .group_by(Task.list_id)
        .subquery()
    )


@router.get("", response_model=list[ListResponse])
async def get_lists(session: AsyncSession = Depends(get_session)):
    count_subquery = _task_count_subquery()
    rows = (
        await session.execute(
            select(TaskList, func.coalesce(count_subquery.c.task_count, 0))
            .outerjoin(count_subquery, count_subquery.c.list_id == TaskList.id)
            .where(
                TaskList.user_id == DEFAULT_USER_ID,
                TaskList.deleted_at.is_(None),
                TaskList.archived_at.is_(None),
            )
            .order_by(TaskList.sort_order, TaskList.id)
        )
    ).all()
    return [serialize_list(task_list, count) for task_list, count in rows]


@router.get("/archived", response_model=list[ListResponse])
async def get_archived_lists(session: AsyncSession = Depends(get_session)):
    count_subquery = _task_count_subquery()
    rows = (
        await session.execute(
            select(TaskList, func.coalesce(count_subquery.c.task_count, 0))
            .outerjoin(count_subquery, count_subquery.c.list_id == TaskList.id)
            .where(
                TaskList.user_id == DEFAULT_USER_ID,
                TaskList.deleted_at.is_(None),
                TaskList.archived_at.is_not(None),
            )
            .order_by(TaskList.archived_at.desc())
        )
    ).all()
    return [serialize_list(task_list, count) for task_list, count in rows]


@router.get("/trash", response_model=list[ListResponse])
async def get_trash_lists(session: AsyncSession = Depends(get_session)):
    task_lists = (
        await session.scalars(
            select(TaskList)
            .where(
                TaskList.user_id == DEFAULT_USER_ID,
                TaskList.deleted_at.is_not(None),
            )
            .order_by(TaskList.deleted_at.desc())
        )
    ).all()
    return [serialize_list(item) for item in task_lists]


@router.post("", response_model=ListResponse, status_code=status.HTTP_201_CREATED)
async def create_list(payload: ListCreate, session: AsyncSession = Depends(get_session)):
    if payload.group_id is not None:
        await require_group(session, payload.group_id)
    task_list = TaskList(
        user_id=DEFAULT_USER_ID,
        name=payload.name,
        color=payload.color.upper(),
        group_id=payload.group_id,
        sort_order=await next_sort_order(
            session,
            TaskList,
            TaskList.user_id == DEFAULT_USER_ID,
            TaskList.deleted_at.is_(None),
        ),
    )
    session.add(task_list)
    await session.commit()
    await session.refresh(task_list)
    return serialize_list(task_list)


@router.patch("/{list_id}", response_model=ListResponse)
async def update_list(
    list_id: UUID,
    payload: ListUpdate,
    session: AsyncSession = Depends(get_session),
):
    task_list = await require_list(session, list_id)
    changes = payload.model_dump(exclude_unset=True)
    if "color" in changes:
        changes["color"] = changes["color"].upper()
    if changes.get("group_id") is not None:
        await require_group(session, changes["group_id"])
    for key, value in changes.items():
        setattr(task_list, key, value)
    await session.commit()
    await session.refresh(task_list)
    return serialize_list(task_list)


@router.post("/{list_id}/archive", response_model=ListResponse)
async def archive_task_list(list_id: UUID, session: AsyncSession = Depends(get_session)):
    task_list = await require_list(session, list_id)
    return serialize_list(await archive_list(session, task_list))


@router.post("/{list_id}/unarchive", response_model=ListResponse)
async def unarchive_task_list(list_id: UUID, session: AsyncSession = Depends(get_session)):
    task_list = await require_list(session, list_id)
    return serialize_list(await unarchive_list(session, task_list))


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_list(list_id: UUID, session: AsyncSession = Depends(get_session)):
    task_list = await require_list(session, list_id)
    await delete_list(session, task_list)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{list_id}/restore", response_model=ListResponse)
async def restore_deleted_list(list_id: UUID, session: AsyncSession = Depends(get_session)):
    task_list = await require_list(session, list_id, include_deleted=True)
    if task_list.deleted_at is None:
        return serialize_list(task_list)
    return serialize_list(await restore_list(session, task_list))


@router.delete("/{list_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanently_delete_list(list_id: UUID, session: AsyncSession = Depends(get_session)):
    task_list = await require_list(session, list_id, include_deleted=True)
    if task_list.system_type == "inbox":
        from app.errors import ApiError

        raise ApiError(409, "SYSTEM_LIST_PROTECTED", "系统收集箱不可永久删除")
    if task_list.deleted_at is None:
        from app.errors import ApiError

        raise ApiError(409, "LIST_NOT_DELETED", "清单尚未进入回收站")
    await session.execute(delete(Task).where(Task.list_id == task_list.id))
    await session.delete(task_list)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
