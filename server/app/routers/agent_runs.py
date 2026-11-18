from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent_runs import (
    Caller,
    caller_from_payload,
    create_run,
    get_run,
    list_runs,
    run_to_response,
    update_run,
)
from app.auth import require_auth
from app.database import get_session
from app.errors import ApiError
from app.schemas import (
    AgentDismissEvent,
    AgentRunCreate,
    AgentRunEvent,
    AgentRunLane,
    AgentRunPage,
    AgentRunResponse,
    AgentRunWriteResponse,
)

router = APIRouter(prefix="/api/v1/agent-runs", tags=["agent-runs"])

RUNS_PATH = "/api/v1/agent-runs"

AuthPayload = Annotated[dict[str, Any], Depends(require_auth)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
IdempotencyKey = Annotated[UUID, Header(alias="Idempotency-Key")]


def _require_reporter(caller: Caller) -> None:
    if not caller.is_reporter:
        raise ApiError(403, "AGENT_OPERATION_FORBIDDEN", "此操作仅允许智能体上报 Key")


@router.post("", response_model=AgentRunWriteResponse, status_code=status.HTTP_201_CREATED)
async def create_agent_run_endpoint(
    body: AgentRunCreate,
    idempotency_key: IdempotencyKey,
    payload: AuthPayload,
    session: SessionDep,
) -> AgentRunWriteResponse:
    caller = caller_from_payload(payload)
    _require_reporter(caller)
    run_id, version = await create_run(
        session,
        caller=caller,
        request_id=idempotency_key,
        body=body,
        path=RUNS_PATH,
    )
    return AgentRunWriteResponse(run_id=run_id, version=version)


@router.get("", response_model=AgentRunPage)
async def list_agent_runs_endpoint(
    lane: AgentRunLane,
    payload: AuthPayload,
    session: SessionDep,
    source: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=30, ge=1, le=100),
) -> AgentRunPage:
    caller = caller_from_payload(payload)
    normalized_source = source.strip() if source is not None else None
    runs, next_cursor = await list_runs(
        session,
        caller=caller,
        lane=lane,
        source=normalized_source or None,
        cursor=cursor,
        limit=limit,
    )
    return AgentRunPage(
        items=[run_to_response(run) for run in runs],
        next_cursor=next_cursor,
    )


@router.get("/{run_id}", response_model=AgentRunResponse)
async def get_agent_run_endpoint(
    run_id: UUID,
    payload: AuthPayload,
    session: SessionDep,
) -> AgentRunResponse:
    caller = caller_from_payload(payload)
    run = await get_run(session, run_id=run_id, caller=caller)
    return run_to_response(run)


@router.post("/{run_id}/events", response_model=AgentRunWriteResponse)
async def append_agent_run_event_endpoint(
    run_id: UUID,
    body: AgentRunEvent,
    idempotency_key: IdempotencyKey,
    payload: AuthPayload,
    session: SessionDep,
) -> AgentRunWriteResponse:
    caller = caller_from_payload(payload)
    if isinstance(body, AgentDismissEvent):
        if not caller.is_jwt:
            raise ApiError(403, "AGENT_OPERATION_FORBIDDEN", "取消跟踪仅允许用户操作")
    else:
        _require_reporter(caller)
    _, version = await update_run(
        session,
        caller=caller,
        run_id=run_id,
        request_id=idempotency_key,
        event=body,
        path=f"{RUNS_PATH}/{run_id}/events",
    )
    return AgentRunWriteResponse(run_id=run_id, version=version)
