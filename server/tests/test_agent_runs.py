import base64
import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.database import get_session
from app.main import create_app
from app.models import AgentRun

RUN_PATH = "/api/v1/agent-runs"
RUN_FIELDS = {
    "id",
    "source",
    "title",
    "summary",
    "status",
    "version",
    "session_ref",
    "session_url",
    "workspace_label",
    "task_id",
    "created_at",
    "updated_at",
    "status_changed_at",
}


def _test_app(session_factory):
    app = create_app(initialize=False)

    async def override_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    return app


@pytest_asyncio.fixture
async def key_client(session_factory, client):
    app = _test_app(session_factory)
    clients: list[AsyncClient] = []

    async def make(name: str = "Codex", scope: str = "agent_reporter") -> AsyncClient:
        created = await client.post("/api/v1/api-keys", json={"name": name, "scope": scope})
        assert created.status_code == 201, created.text
        http_client = AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {created.json()['api_key']}"},
        )
        clients.append(http_client)
        return http_client

    yield make
    for http_client in clients:
        await http_client.aclose()


@pytest_asyncio.fixture
async def anonymous_client(session_factory):
    async with AsyncClient(
        transport=ASGITransport(app=_test_app(session_factory)),
        base_url="http://test",
    ) as http_client:
        yield http_client


def _idempotency(request_id: UUID | None = None) -> dict[str, str]:
    return {"Idempotency-Key": str(request_id or uuid4())}


def _error(response) -> dict:
    return response.json()["error"]


async def _start_run(
    reporter: AsyncClient,
    *,
    title: str = "排查回调异常",
    request_id: UUID | None = None,
    run_id: UUID | None = None,
    **fields,
) -> tuple[str, dict]:
    run_id = run_id or uuid4()
    response = await reporter.post(
        RUN_PATH,
        json={"id": str(run_id), "title": title, **fields},
        headers=_idempotency(request_id),
    )
    assert response.status_code == 201, response.text
    return str(run_id), response.json()


async def _send_event(
    client: AsyncClient, run_id: str, payload: dict, request_id: UUID | None = None
):
    return await client.post(
        f"{RUN_PATH}/{run_id}/events",
        json=payload,
        headers=_idempotency(request_id),
    )


async def _get_run(client: AsyncClient, run_id: str) -> dict:
    response = await client.get(f"{RUN_PATH}/{run_id}")
    assert response.status_code == 200, response.text
    return response.json()


async def _set_run_state(
    session_factory,
    run_id: str,
    *,
    status: str | None = None,
    updated_at: datetime | None = None,
    status_changed_at: datetime | None = None,
) -> None:
    async with session_factory() as session:
        run = await session.get(AgentRun, UUID(run_id))
        assert run is not None
        if status is not None:
            run.status = status
        if updated_at is not None:
            run.updated_at = updated_at
        if status_changed_at is not None:
            run.status_changed_at = status_changed_at
        await session.commit()


def _dt(day: int, hour: int) -> datetime:
    return datetime(2026, 1, day, hour, 0, 0, tzinfo=UTC)


