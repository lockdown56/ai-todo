"""智能体看板运行服务：创建、状态迁移、幂等回执、游标与查询。"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import AgentRun, AgentWriteReceipt, Task
from app.schemas import (
    AgentFinishEvent,
    AgentProgressEvent,
    AgentResumeEvent,
    AgentRunCreate,
    AgentRunEvent,
    AgentRunLane,
    AgentRunResponse,
    AgentWaitEvent,
)

LANE_STATUSES: dict[AgentRunLane, tuple[str, ...]] = {
    "attention": ("waiting_user",),
    "active": ("running",),
    "history": ("succeeded", "failed", "cancelled", "dismissed"),
}
TERMINAL_STATUSES = frozenset(LANE_STATUSES["history"])


@dataclass(frozen=True)
class Caller:
    """已鉴权的调用者身份，用于回执 actor 与数据可见性过滤。"""

    user_id: UUID
    credential_type: str
    api_key_id: UUID | None = None
    api_key_name: str | None = None
    scope: str | None = None

    @property
    def is_jwt(self) -> bool:
        return self.credential_type == "jwt"

    @property
    def is_reporter(self) -> bool:
        return self.credential_type == "api_key" and self.scope == "agent_reporter"

    @property
    def actor(self) -> str:
        if self.credential_type == "api_key":
            return f"key:{self.api_key_id}"
        return f"jwt:{self.user_id}"


def caller_from_payload(payload: dict[str, Any]) -> Caller:
    api_key_id = payload.get("api_key_id")
    api_key_name = payload.get("api_key_name")
    scope = payload.get("scope")
    return Caller(
        user_id=UUID(str(payload["sub"])),
        credential_type=str(payload["credential_type"]),
        api_key_id=UUID(str(api_key_id)) if api_key_id is not None else None,
        api_key_name=api_key_name if isinstance(api_key_name, str) else None,
        scope=scope if isinstance(scope, str) else None,
    )


def request_hash(method: str, path: str, body: BaseModel) -> str:
    canonical = json.dumps(
        body.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256((method + path + canonical).encode()).hexdigest()


def encode_cursor(lane: str, source: str | None, value: datetime, run_id: UUID) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    else:
        value = value.astimezone(UTC)
    raw = json.dumps(
        {"lane": lane, "source": source, "t": value.isoformat(), "id": str(run_id)},
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str, *, lane: str, source: str | None) -> tuple[datetime, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded).decode())
        if data["lane"] != lane or data["source"] != source:
            raise ValueError
        value = datetime.fromisoformat(data["t"])
        run_id = UUID(data["id"])
    except (
        ValueError,
        KeyError,
        TypeError,
        UnicodeDecodeError,
        binascii.Error,
        json.JSONDecodeError,
    ) as exc:
        raise ApiError(422, "INVALID_CURSOR", "分页游标无效") from exc
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    else:
        value = value.astimezone(UTC)
    return value, run_id


def run_to_response(run: AgentRun) -> AgentRunResponse:
    return AgentRunResponse(
        id=run.id,
        source=run.source,
        title=run.title,
        summary=run.summary,
        status=run.status,
        version=run.version,
        session_ref=run.session_ref,
        session_url=run.session_url,
        workspace_label=run.workspace_label,
        task_id=run.task_id,
        created_at=run.created_at,
        updated_at=run.updated_at,
        status_changed_at=run.status_changed_at,
    )


async def _find_receipt(
    session: AsyncSession, actor: str, request_id: UUID
) -> AgentWriteReceipt | None:
    return await session.scalar(
        select(AgentWriteReceipt).where(
            AgentWriteReceipt.actor == actor,
            AgentWriteReceipt.request_id == request_id,
        )
    )


def _replay_or_conflict(receipt: AgentWriteReceipt, request_hash_value: str) -> tuple[UUID, int]:
    if receipt.request_hash != request_hash_value:
        raise ApiError(409, "IDEMPOTENCY_CONFLICT", "同一幂等键的请求内容不一致")
    return receipt.run_id, receipt.version


async def _require_task(session: AsyncSession, user_id: UUID, task_id: UUID | None) -> None:
    if task_id is None:
        return
    found = await session.scalar(
        select(Task.id).where(
            Task.id == task_id,
            Task.user_id == user_id,
            Task.deleted_at.is_(None),
        )
    )
    if found is None:
        raise ApiError(404, "TASK_NOT_FOUND", "关联的待办不存在或已删除")


def _visible_runs(caller: Caller):
    query = select(AgentRun).where(AgentRun.user_id == caller.user_id)
    if caller.is_reporter:
        query = query.where(AgentRun.reporter_key_id == caller.api_key_id)
    return query


async def get_run(session: AsyncSession, *, run_id: UUID, caller: Caller) -> AgentRun:
    run = await session.scalar(_visible_runs(caller).where(AgentRun.id == run_id))
    if run is None:
        raise ApiError(404, "AGENT_RUN_NOT_FOUND", "运行不存在")
    return run


async def list_runs(
    session: AsyncSession,
    *,
    caller: Caller,
    lane: AgentRunLane,
    source: str | None,
    cursor: str | None,
    limit: int,
) -> tuple[list[AgentRun], str | None]:
    query = _visible_runs(caller).where(AgentRun.status.in_(LANE_STATUSES[lane]))
    if source:
        query = query.where(AgentRun.source == source)

    if lane == "attention":
        time_field = AgentRun.status_changed_at
    elif lane == "active":
        time_field = AgentRun.updated_at
    else:
        time_field = AgentRun.status_changed_at
    ascending = lane == "attention"

    if cursor:
        value, run_id = decode_cursor(cursor, lane=lane, source=source)
        if ascending:
            keyset = or_(
                time_field > value,
                and_(time_field == value, AgentRun.id > run_id),
            )
        else:
            keyset = or_(
                time_field < value,
                and_(time_field == value, AgentRun.id < run_id),
            )
        query = query.where(keyset)

    if ascending:
        query = query.order_by(time_field.asc(), AgentRun.id.asc())
    else:
        query = query.order_by(time_field.desc(), AgentRun.id.desc())

    runs = list(await session.scalars(query.limit(limit + 1)))
    has_more = len(runs) > limit
    runs = runs[:limit]
    next_cursor = None
    if has_more and runs:
        last = runs[-1]
        next_cursor = encode_cursor(
            lane,
            source,
            last.status_changed_at if lane != "active" else last.updated_at,
            last.id,
        )
    return runs, next_cursor


async def create_run(
    session: AsyncSession,
    *,
    caller: Caller,
    request_id: UUID,
    body: AgentRunCreate,
    path: str,
) -> tuple[UUID, int]:
    digest = request_hash("POST", path, body)
    receipt = await _find_receipt(session, caller.actor, request_id)
    if receipt is not None:
        return _replay_or_conflict(receipt, digest)

    await _require_task(session, caller.user_id, body.task_id)

    now = datetime.now(UTC)
    run = AgentRun(
        id=body.id,
        user_id=caller.user_id,
        reporter_key_id=caller.api_key_id,
        source=caller.api_key_name or "",
        session_ref=body.session_ref,
        session_url=body.session_url,
        workspace_label=body.workspace_label,
        task_id=body.task_id,
        title=body.title,
        summary=body.summary or "",
        status="running",
        version=1,
        created_at=now,
        updated_at=now,
        status_changed_at=now,
    )
    session.add(run)
    try:
        await session.flush()
        session.add(
            AgentWriteReceipt(
                actor=caller.actor,
                request_id=request_id,
                request_hash=digest,
                run_id=run.id,
                version=1,
            )
        )
        await session.commit()
    except IntegrityError:
        await session.rollback()
        receipt = await _find_receipt(session, caller.actor, request_id)
        if receipt is not None:
            return _replay_or_conflict(receipt, digest)
        if await session.get(AgentRun, body.id) is not None:
            raise ApiError(409, "AGENT_RUN_ID_CONFLICT", "运行 ID 已被占用") from None
        raise
    return run.id, 1


def _apply_event(run: AgentRun, event: AgentRunEvent) -> tuple[str, str, bool]:
    """返回迁移后的 (状态, 摘要, 是否刷新最后上报时间)。"""
    current = run.status
    if current in TERMINAL_STATUSES:
        raise ApiError(409, "AGENT_INVALID_TRANSITION", "运行已结束，不能再更新")

    if isinstance(event, AgentProgressEvent):
        if current != "running":
            raise ApiError(409, "AGENT_INVALID_TRANSITION", "仅进行中的运行可以上报进展")
        return "running", event.summary, True
    if isinstance(event, AgentWaitEvent):
        return "waiting_user", event.reason, True
    if isinstance(event, AgentResumeEvent):
        if current != "waiting_user":
            raise ApiError(409, "AGENT_INVALID_TRANSITION", "仅待处理中的运行可以恢复")
        return "running", event.summary, True
    if isinstance(event, AgentFinishEvent):
        return event.outcome, event.summary, True
    return "dismissed", run.summary, False


async def _locked_run(session: AsyncSession, *, run_id: UUID, caller: Caller) -> AgentRun:
    run = await session.scalar(_visible_runs(caller).where(AgentRun.id == run_id).with_for_update())
    if run is None:
        raise ApiError(404, "AGENT_RUN_NOT_FOUND", "运行不存在")
    return run


async def update_run(
    session: AsyncSession,
    *,
    caller: Caller,
    run_id: UUID,
    request_id: UUID,
    event: AgentRunEvent,
    path: str,
) -> tuple[UUID, int]:
    digest = request_hash("POST", path, event)
    receipt = await _find_receipt(session, caller.actor, request_id)
    if receipt is not None:
        return _replay_or_conflict(receipt, digest)

    run = await _locked_run(session, run_id=run_id, caller=caller)

    receipt = await _find_receipt(session, caller.actor, request_id)
    if receipt is not None:
        return _replay_or_conflict(receipt, digest)

    if run.version != event.expected_version:
        raise ApiError(409, "AGENT_VERSION_CONFLICT", "运行版本已变化，请重新读取后再上报")

    previous_status = run.status
    status, summary, touch_updated = _apply_event(run, event)
    now = datetime.now(UTC)
    run.status = status
    run.summary = summary
    run.version += 1
    if touch_updated:
        run.updated_at = now
    if status != previous_status:
        run.status_changed_at = now
    new_version = run.version
    session.add(
        AgentWriteReceipt(
            actor=caller.actor,
            request_id=request_id,
            request_hash=digest,
            run_id=run_id,
            version=new_version,
        )
    )
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        receipt = await _find_receipt(session, caller.actor, request_id)
        if receipt is not None:
            return _replay_or_conflict(receipt, digest)
        raise
    return run_id, new_version
