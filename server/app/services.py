import base64
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.constants import (
    DEFAULT_INBOX_NAME,
    DEFAULT_USER_EMAIL,
    DEFAULT_USER_ID,
    DEFAULT_USER_NAME,
    SORT_GAP,
)
from app.errors import ApiError
from app.models import ListGroup, Tag, Task, TaskList, User
from app.repositories import get_group, get_list, get_task, task_with_details
from app.schemas import TaskSort, TaskView


async def initialize_data(session: AsyncSession) -> None:
    user = await session.get(User, DEFAULT_USER_ID)
    if user is None:
        session.add(
            User(
                id=DEFAULT_USER_ID,
                email=DEFAULT_USER_EMAIL,
                display_name=DEFAULT_USER_NAME,
            )
        )
        await session.flush()

    inbox = await session.scalar(
        select(TaskList).where(
            TaskList.user_id == DEFAULT_USER_ID,
            TaskList.system_type == "inbox",
            TaskList.deleted_at.is_(None),
        )
    )
    if inbox is None:
        session.add(
            TaskList(
                user_id=DEFAULT_USER_ID,
                name=DEFAULT_INBOX_NAME,
                color="#6C5CE7",
                system_type="inbox",
                sort_order=SORT_GAP,
            )
        )
    await session.commit()


async def get_inbox(session: AsyncSession) -> TaskList:
    inbox = await session.scalar(
        select(TaskList).where(
            TaskList.user_id == DEFAULT_USER_ID,
            TaskList.system_type == "inbox",
            TaskList.deleted_at.is_(None),
        )
    )
    if inbox is None:
        raise ApiError(409, "INBOX_NOT_INITIALIZED", "系统收集箱尚未初始化")
    return inbox


async def require_list(
    session: AsyncSession, list_id: UUID, *, include_deleted: bool = False
) -> TaskList:
    task_list = await get_list(session, list_id, include_deleted=include_deleted)
    if task_list is None:
        raise ApiError(404, "LIST_NOT_FOUND", "清单不存在")
    return task_list


async def require_task(
    session: AsyncSession, task_id: UUID, *, include_deleted: bool = False
) -> Task:
    task = await get_task(session, task_id, include_deleted=include_deleted)
    if task is None:
        raise ApiError(404, "TASK_NOT_FOUND", "任务不存在")
    return task


async def require_group(session: AsyncSession, group_id: UUID) -> ListGroup:
    group = await get_group(session, group_id)
    if group is None:
        raise ApiError(404, "GROUP_NOT_FOUND", "分组不存在")
    return group


async def require_tags(session: AsyncSession, tag_ids: list[UUID]) -> list[Tag]:
    unique_ids = list(dict.fromkeys(tag_ids))
    if not unique_ids:
        return []
    tags = list(
        (
            await session.scalars(
                select(Tag).where(Tag.user_id == DEFAULT_USER_ID, Tag.id.in_(unique_ids))
            )
        ).all()
    )
    if len(tags) != len(unique_ids):
        raise ApiError(422, "TAG_NOT_FOUND", "一个或多个标签不存在")
    by_id = {tag.id: tag for tag in tags}
    return [by_id[tag_id] for tag_id in unique_ids]


def validate_task_dates(due_at: datetime | None, reminder_at: datetime | None) -> None:
    if reminder_at and due_at is None:
        raise ApiError(422, "DUE_DATE_REQUIRED", "设置提醒时间前必须先设置截止时间")
    if reminder_at and due_at and reminder_at > due_at:
        raise ApiError(422, "INVALID_REMINDER", "提醒时间不得晚于截止时间")


async def delete_list(session: AsyncSession, task_list: TaskList) -> None:
    if task_list.system_type == "inbox":
        raise ApiError(409, "SYSTEM_LIST_PROTECTED", "系统收集箱不可删除")
    now = datetime.now(UTC)
    batch_id = uuid4()
    task_list.deleted_at = now
    task_list.deletion_batch_id = batch_id
    await session.execute(
        update(Task)
        .where(Task.list_id == task_list.id, Task.deleted_at.is_(None))
        .values(deleted_at=now, deletion_batch_id=batch_id, updated_at=now)
    )
    await session.commit()


async def restore_list(session: AsyncSession, task_list: TaskList) -> TaskList:
    batch_id = task_list.deletion_batch_id
    task_list.deleted_at = None
    task_list.deletion_batch_id = None
    if batch_id:
        await session.execute(
            update(Task)
            .where(Task.list_id == task_list.id, Task.deletion_batch_id == batch_id)
            .values(deleted_at=None, deletion_batch_id=None, updated_at=datetime.now(UTC))
        )
    await session.commit()
    await session.refresh(task_list)
    return task_list


async def archive_list(session: AsyncSession, task_list: TaskList) -> TaskList:
    if task_list.system_type == "inbox":
        raise ApiError(409, "SYSTEM_LIST_PROTECTED", "系统收集箱不可归档")
    if task_list.archived_at is None:
        task_list.archived_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(task_list)
    return task_list


