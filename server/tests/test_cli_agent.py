import json
from unittest.mock import MagicMock, patch
from uuid import UUID

import httpx
import pytest
from typer.testing import CliRunner

from app.cli.client import ApiClient
from app.cli.main import app

runner = CliRunner()

RUN_ID = "11111111-1111-4111-8111-111111111111"
REQUEST_ID = "22222222-2222-4222-8222-222222222222"
TASK_ID = "33333333-3333-4333-8333-333333333333"
EVENTS_PATH = f"/api/v1/agent-runs/{RUN_ID}/events"


def _mock_client():
    """返回一个可作 context manager 的 mock client。"""
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=None)
    return client


def _run(args, fake):
    with patch("app.cli.main._make_client", return_value=fake):
        return runner.invoke(app, args)


def _http_client(status_code: int, body: dict) -> ApiClient:
    """真实 ApiClient，但把 httpx 传输层替换为固定响应。"""
    transport = MagicMock()
    transport.request.return_value = httpx.Response(
        status_code,
        json=body,
        request=httpx.Request("POST", "http://test"),
    )
    transport.headers = {}
    transport.close = MagicMock()
    client = ApiClient("http://test", 8, "tdl_testkey")
    client._client = transport
    return client


def test_agent_start_posts_run_with_idempotency_key():
    fake = _mock_client()
    fake.post.return_value = {"run_id": RUN_ID, "version": 1}

    result = _run(
        [
            "agent",
            "start",
            "--id",
            RUN_ID,
            "--title",
            "排查回调异常",
            "--request-id",
            REQUEST_ID,
        ],
        fake,
    )

    assert result.exit_code == 0
    fake.post.assert_called_once_with(
        "/api/v1/agent-runs",
        json={"id": RUN_ID, "title": "排查回调异常"},
        headers={"Idempotency-Key": REQUEST_ID},
    )
    assert json.loads(result.stdout)["data"] == {"run_id": RUN_ID, "version": 1}


def test_agent_start_includes_optional_fields():
    fake = _mock_client()
    fake.post.return_value = {"run_id": RUN_ID, "version": 1}

    result = _run(
        [
            "agent",
            "start",
            "--id",
            RUN_ID,
            "--title",
            "排查回调异常",
            "--summary",
            "已开始复现",
            "--session-ref",
            "支付回调排查",
            "--session-url",
            "https://codex.example.com/session/1",
            "--workspace",
            "payment-service",
            "--task-id",
            TASK_ID,
            "--request-id",
            REQUEST_ID,
        ],
        fake,
    )

    assert result.exit_code == 0
    fake.post.assert_called_once_with(
        "/api/v1/agent-runs",
        json={
            "id": RUN_ID,
            "title": "排查回调异常",
            "summary": "已开始复现",
            "session_ref": "支付回调排查",
            "session_url": "https://codex.example.com/session/1",
            "workspace_label": "payment-service",
            "task_id": TASK_ID,
        },
        headers={"Idempotency-Key": REQUEST_ID},
    )


@pytest.mark.parametrize(
    "args",
    [
        ["agent", "start", "--id", RUN_ID, "--title", "任务"],
        ["agent", "progress", RUN_ID, "--expected-version", "1", "--summary", "进展"],
        ["agent", "wait", RUN_ID, "--expected-version", "1", "--reason", "请确认"],
    ],
)
def test_agent_generates_request_id_when_omitted(args):
    fake = _mock_client()
    fake.post.return_value = {"run_id": RUN_ID, "version": 2}

    result = _run(args, fake)

    assert result.exit_code == 0
    headers = fake.post.call_args.kwargs["headers"]
    assert UUID(headers["Idempotency-Key"])


def test_agent_get_reads_run_detail():
    fake = _mock_client()
    fake.get.return_value = {"id": RUN_ID, "version": 2, "status": "waiting_user"}

    result = _run(["agent", "get", RUN_ID], fake)

    assert result.exit_code == 0
    fake.get.assert_called_once_with(f"/api/v1/agent-runs/{RUN_ID}")
    assert json.loads(result.stdout)["data"]["status"] == "waiting_user"


@pytest.mark.parametrize(
    ("command_args", "expected_body"),
    [
        (
            ["agent", "progress", RUN_ID, "--expected-version", "3", "--summary", "已定位重复回调"],
            {"type": "progress", "expected_version": 3, "summary": "已定位重复回调"},
        ),
        (
            [
                "agent",
                "wait",
                RUN_ID,
                "--expected-version",
                "3",
                "--reason",
                "请回原会话确认是否运行迁移",
            ],
            {"type": "wait", "expected_version": 3, "reason": "请回原会话确认是否运行迁移"},
        ),
        (
            ["agent", "resume", RUN_ID, "--expected-version", "3", "--summary", "已确认，继续验证"],
            {"type": "resume", "expected_version": 3, "summary": "已确认，继续验证"},
        ),
        (
            [
                "agent",
                "finish",
                RUN_ID,
                "--expected-version",
                "3",
                "--outcome",
                "succeeded",
                "--summary",
                "回归验证完成",
            ],
            {
                "type": "finish",
                "expected_version": 3,
                "outcome": "succeeded",
                "summary": "回归验证完成",
            },
        ),
    ],
)
def test_agent_event_posts_event_with_idempotency_key(command_args, expected_body):
    fake = _mock_client()
    fake.post.return_value = {"run_id": RUN_ID, "version": 4}

    result = _run([*command_args, "--request-id", REQUEST_ID], fake)

    assert result.exit_code == 0
    fake.post.assert_called_once_with(
        EVENTS_PATH,
        json=expected_body,
        headers={"Idempotency-Key": REQUEST_ID},
    )
    assert json.loads(result.stdout)["data"] == {"run_id": RUN_ID, "version": 4}