async def test_create_run_replay_and_conflict(client, key_client):
    reporter = await key_client("Codex · 工作电脑")
    run_id = str(uuid4())
    request_id = uuid4()
    body = {
        "id": run_id,
        "title": "  排查回调异常  ",
        "summary": "已定位重复回调",
        "session_ref": "  支付回调排查 ",
        "session_url": "https://codex.example/sessions/1",
        "workspace_label": " 支付服务 ",
    }

    created = await reporter.post(RUN_PATH, json=body, headers=_idempotency(request_id))
    assert created.status_code == 201
    assert created.json() == {"run_id": run_id, "version": 1}

    replay = await reporter.post(RUN_PATH, json=body, headers=_idempotency(request_id))
    assert replay.status_code == 201
    assert replay.json() == {"run_id": run_id, "version": 1}

    different_body = await reporter.post(
        RUN_PATH,
        json={**body, "title": "另一个标题"},
        headers=_idempotency(request_id),
    )
    assert different_body.status_code == 409
    assert _error(different_body)["code"] == "IDEMPOTENCY_CONFLICT"

    taken_id = await reporter.post(RUN_PATH, json=body, headers=_idempotency())
    assert taken_id.status_code == 409
    assert _error(taken_id)["code"] == "AGENT_RUN_ID_CONFLICT"

    detail = await _get_run(client, run_id)
    assert set(detail) == RUN_FIELDS
    assert detail["source"] == "Codex · 工作电脑"
    assert detail["title"] == "排查回调异常"
    assert detail["summary"] == "已定位重复回调"
    assert detail["session_ref"] == "支付回调排查"
    assert detail["workspace_label"] == "支付服务"
    assert detail["session_url"] == "https://codex.example/sessions/1"
    assert detail["task_id"] is None
    assert detail["status"] == "running"
    assert detail["version"] == 1
    for field in ("created_at", "updated_at", "status_changed_at"):
        assert datetime.fromisoformat(detail[field]).tzinfo is not None

    other_reporter = await key_client("Claude")
    other_run_id = str(uuid4())
    other = await other_reporter.post(
        RUN_PATH,
        json={"id": other_run_id, "title": "同一请求 ID 的另一来源"},
        headers=_idempotency(request_id),
    )
    assert other.status_code == 201
    assert other.json() == {"run_id": other_run_id, "version": 1}


async def test_create_validation_and_idempotency_header(client, key_client):
    reporter = await key_client("Codex")
    valid = {"id": str(uuid4()), "title": "标题"}

    missing_header = await reporter.post(RUN_PATH, json=valid)
    assert missing_header.status_code == 422
    assert _error(missing_header)["code"] == "VALIDATION_ERROR"

    bad_header = await reporter.post(
        RUN_PATH, json=valid, headers={"Idempotency-Key": "not-a-uuid"}
    )
    assert bad_header.status_code == 422

    unknown_field = await reporter.post(
        RUN_PATH, json={**valid, "unknown": 1}, headers=_idempotency()
    )
    assert unknown_field.status_code == 422

    blank_title = await reporter.post(
        RUN_PATH, json={"id": str(uuid4()), "title": "   "}, headers=_idempotency()
    )
    assert blank_title.status_code == 422

    long_title = await reporter.post(
        RUN_PATH, json={"id": str(uuid4()), "title": "长" * 161}, headers=_idempotency()
    )
    assert long_title.status_code == 422

    insecure_url = await reporter.post(
        RUN_PATH,
        json={"id": str(uuid4()), "title": "标题", "session_url": "http://codex.example/a"},
        headers=_idempotency(),
    )
    assert insecure_url.status_code == 422

    credential_url = await reporter.post(
        RUN_PATH,
        json={
            "id": str(uuid4()),
            "title": "标题",
            "session_url": "https://user:pass@codex.example/a",
        },
        headers=_idempotency(),
    )
    assert credential_url.status_code == 422


