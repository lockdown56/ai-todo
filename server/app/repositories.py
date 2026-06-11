from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.constants import DEFAULT_USER_ID
from app.models import ChecklistItem, Tag, Task, TaskList


def task_with_details() -> Select[tuple[Task]]:
    return select(Task).options(
        selectinload(Task.tags),
        selectinload(Task.checklist_items),
    )


async def get_list(
    session: AsyncSession, list_id: UUID, *, include_deleted: bool = False
) -> TaskList | None:
    query = select(TaskList).where(
        TaskList.id == list_id,
        TaskList.user_id == DEFAULT_USER_ID,
    )
    if not include_deleted:
        query = query.where(TaskList.deleted_at.is_(None))
    return await session.scalar(query)


async def get_task(
    session: AsyncSession, task_id: UUID, *, include_deleted: bool = False
) -> Task | None:
    query = task_with_details().where(
        Task.id == task_id,
        Task.user_id == DEFAULT_USER_ID,
    )
    if not include_deleted:
        query = query.where(Task.deleted_at.is_(None))
    return await session.scalar(query)


async def get_checklist_item(
    session: AsyncSession, task_id: UUID, item_id: UUID
) -> ChecklistItem | None:
    return await session.scalar(
        select(ChecklistItem)
        .join(Task)
        .where(
            ChecklistItem.id == item_id,
            ChecklistItem.task_id == task_id,
            Task.user_id == DEFAULT_USER_ID,
            Task.deleted_at.is_(None),
        )
    )


async def get_tag(session: AsyncSession, tag_id: UUID) -> Tag | None:
    return await session.scalar(select(Tag).where(Tag.id == tag_id, Tag.user_id == DEFAULT_USER_ID))


async def next_sort_order(
    session: AsyncSession,
    model: type[TaskList] | type[Task] | type[ChecklistItem],
    *conditions: object,
) -> int:
    current = await session.scalar(select(func.max(model.sort_order)).where(*conditions))
    return int(current or 0) + 1024