@pytest.mark.parametrize(
    "args",
    [
        ["agent", "start", "--id", "not-a-uuid", "--title", "任务"],
        ["agent", "start", "--id", RUN_ID, "--title", "任务", "--request-id", "not-a-uuid"],
        ["agent", "start", "--id", RUN_ID, "--title", "任务", "--task-id", "not-a-uuid"],
        ["agent", "get", "not-a-uuid"],
        ["agent", "progress", "not-a-uuid", "--expected-version", "1", "--summary", "进展"],
        [
            "agent",
            "finish",
            RUN_ID,
            "--expected-version",
            "1",
            "--outcome",
            "succeeded",
            "--summary",
            "完成",
            "--request-id",
            "not-a-uuid",
        ],
    ],
)
def test_agent_rejects_invalid_uuid(args):
    fake = _mock_client()

    result = _run(args, fake)

    assert result.exit_code == 2
    assert json.loads(result.stderr)["error"]["code"] == "CLI_USAGE_ERROR"
    fake.post.assert_not_called()
    fake.get.assert_not_called()


@pytest.mark.parametrize(
    "args",
    [
        ["agent", "progress", RUN_ID, "--expected-version", "0", "--summary", "进展"],
        ["agent", "wait", RUN_ID, "--expected-version=0", "--reason", "请确认"],
        ["agent", "resume", RUN_ID, "--expected-version", "0", "--summary", "恢复"],
        [
            "agent",
            "finish",
            RUN_ID,
            "--expected-version",
            "0",
            "--outcome",
            "failed",
            "--summary",
            "失败",
        ],
    ],
)
def test_agent_requires_positive_expected_version(args):
    fake = _mock_client()

    result = _run(args, fake)

    assert result.exit_code == 2
    assert json.loads(result.stderr)["error"]["code"] == "CLI_USAGE_ERROR"
    fake.post.assert_not_called()


def test_agent_finish_rejects_invalid_outcome():
    fake = _mock_client()

    result = _run(
        [
            "agent",
            "finish",
            RUN_ID,
            "--expected-version",
            "1",
            "--outcome",
            "done",
            "--summary",
            "完成",
        ],
        fake,
    )

    assert result.exit_code == 2
    error = json.loads(result.stderr)["error"]
    assert error["code"] == "CLI_USAGE_ERROR"
    assert "succeeded" in error["message"]
    fake.post.assert_not_called()


def test_agent_start_requires_id_and_title():
    result = _run(["agent", "start", "--title", "任务"], _mock_client())

    assert result.exit_code == 2
    assert result.stdout == ""


@pytest.mark.parametrize(
    ("status_code", "code", "exit_code"),
    [
        (409, "AGENT_VERSION_CONFLICT", 4),
        (403, "AGENT_OPERATION_FORBIDDEN", 6),
        (422, "VALIDATION_ERROR", 5),
        (404, "AGENT_RUN_NOT_FOUND", 3),
    ],
)
def test_agent_event_maps_server_error_exit_codes(status_code, code, exit_code):
    client = _http_client(status_code, {"error": {"code": code, "message": "写入失败"}})

    with patch("app.cli.main._make_client", return_value=client):
        result = runner.invoke(
            app,
            ["agent", "progress", RUN_ID, "--expected-version", "1", "--summary", "进展"],
        )

    assert result.exit_code == exit_code
    error = json.loads(result.stderr)["error"]
    assert error["code"] == code
    assert error["http_status"] == status_code


def test_api_key_create_passes_scope():
    fake = _mock_client()
    fake.post.return_value = {
        "id": "44444444-4444-4444-8444-444444444444",
        "name": "Codex · 工作电脑",
        "scope": "agent_reporter",
        "api_key": "tdl_secretvalue",
    }

    result = _run(
        ["api-key", "create", "--name", "Codex · 工作电脑", "--scope", "agent_reporter"],
        fake,
    )

    assert result.exit_code == 0
    fake.post.assert_called_once_with(
        "/api/v1/api-keys",
        json={"name": "Codex · 工作电脑", "scope": "agent_reporter"},
    )
    assert json.loads(result.stdout)["data"]["scope"] == "agent_reporter"


def test_api_key_create_accepts_todo_full_scope():
    fake = _mock_client()
    fake.post.return_value = {"id": "44444444-4444-4444-8444-444444444444"}

    result = _run(["api-key", "create", "--name", "CI", "--scope", "todo_full"], fake)

    assert result.exit_code == 0
    fake.post.assert_called_once_with("/api/v1/api-keys", json={"name": "CI", "scope": "todo_full"})


def test_api_key_create_rejects_invalid_scope():
    fake = _mock_client()

    result = _run(["api-key", "create", "--name", "CI", "--scope", "admin"], fake)

    assert result.exit_code == 2
    error = json.loads(result.stderr)["error"]
    assert error["code"] == "CLI_USAGE_ERROR"
    assert "todo_full" in error["message"]
    fake.post.assert_not_called()


def test_api_client_post_passes_headers_to_transport():
    client = _http_client(200, {"run_id": RUN_ID, "version": 2})

    data = client.post(
        EVENTS_PATH,
        json={"type": "progress", "expected_version": 1, "summary": "进展"},
        headers={"Idempotency-Key": REQUEST_ID},
    )

    assert data == {"run_id": RUN_ID, "version": 2}
    client._client.request.assert_called_once_with(
        "POST",
        EVENTS_PATH,
        json={"type": "progress", "expected_version": 1, "summary": "进展"},
        headers={"Idempotency-Key": REQUEST_ID},
    )