async def test_read_permissions_and_scope_boundaries(client, key_client, anonymous_client):
    codex = await key_client("Codex")
    claude = await key_client("Claude")
    todo_key = await key_client("普通 Key", scope="todo_full")

    codex_run, _ = await _start_run(codex, title="Codex 的工作")

    assert (await anonymous_client.get(RUN_PATH, params={"lane": "active"})).status_code == 401

    assert (await codex.get(f"{RUN_PATH}/{codex_run}")).status_code == 200
    cross_read = await claude.get(f"{RUN_PATH}/{codex_run}")
    assert cross_read.status_code == 404
    assert _error(cross_read)["code"] == "AGENT_RUN_NOT_FOUND"
    missing = await client.get(f"{RUN_PATH}/{uuid4()}")
    assert missing.status_code == 404
    assert _error(missing)["code"] == "AGENT_RUN_NOT_FOUND"

    cross_write = await _send_event(
        claude,
        codex_run,
        {"type": "progress", "expected_version": 1, "summary": "越权上报"},
    )
    assert cross_write.status_code == 404
    assert _error(cross_write)["code"] == "AGENT_RUN_NOT_FOUND"

    claude_run, _ = await _start_run(claude, title="Claude 的工作")
    claude_list = await claude.get(RUN_PATH, params={"lane": "active"})
    assert [item["id"] for item in claude_list.json()["items"]] == [claude_run]

    user_list = await client.get(RUN_PATH, params={"lane": "active"})
    assert {item["id"] for item in user_list.json()["items"]} == {codex_run, claude_run}

    jwt_create = await client.post(
        RUN_PATH, json={"id": str(uuid4()), "title": "用户直接创建"}, headers=_idempotency()
    )
    assert jwt_create.status_code == 403
    assert _error(jwt_create)["code"] == "AGENT_OPERATION_FORBIDDEN"

    todo_create = await todo_key.post(
        RUN_PATH, json={"id": str(uuid4()), "title": "普通 Key 创建"}, headers=_idempotency()
    )
    assert todo_create.status_code == 403
    assert _error(todo_create)["code"] == "AGENT_OPERATION_FORBIDDEN"

    reporter_business = await codex.get("/api/v1/lists")
    assert reporter_business.status_code == 403
    assert _error(reporter_business)["code"] == "API_KEY_NOT_ALLOWED"

    todo_business = await todo_key.get("/api/v1/lists")
    assert todo_business.status_code == 200


async def test_state_transitions_versions_and_terminal_invariance(client, key_client):
    codex = await key_client("Codex")
    run_id, created = await _start_run(codex)
    assert created["version"] == 1
    initial = await _get_run(client, run_id)

    first_request = uuid4()
    progress_body = {"type": "progress", "expected_version": 1, "summary": "  已定位重复回调 "}
    progressed = await _send_event(codex, run_id, progress_body, request_id=first_request)
    assert progressed.status_code == 200
    assert progressed.json() == {"run_id": run_id, "version": 2}
    detail = await _get_run(client, run_id)
    assert detail["summary"] == "已定位重复回调"
    assert detail["status"] == "running"
    assert detail["version"] == 2
    assert datetime.fromisoformat(detail["updated_at"]) >= datetime.fromisoformat(
        initial["updated_at"]
    )
    assert detail["status_changed_at"] == initial["status_changed_at"]

    stale = await _send_event(
        codex, run_id, {"type": "progress", "expected_version": 1, "summary": "过期版本"}
    )
    assert stale.status_code == 409
    assert _error(stale)["code"] == "AGENT_VERSION_CONFLICT"

    conflicting = await _send_event(
        codex,
        run_id,
        {"type": "progress", "expected_version": 1, "summary": "内容不同"},
        request_id=first_request,
    )
    assert conflicting.status_code == 409
    assert _error(conflicting)["code"] == "IDEMPOTENCY_CONFLICT"

    waiting = await _send_event(
        codex,
        run_id,
        {"type": "wait", "expected_version": 2, "reason": "请回原会话确认是否运行迁移"},
    )
    assert waiting.status_code == 200
    assert waiting.json() == {"run_id": run_id, "version": 3}
    detail = await _get_run(client, run_id)
    assert detail["status"] == "waiting_user"
    assert detail["summary"] == "请回原会话确认是否运行迁移"
    assert datetime.fromisoformat(detail["status_changed_at"]) > datetime.fromisoformat(
        initial["status_changed_at"]
    )

    invalid_progress = await _send_event(
        codex, run_id, {"type": "progress", "expected_version": 3, "summary": "待处理中上报进展"}
    )
    assert invalid_progress.status_code == 409
    assert _error(invalid_progress)["code"] == "AGENT_INVALID_TRANSITION"

    waiting_again = await _send_event(
        codex, run_id, {"type": "wait", "expected_version": 3, "reason": "补充确认事项"}
    )
    assert waiting_again.status_code == 200
    assert waiting_again.json()["version"] == 4

    resumed = await _send_event(
        codex, run_id, {"type": "resume", "expected_version": 4, "summary": "已确认，继续验证"}
    )
    assert resumed.status_code == 200
    assert resumed.json()["version"] == 5
    assert (await _get_run(client, run_id))["status"] == "running"

    invalid_resume = await _send_event(
        codex, run_id, {"type": "resume", "expected_version": 5, "summary": "重复恢复"}
    )
    assert invalid_resume.status_code == 409
    assert _error(invalid_resume)["code"] == "AGENT_INVALID_TRANSITION"

    finished = await _send_event(
        codex,
        run_id,
        {
            "type": "finish",
            "expected_version": 5,
            "outcome": "succeeded",
            "summary": "回归验证完成",
        },
    )
    assert finished.status_code == 200
    assert finished.json() == {"run_id": run_id, "version": 6}
    detail = await _get_run(client, run_id)
    assert detail["status"] == "succeeded"
    assert detail["summary"] == "回归验证完成"
    assert detail["version"] == 6

    replay = await _send_event(codex, run_id, progress_body, request_id=first_request)
    assert replay.status_code == 200
    assert replay.json() == {"run_id": run_id, "version": 2}

    for payload in (
        {"type": "progress", "expected_version": 6, "summary": "终态进展"},
        {"type": "wait", "expected_version": 6, "reason": "终态待处理"},
        {"type": "resume", "expected_version": 6, "summary": "终态恢复"},
        {"type": "finish", "expected_version": 6, "outcome": "failed", "summary": "终态结束"},
    ):
        rejected = await _send_event(codex, run_id, payload)
        assert rejected.status_code == 409
        assert _error(rejected)["code"] == "AGENT_INVALID_TRANSITION"

    user_dismiss = await _send_event(client, run_id, {"type": "dismiss", "expected_version": 6})
    assert user_dismiss.status_code == 409
    assert _error(user_dismiss)["code"] == "AGENT_INVALID_TRANSITION"