async def unarchive_list(session: AsyncSession, task_list: TaskList) -> TaskList:
    if task_list.archived_at is not None:
        task_list.archived_at = None
        await session.commit()
        await session.refresh(task_list)
    return task_list


async def delete_group(session: AsyncSession, group: ListGroup) -> None:
    await session.execute(
        update(TaskList)
        .where(TaskList.group_id == group.id)
        .values(group_id=None, updated_at=datetime.now(UTC))
    )
    await session.delete(group)
    await session.commit()


async def delete_task(session: AsyncSession, task: Task) -> None:
    now = datetime.now(UTC)
    task.deleted_at = now
    task.deletion_batch_id = uuid4()
    await session.commit()


async def restore_task(session: AsyncSession, task: Task) -> Task:
    parent = await get_list(session, task.list_id)
    if parent is None:
        raise ApiError(409, "LIST_DELETED", "所属清单已删除，请先恢复清单")
    task.deleted_at = None
    task.deletion_batch_id = None
    await session.commit()
    return await require_task(session, task.id)


def encode_cursor(value: object, task_id: UUID) -> str:
    if isinstance(value, datetime):
        value = value.isoformat()
    raw = json.dumps({"value": value, "id": str(task_id)}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[object, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded).decode())
        return data["value"], UUID(data["id"])
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        raise ApiError(422, "INVALID_CURSOR", "分页游标无效") from exc


def task_sorting(query, sort: TaskSort, cursor: str | None):
    if sort == "manual":
        query = query.order_by(Task.sort_order.asc(), Task.id.asc())
        field, descending = Task.sort_order, False
    elif sort == "created_asc":
        query = query.order_by(Task.created_at.asc(), Task.id.asc())
        field, descending = Task.created_at, False
    elif sort == "created_desc":
        query = query.order_by(Task.created_at.desc(), Task.id.desc())
        field, descending = Task.created_at, True
    elif sort == "priority_desc":
        query = query.order_by(Task.priority.desc(), Task.id.asc())
        field, descending = Task.priority, True
    else:
        query = query.order_by(Task.due_at.asc().nulls_last(), Task.id.asc())
        field, descending = Task.due_at, False

    if not cursor:
        return query

    value, task_id = decode_cursor(cursor)
    if field is Task.created_at and isinstance(value, str):
        value = datetime.fromisoformat(value)

    if sort == "due_asc":
        if value is None:
            return query.where(Task.due_at.is_(None), Task.id > task_id)
        parsed = datetime.fromisoformat(str(value))
        return query.where(
            or_(
                Task.due_at > parsed,
                Task.due_at.is_(None),
                and_(Task.due_at == parsed, Task.id > task_id),
            )
        )
    if sort == "priority_desc":
        return query.where(or_(field < value, and_(field == value, Task.id > task_id)))
    if descending:
        return query.where(or_(field < value, and_(field == value, Task.id < task_id)))
    return query.where(or_(field > value, and_(field == value, Task.id > task_id)))


def cursor_value(task: Task, sort: TaskSort) -> object:
    return {
        "manual": task.sort_order,
        "created_asc": task.created_at,
        "created_desc": task.created_at,
        "due_asc": task.due_at,
        "priority_desc": task.priority,
    }[sort]


async def list_tasks(
    session: AsyncSession,
    *,
    view: TaskView | None,
    list_id: UUID | None,
    status: int = 0,
    query_text: str | None,
    sort: TaskSort,
    limit: int,
    cursor: str | None,
) -> tuple[list[Task], str | None]:
    query = task_with_details().where(Task.user_id == DEFAULT_USER_ID)

    archived_list_ids = select(TaskList.id).where(
        TaskList.user_id == DEFAULT_USER_ID,
        TaskList.archived_at.is_not(None),
    )

    if list_id:
        await require_list(session, list_id)
        query = query.where(
            Task.list_id == list_id,
            Task.deleted_at.is_(None),
            Task.status == status,
        )
    elif view == "trash":
        query = query.where(Task.deleted_at.is_not(None))
    elif view == "completed":
        query = query.where(
            Task.deleted_at.is_(None),
            Task.status == 2,
            Task.list_id.not_in(archived_list_ids),
        )
    else:
        query = query.where(
            Task.deleted_at.is_(None),
            Task.status == 0,
            Task.list_id.not_in(archived_list_ids),
        )
        if view == "inbox":
            inbox = await get_inbox(session)
            query = query.where(Task.list_id == inbox.id)
        elif view == "today":
            timezone = ZoneInfo(get_settings().app_timezone)
            local_now = datetime.now(timezone)
            start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=1)
            query = query.where(Task.due_at >= start, Task.due_at < end)

    if query_text and (cleaned := query_text.strip()):
        pattern = f"%{cleaned}%"
        query = query.where(or_(Task.title.ilike(pattern), Task.description.ilike(pattern)))

    query = task_sorting(query, sort, cursor).limit(limit + 1)
    tasks = list((await session.scalars(query)).unique().all())
    has_more = len(tasks) > limit
    tasks = tasks[:limit]
    next_cursor = (
        encode_cursor(cursor_value(tasks[-1], sort), tasks[-1].id) if has_more and tasks else None
    )
    return tasks, next_cursor
