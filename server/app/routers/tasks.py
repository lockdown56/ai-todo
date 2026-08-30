from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.constants import DEFAULT_USER_ID
from app.database import get_session
from app.errors import ApiError
from app.models import ChecklistItem, Tag, Task, TaskList, TaskOccurrence
from app.repositories import next_sort_order
from app.schemas import TaskCreate, TaskPage, TaskResponse, TaskSort, TaskUpdate, TaskView
from app.services import (
    delete_task,
    get_inbox,
    list_tasks,
    recurrence_occurs_on,
    require_list,
    require_smart_list,
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
    smart_list_id: UUID | None = None,
    status: int = Query(default=0, ge=0, le=2),
    query: str | None = None,
    sort: TaskSort = "manual",
    limit: int = Query(default=100, ge=1, le=200),
    cursor: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    if sum(value is not None for value in (view, list_id, smart_list_id)) != 1:
        raise ApiError(
            422,
            "INVALID_TASK_SCOPE",
            "view、list_id 和 smart_list_id 必须且只能提供一个",
        )
    if list_id is None and smart_list_id is None and status != 0:
        raise ApiError(422, "INVALID_TASK_STATUS", "status 仅在使用 list_id 时有效")
    if list_id is not None and status not in (0, 2):
        raise ApiError(422, "INVALID_TASK_STATUS", "status 仅允许 0 或 2")
    tasks, next_cursor = await list_tasks(
        session,
        view=view,
        list_id=list_id,
        smart_list_id=smart_list_id,
        status=status,
        query_text=query,
        sort=sort,
        limit=limit,
        cursor=cursor,
    )
    items = [TaskResponse.model_validate(task) for task in tasks]
    smart_list = await require_smart_list(session, smart_list_id) if smart_list_id else None
    include_smart_completed = bool(
        smart_list and "completed" in smart_list.filters.get("statuses", [])
    )
    if view == "completed" or (list_id is not None and status == 2) or include_smart_completed:
        occurrence_query = (
            select(TaskOccurrence)
            .join(Task)
            .options(
                selectinload(TaskOccurrence.task).selectinload(Task.tags),
                selectinload(TaskOccurrence.task).selectinload(Task.checklist_items),
            )
            .where(Task.user_id == DEFAULT_USER_ID)
            .order_by(TaskOccurrence.completed_at.desc())
            .limit(limit)
        )
        if list_id is not None:
            occurrence_query = occurrence_query.where(Task.list_id == list_id)
        elif smart_list is not None:
            source_ids = [source.list_id for source in smart_list.sources]
            occurrence_query = occurrence_query.join(TaskList, TaskList.id == Task.list_id).where(
                Task.list_id.in_(source_ids),
                TaskList.archived_at.is_(None),
                TaskList.deleted_at.is_(None),
            )
            priorities = smart_list.filters.get("priorities", [])
            if priorities:
                occurrence_query = occurrence_query.where(Task.priority.in_(priorities))
            tag_ids = smart_list.filters.get("tag_ids", [])
            if tag_ids:
                occurrence_query = occurrence_query.where(
                    Task.tags.any(Tag.id.in_([UUID(value) for value in tag_ids]))
                )
            date_filter = smart_list.filters.get("date")
            if date_filter:
                timezone = ZoneInfo(get_settings().app_timezone)
                today = datetime.now(timezone).date()
                mode = date_filter["mode"]
                if mode == "none":
                    occurrence_query = occurrence_query.where(False)
                elif mode == "overdue":
                    occurrence_query = occurrence_query.where(
                        TaskOccurrence.occurrence_date < today
                    )
                else:
                    if mode == "today":
                        start_date = end_date = today
                    elif mode == "tomorrow":
                        start_date = end_date = today + timedelta(days=1)
                    elif mode == "this_week":
                        start_date = today - timedelta(days=today.weekday())
                        end_date = start_date + timedelta(days=6)
                    elif mode == "next_7_days":
                        start_date, end_date = today, today + timedelta(days=6)
                    else:
                        start_date = date.fromisoformat(date_filter["start"])
                        end_date = date.fromisoformat(date_filter["end"])
                    occurrence_query = occurrence_query.where(
                        TaskOccurrence.occurrence_date >= start_date,
                        TaskOccurrence.occurrence_date <= end_date,
                    )
        occurrences = list(await session.scalars(occurrence_query))
        for occurrence in occurrences:
            response = TaskResponse.model_validate(occurrence.task).model_copy(
                update={
                    "id": occurrence.id,
                    "status": 2,
                    "completed_at": occurrence.completed_at,
                    "source_task_id": occurrence.task_id,
                    "occurrence_date": occurrence.occurrence_date,
                    "is_recurring_occurrence": True,
                    "title": occurrence.snapshot.get("title", occurrence.task.title),
                    "description": occurrence.snapshot.get(
                        "description", occurrence.task.description
                    ),
                    "priority": occurrence.snapshot.get("priority", occurrence.task.priority),
                }
            )
            items.append(response)
        items.sort(key=lambda item: item.completed_at or item.created_at, reverse=True)
        items = items[:limit]
    return TaskPage(items=items, next_cursor=next_cursor)


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task_detail(task_id: UUID, session: AsyncSession = Depends(get_session)):
    occurrence = await session.scalar(
        select(TaskOccurrence)
        .options(
            selectinload(TaskOccurrence.task).selectinload(Task.tags),
            selectinload(TaskOccurrence.task).selectinload(Task.checklist_items),
        )
        .where(TaskOccurrence.id == task_id)
    )
    if occurrence is not None:
        return TaskResponse.model_validate(occurrence.task).model_copy(
            update={
                "id": occurrence.id,
                "status": 2,
                "completed_at": occurrence.completed_at,
                "source_task_id": occurrence.task_id,
                "occurrence_date": occurrence.occurrence_date,
                "is_recurring_occurrence": True,
                "title": occurrence.snapshot.get("title", occurrence.task.title),
                "description": occurrence.snapshot.get("description", occurrence.task.description),
                "priority": occurrence.snapshot.get("priority", occurrence.task.priority),
            }
        )
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
        recurrence_type=payload.recurrence_type,
        recurrence_start_date=payload.recurrence_start_date,
        recurrence_end_date=payload.recurrence_end_date,
        recurrence_weekday=payload.recurrence_weekday,
        recurrence_monthday=payload.recurrence_monthday,
        reminder_offset_minutes=payload.reminder_offset_minutes,
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
    if task.recurrence_type:
        timezone = ZoneInfo(get_settings().app_timezone)
        today = datetime.now(timezone).date()
        if not recurrence_occurs_on(task, today):
            raise ApiError(409, "RECURRENCE_NOT_DUE", "循环任务今天无需执行")
        existing = await session.scalar(
            select(TaskOccurrence).where(
                TaskOccurrence.task_id == task.id, TaskOccurrence.occurrence_date == today
            )
        )
        if existing is None:
            snapshot = {
                "title": task.title,
                "description": task.description,
                "priority": task.priority,
                "checklist_items": [
                    {"title": item.title, "is_completed": item.is_completed}
                    for item in task.checklist_items
                ],
                "tags": [{"name": tag.name, "color": tag.color} for tag in task.tags],
            }
            session.add(
                TaskOccurrence(
                    task_id=task.id,
                    occurrence_date=today,
                    completed_at=datetime.now(UTC),
                    snapshot=snapshot,
                )
            )
            await session.commit()
        return await require_task(session, task.id)
    if task.status != 2:
        task.status = 2
        task.completed_at = datetime.now(UTC)
        await session.commit()
    return await require_task(session, task.id)


@router.post("/{task_id}/reopen", response_model=TaskResponse)
async def reopen_task(task_id: UUID, session: AsyncSession = Depends(get_session)):
    occurrence = await session.get(TaskOccurrence, task_id)
    if occurrence is not None:
        source_id = occurrence.task_id
        await session.delete(occurrence)
        await session.commit()
        return await require_task(session, source_id)
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