async def test_dismiss_keeps_updated_at_and_permissions(client, key_client):
    codex = await key_client("Codex")
    todo_key = await key_client("普通 Key", scope="todo_full")
    run_id, _ = await _start_run(codex, title="需要取消跟踪", summary="原始摘要")
    initial = await _get_run(client, run_id)

    reporter_dismiss = await _send_event(codex, run_id, {"type": "dismiss", "expected_version": 1})
    assert reporter_dismiss.status_code == 403
    assert _error(reporter_dismiss)["code"] == "AGENT_OPERATION_FORBIDDEN"

    todo_progress = await _send_event(
        todo_key, run_id, {"type": "progress", "expected_version": 1, "summary": "普通 Key 上报"}
    )
    assert todo_progress.status_code == 403
    assert _error(todo_progress)["code"] == "AGENT_OPERATION_FORBIDDEN"

    user_progress = await _send_event(
        client, run_id, {"type": "progress", "expected_version": 1, "summary": "用户上报"}
    )
    assert user_progress.status_code == 403
    assert _error(user_progress)["code"] == "AGENT_OPERATION_FORBIDDEN"

    request_id = uuid4()
    dismiss_body = {"type": "dismiss", "expected_version": 1}
    dismissed = await _send_event(client, run_id, dismiss_body, request_id=request_id)
    assert dismissed.status_code == 200
    assert dismissed.json() == {"run_id": run_id, "version": 2}

    detail = await _get_run(client, run_id)
    assert detail["status"] == "dismissed"
    assert detail["summary"] == "原始摘要"
    assert detail["version"] == 2
    assert detail["updated_at"] == initial["updated_at"]
    assert datetime.fromisoformat(detail["status_changed_at"]) > datetime.fromisoformat(
        initial["status_changed_at"]
    )

    replay = await _send_event(client, run_id, dismiss_body, request_id=request_id)
    assert replay.status_code == 200
    assert replay.json() == {"run_id": run_id, "version": 2}

    again = await _send_event(client, run_id, {"type": "dismiss", "expected_version": 2})
    assert again.status_code == 409
    assert _error(again)["code"] == "AGENT_INVALID_TRANSITION"

    history = await client.get(RUN_PATH, params={"lane": "history"})
    assert [item["id"] for item in history.json()["items"]] == [run_id]
    assert history.json()["items"][0]["status"] == "dismissed"


