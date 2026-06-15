from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import DEFAULT_USER_ID
from app.database import get_session
from app.models import ListGroup
from app.repositories import next_sort_order
from app.schemas import ListGroupCreate, ListGroupResponse, ListGroupUpdate
from app.services import delete_group, require_group

router = APIRouter(prefix="/api/v1/list-groups", tags=["list-groups"])


@router.get("", response_model=list[ListGroupResponse])
async def get_groups(session: AsyncSession = Depends(get_session)):
    return (
        await session.scalars(
            select(ListGroup)
            .where(ListGroup.user_id == DEFAULT_USER_ID)
            .order_by(ListGroup.sort_order, ListGroup.id)
        )
    ).all()


@router.post("", response_model=ListGroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(payload: ListGroupCreate, session: AsyncSession = Depends(get_session)):
    group = ListGroup(
        user_id=DEFAULT_USER_ID,
        name=payload.name,
        sort_order=await next_sort_order(
            session,
            ListGroup,
            ListGroup.user_id == DEFAULT_USER_ID,
        ),
    )
    session.add(group)
    await session.commit()
    await session.refresh(group)
    return group


@router.patch("/{group_id}", response_model=ListGroupResponse)
async def update_group(
    group_id: UUID,
    payload: ListGroupUpdate,
    session: AsyncSession = Depends(get_session),
):
    group = await require_group(session, group_id)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(group, key, value)
    await session.commit()
    await session.refresh(group)
    return group


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_group(group_id: UUID, session: AsyncSession = Depends(get_session)):
    group = await require_group(session, group_id)
    await delete_group(session, group)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
