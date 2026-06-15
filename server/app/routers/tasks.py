from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import DEFAULT_USER_ID
from app.database import get_session
from app.errors import ApiError
from app.models import ChecklistItem, Task
from app.repositories import next_sort_order
from app.schemas import TaskCreate, TaskPage, TaskResponse, TaskSort, TaskUpdate, TaskView
from app.services import (
    delete_task,
    get_inbox,
    list_tasks,
    require_list,
    require_tags,
    require_task,
    restore_task,
    validate_task_dates,
)

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


@router.get("", response_model=TaskPage)
async def get_tasks(
    view: TaskView | None = None,
    list_id: UUID | None = None,
    status: int = Query(default=0, ge=0, le=2),
    query: str | None = None,
    sort: TaskSort = "manual",
    limit: int = Query(default=100, ge=1, le=200),
    cursor: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    if bool(view) == bool(list_id):
        raise ApiError(422, "INVALID_TASK_SCOPE", "view 和 list_id 必须且只能提供一个")
    if list_id is None and status != 0:
        raise ApiError(422, "INVALID_TASK_STATUS", "status 仅在使用 list_id 时有效")
    if list_id is not None and status not in (0, 2):
        raise ApiError(422, "INVALID_TASK_STATUS", "status 仅允许 0 或 2")
    tasks, next_cursor = await list_tasks(
        session,
        view=view,
        list_id=list_id,
        status=status,
        query_text=query,
        sort=sort,
        limit=limit,
        cursor=cursor,
    )
    return TaskPage(items=tasks, next_cursor=next_cursor)


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task_detail(task_id: UUID, session: AsyncSession = Depends(get_session)):
    return await require_task(session, task_id, include_deleted=True)


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(payload: TaskCreate, session: AsyncSession = Depends(get_session)):
    task_list = (
        await require_list(session, payload.list_id)
        if payload.list_id
        else await get_inbox(session)
    )
    validate_task_dates(payload.due_at, payload.reminder_at)
    tags = await require_tags(session, payload.tag_ids or [])
    task = Task(
        user_id=DEFAULT_USER_ID,
        list_id=task_list.id,
        title=payload.title,
        description=payload.description or "",
        due_at=payload.due_at,
        is_all_day=payload.is_all_day or False,
        reminder_at=payload.reminder_at,
        priority=payload.priority or 0,
        sort_order=(
            payload.sort_order
            if payload.sort_order is not None
            else await next_sort_order(
                session,
                Task,
                Task.user_id == DEFAULT_USER_ID,
                Task.list_id == task_list.id,
                Task.deleted_at.is_(None),
            )
        ),
        tags=tags,
    )
    for index, item in enumerate(payload.checklist_items, start=1):
        task.checklist_items.append(ChecklistItem(title=item.title, sort_order=index * 1024))
    session.add(task)
    await session.commit()
    return await require_task(session, task.id)


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: UUID,
    payload: TaskUpdate,
    session: AsyncSession = Depends(get_session),
):
    task = await require_task(session, task_id)
    changes = payload.model_dump(exclude_unset=True)
    tag_ids = changes.pop("tag_ids", None)
    if "list_id" in changes:
        await require_list(session, changes["list_id"])

    due_at = changes.get("due_at", task.due_at)
    reminder_at = changes.get("reminder_at", task.reminder_at)
    if "due_at" in changes and due_at is None and "reminder_at" not in changes:
        reminder_at = None
        changes["reminder_at"] = None
    validate_task_dates(due_at, reminder_at)

    for key, value in changes.items():
        setattr(task, key, value)
    if tag_ids is not None:
        task.tags = await require_tags(session, tag_ids)
    await session.commit()
    return await require_task(session, task.id)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_task(task_id: UUID, session: AsyncSession = Depends(get_session)):
    task = await require_task(session, task_id)
    await delete_task(session, task)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{task_id}/complete", response_model=TaskResponse)
async def complete_task(task_id: UUID, session: AsyncSession = Depends(get_session)):
    task = await require_task(session, task_id)
    if task.status != 2:
        task.status = 2
        task.completed_at = datetime.now(UTC)
        await session.commit()
    return await require_task(session, task.id)


@router.post("/{task_id}/reopen", response_model=TaskResponse)
async def reopen_task(task_id: UUID, session: AsyncSession = Depends(get_session)):
    task = await require_task(session, task_id)
    if task.status != 0:
        task.status = 0
        task.completed_at = None
        await session.commit()
    return await require_task(session, task.id)


@router.post("/{task_id}/restore", response_model=TaskResponse)
async def restore_deleted_task(task_id: UUID, session: AsyncSession = Depends(get_session)):
    task = await require_task(session, task_id, include_deleted=True)
    if task.deleted_at is None:
        return task
    return await restore_task(session, task)


@router.delete("/{task_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanently_delete_task(task_id: UUID, session: AsyncSession = Depends(get_session)):
    task = await require_task(session, task_id, include_deleted=True)
    if task.deleted_at is None:
        raise ApiError(409, "TASK_NOT_DELETED", "任务尚未进入回收站")
    await session.delete(task)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