async def test_lane_ordering_and_keyset_pagination(client, key_client, session_factory):
    codex = await key_client("Codex")

    active_ids = []
    for title in ("进行中 A", "进行中 B", "进行中 C"):
        run_id, _ = await _start_run(codex, title=title)
        active_ids.append(run_id)
    await _set_run_state(session_factory, active_ids[0], updated_at=_dt(1, 10))
    await _set_run_state(session_factory, active_ids[1], updated_at=_dt(1, 12))
    await _set_run_state(session_factory, active_ids[2], updated_at=_dt(1, 11))

    first_page = await client.get(RUN_PATH, params={"lane": "active", "limit": 2})
    assert first_page.status_code == 200
    page = first_page.json()
    assert [item["id"] for item in page["items"]] == [active_ids[1], active_ids[2]]
    assert page["next_cursor"]
    second_page = await client.get(
        RUN_PATH, params={"lane": "active", "limit": 2, "cursor": page["next_cursor"]}
    )
    assert [item["id"] for item in second_page.json()["items"]] == [active_ids[0]]
    assert second_page.json()["next_cursor"] is None

    attention_ids = []
    for title in ("待处理 A", "待处理 B", "待处理 C"):
        run_id, _ = await _start_run(codex, title=title)
        attention_ids.append(run_id)
    await _set_run_state(
        session_factory, attention_ids[0], status="waiting_user", status_changed_at=_dt(1, 10)
    )
    await _set_run_state(
        session_factory, attention_ids[1], status="waiting_user", status_changed_at=_dt(1, 12)
    )
    await _set_run_state(
        session_factory, attention_ids[2], status="waiting_user", status_changed_at=_dt(1, 11)
    )
    attention = await client.get(RUN_PATH, params={"lane": "attention"})
    assert [item["id"] for item in attention.json()["items"]] == [
        attention_ids[0],
        attention_ids[2],
        attention_ids[1],
    ]

    history_ids = []
    for title, status, hour in (
        ("已成功", "succeeded", 10),
        ("已失败", "failed", 12),
        ("已取消", "cancelled", 11),
    ):
        run_id, _ = await _start_run(codex, title=title)
        await _set_run_state(session_factory, run_id, status=status, status_changed_at=_dt(1, hour))
        history_ids.append(run_id)
    history = await client.get(RUN_PATH, params={"lane": "history"})
    assert [item["id"] for item in history.json()["items"]] == [
        history_ids[1],
        history_ids[2],
        history_ids[0],
    ]

    active = await client.get(RUN_PATH, params={"lane": "active"})
    assert {item["id"] for item in active.json()["items"]} == set(active_ids)
    attention_ids_set = {item["id"] for item in attention.json()["items"]}
    assert attention_ids_set == set(attention_ids)

    assert (await client.get(RUN_PATH)).status_code == 422
    assert (await client.get(RUN_PATH, params={"lane": "unknown"})).status_code == 422
    assert (await client.get(RUN_PATH, params={"lane": "active", "limit": 0})).status_code == 422
    assert (await client.get(RUN_PATH, params={"lane": "active", "limit": 101})).status_code == 422


async def test_source_filter_and_cursor_validation(client, key_client):
    codex = await key_client("Codex")
    claude = await key_client("Claude")
    codex_run, _ = await _start_run(codex, title="Codex 的工作")
    claude_run, _ = await _start_run(claude, title="Claude 的工作")

    only_codex = await client.get(RUN_PATH, params={"lane": "active", "source": "Codex"})
    assert [item["id"] for item in only_codex.json()["items"]] == [codex_run]
    padded = await client.get(RUN_PATH, params={"lane": "active", "source": "  Codex  "})
    assert [item["id"] for item in padded.json()["items"]] == [codex_run]
    blank = await client.get(RUN_PATH, params={"lane": "active", "source": "   "})
    assert {item["id"] for item in blank.json()["items"]} == {codex_run, claude_run}
    missing = await client.get(RUN_PATH, params={"lane": "active", "source": "Missing"})
    assert missing.json() == {"items": [], "next_cursor": None}

    page = await client.get(RUN_PATH, params={"lane": "active", "limit": 1})
    cursor = page.json()["next_cursor"]
    assert cursor
    decoded = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode())
    assert decoded["lane"] == "active"
    assert decoded["source"] is None
    assert datetime.fromisoformat(decoded["t"]).tzinfo is not None
    UUID(decoded["id"])

    wrong_lane = await client.get(RUN_PATH, params={"lane": "attention", "cursor": cursor})
    assert wrong_lane.status_code == 422
    assert _error(wrong_lane)["code"] == "INVALID_CURSOR"
    wrong_source = await client.get(
        RUN_PATH, params={"lane": "active", "source": "Codex", "cursor": cursor}
    )
    assert wrong_source.status_code == 422
    assert _error(wrong_source)["code"] == "INVALID_CURSOR"
    garbage = await client.get(RUN_PATH, params={"lane": "active", "cursor": "not-a-cursor"})
    assert garbage.status_code == 422
    assert _error(garbage)["code"] == "INVALID_CURSOR"


async def test_task_association_validation_and_cleanup(client, key_client):
    codex = await key_client("Codex")
    task = (await client.post("/api/v1/tasks", json={"title": "关联待办"})).json()
    run_id, _ = await _start_run(codex, title="关联工作", task_id=task["id"])
    assert (await _get_run(client, run_id))["task_id"] == task["id"]

    invalid = await codex.post(
        RUN_PATH,
        json={"id": str(uuid4()), "title": "无效关联", "task_id": str(uuid4())},
        headers=_idempotency(),
    )
    assert invalid.status_code == 404
    assert _error(invalid)["code"] == "TASK_NOT_FOUND"

    assert (await client.delete(f"/api/v1/tasks/{task['id']}")).status_code == 204
    deleted_task = await codex.post(
        RUN_PATH,
        json={"id": str(uuid4()), "title": "软删除关联", "task_id": task["id"]},
        headers=_idempotency(),
    )
    assert deleted_task.status_code == 404
    assert _error(deleted_task)["code"] == "TASK_NOT_FOUND"

    assert (await client.delete(f"/api/v1/tasks/{task['id']}/permanent")).status_code == 204
    assert (await _get_run(client, run_id))["task_id"] is None


async def test_event_validation(client, key_client):
    codex = await key_client("Codex")
    run_id, _ = await _start_run(codex)

    cases = [
        {"type": "progress", "expected_version": 1, "summary": "汇报", "extra": 1},
        {"type": "unknown", "expected_version": 1},
        {"type": "progress", "expected_version": 1},
        {"type": "progress", "expected_version": 1, "summary": "   "},
        {"type": "wait", "expected_version": 1},
        {"type": "wait", "expected_version": 0, "reason": "原因"},
        {"type": "resume", "expected_version": 1},
        {"type": "finish", "expected_version": 1, "outcome": "done", "summary": "结果"},
        {"type": "finish", "expected_version": 1, "outcome": "failed"},
        {"type": "dismiss", "expected_version": 1, "extra": "x"},
    ]
    for payload in cases:
        response = await _send_event(codex, run_id, payload)
        assert response.status_code == 422, payload
        assert _error(response)["code"] == "VALIDATION_ERROR"

    missing_header = await codex.post(
        f"{RUN_PATH}/{run_id}/events",
        json={"type": "progress", "expected_version": 1, "summary": "汇报"},
    )
    assert missing_header.status_code == 422
    bad_header = await codex.post(
        f"{RUN_PATH}/{run_id}/events",
        json={"type": "progress", "expected_version": 1, "summary": "汇报"},
        headers={"Idempotency-Key": "nope"},
    )
    assert bad_header.status_code == 422

    assert (await _get_run(client, run_id))["version"] == 1
