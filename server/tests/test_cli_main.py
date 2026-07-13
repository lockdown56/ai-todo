import json
from unittest.mock import MagicMock, patch
from uuid import UUID

import httpx
import pytest
from typer.testing import CliRunner

from app.cli.auth_store import get_session, save_session
from app.cli.client import ApiClient
from app.cli.main import app

runner = CliRunner()
TASK_ID = "00000000-0000-4000-8000-000000000001"
LIST_ID = UUID("00000000-0000-4000-8000-000000000002")


def _mock_client():
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=None)
    return client


def test_root_help_describes_command_shape_and_current_resources():
    result = runner.invoke(app, ["--help"], prog_name="todo", terminal_width=200)

    assert result.exit_code == 0
    assert "Usage: todo [GLOBAL_OPTIONS] RESOURCE COMMAND [ARGS]..." in result.stdout
    for resource in ("auth", "api-key", "list", "group", "task", "tag", "item"):
        assert resource in result.stdout
    assert "全局选项可放在资源命令前或最终子命令后" in result.stdout


def test_task_create_help_lists_recurrence_options():
    result = runner.invoke(
        app,
        ["task", "create", "--help"],
        prog_name="todo",
        terminal_width=200,
        env={"COLUMNS": "200"},
    )

    assert result.exit_code == 0
    assert "--recurrence-start" in result.stdout
    assert "--recurrence-weekday" in result.stdout
    assert "--recurrence-monthday" in result.stdout
    assert "--reminder-offset-minutes" in result.stdout
    assert "可放在资源命令前或本命令后" in result.stdout


@pytest.mark.parametrize(
    "args",
    [
        ["--output", "jsonl", "task", "ls"],
        ["task", "ls", "--output", "jsonl"],
        ["task", "--output=jsonl", "ls"],
    ],
)
def test_global_output_option_is_accepted_at_any_command_level(args):
    fake = _mock_client()
    fake.get.return_value = {"items": [], "next_cursor": None}

    with patch("app.cli.main._make_client", return_value=fake):
        result = runner.invoke(app, args)

    assert result.exit_code == 0
    assert json.loads(result.stdout)["type"] == "meta"


def test_global_version_is_accepted_after_command():
    result = runner.invoke(app, ["health", "--version"])

    assert result.exit_code == 0
    assert result.stdout == "todo 0.1.0\n"


def test_api_client_refreshes_saved_session_and_retries_request():
    unauthorized = httpx.Response(
        401,
        json={"error": {"code": "TOKEN_EXPIRED", "message": "expired"}},
        request=httpx.Request("GET", "http://test/api/v1/tasks"),
    )
    success = httpx.Response(
        200,
        json={"items": [], "next_cursor": None},
        request=httpx.Request("GET", "http://test/api/v1/tasks"),
    )
    refreshed = {
        "access_token": "new-access",
        "expires_at": "2026-07-14T00:00:00Z",
        "refresh_token": "new-refresh",
        "refresh_expires_at": "2026-08-13T00:00:00Z",
        "user": {"username": "admin"},
    }
    refresh_response = httpx.Response(
        200,
        json=refreshed,
        request=httpx.Request("POST", "http://test/api/v1/auth/refresh"),
    )
    persisted = MagicMock()
    client = ApiClient(
        "http://test",
        8,
        "old-access",
        refresh_token="old-refresh",
        on_refresh=persisted,
    )
    transport = MagicMock()
    transport.request.side_effect = [unauthorized, success]
    transport.post.return_value = refresh_response
    transport.headers = {}
    transport.close = MagicMock()
    client._client = transport

    result = client.get("/api/v1/tasks")

    assert result == {"items": [], "next_cursor": None}
    transport.post.assert_called_once_with(
        "/api/v1/auth/refresh", json={"refresh_token": "old-refresh"}
    )
    assert transport.headers["Authorization"] == "Bearer new-access"
    persisted.assert_called_once_with(refreshed)


def test_auth_login_saves_refresh_session(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    fake = _mock_client()
    fake.post.return_value = {
        "access_token": "access",
        "expires_at": "2026-07-14T00:00:00Z",
        "refresh_token": "refresh",
        "refresh_expires_at": "2026-08-13T00:00:00Z",
        "user": {"username": "admin"},
    }

    with patch("app.cli.main.ApiClient", return_value=fake):
        result = runner.invoke(
            app, ["auth", "login", "--username", "admin", "--password", "secret"]
        )

    assert result.exit_code == 0
    session = get_session("http://127.0.0.1:8000")
    assert session["refresh_token"] == "refresh"
    assert session["refresh_expires_at"] == "2026-08-13T00:00:00Z"


def test_auth_logout_revokes_refresh_token_before_removing_session(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    api_url = "http://127.0.0.1:8000"
    save_session(
        api_url,
        {
            "access_token": "access",
            "expires_at": "2026-07-14T00:00:00Z",
            "refresh_token": "refresh",
            "refresh_expires_at": "2026-08-13T00:00:00Z",
            "user": {"username": "admin"},
        },
    )
    fake = _mock_client()
    fake.post.return_value = None

    with patch("app.cli.main.ApiClient", return_value=fake):
        result = runner.invoke(app, ["auth", "logout"])

    assert result.exit_code == 0
    fake.post.assert_called_once_with("/api/v1/auth/logout", json={"refresh_token": "refresh"})
    assert get_session(api_url) is None


def test_task_list_completed_status_for_named_list():
    fake = _mock_client()
    fake.get.return_value = {"items": [], "next_cursor": None}

    with (
        patch("app.cli.main._make_client", return_value=fake),
        patch("app.cli.main.resolve_list", return_value=LIST_ID),
    ):
        result = runner.invoke(app, ["task", "ls", "--list", "工作", "--status", "completed"])

    assert result.exit_code == 0
    fake.get.assert_called_once_with(
        "/api/v1/tasks",
        params={
            "sort": "manual",
            "limit": 100,
            "list_id": str(LIST_ID),
            "status": 2,
        },
    )


def test_task_list_status_cannot_be_used_with_view():
    result = runner.invoke(app, ["task", "ls", "--view", "today", "--status", "completed"])

    assert result.exit_code == 2
    assert json.loads(result.stderr)["error"]["code"] == "CLI_USAGE_ERROR"


def test_task_create_weekly_recurrence_maps_readable_weekday():
    fake = _mock_client()
    fake.post.return_value = {"id": TASK_ID}

    with patch("app.cli.main._make_client", return_value=fake):
        result = runner.invoke(
            app,
            [
                "task",
                "create",
                "--title",
                "周报",
                "--recurrence",
                "weekly",
                "--recurrence-start",
                "2026-07-13",
                "--recurrence-end",
                "2026-12-31",
                "--recurrence-weekday",
                "mon",
                "--reminder-offset-minutes",
                "30",
            ],
        )

    assert result.exit_code == 0
    fake.post.assert_called_once_with(
        "/api/v1/tasks",
        json={
            "title": "周报",
            "recurrence_type": "weekly",
            "recurrence_start_date": "2026-07-13",
            "recurrence_end_date": "2026-12-31",
            "recurrence_weekday": 0,
            "reminder_offset_minutes": 30,
        },
    )


@pytest.mark.parametrize(
    ("extra_args", "message"),
    [
        (["--recurrence", "daily"], "--recurrence-start"),
        (
            ["--recurrence", "weekly", "--recurrence-start", "2026-07-13"],
            "--recurrence-weekday",
        ),
        (
            ["--recurrence", "monthly", "--recurrence-start", "2026-07-13"],
            "--recurrence-monthday",
        ),
        (["--recurrence-start", "2026-07-13"], "--recurrence"),
    ],
)
def test_task_create_recurrence_requires_complete_rule(extra_args, message):
    result = runner.invoke(app, ["task", "create", "--title", "任务", *extra_args])

    assert result.exit_code == 2
    assert message in json.loads(result.stderr)["error"]["message"]


def test_task_create_rejects_recurrence_end_before_start():
    result = runner.invoke(
        app,
        [
            "task",
            "create",
            "--title",
            "任务",
            "--recurrence",
            "daily",
            "--recurrence-start",
            "2026-07-13",
            "--recurrence-end",
            "2026-07-12",
        ],
    )

    assert result.exit_code == 2
    assert "不得早于" in json.loads(result.stderr)["error"]["message"]


def test_task_update_can_clear_recurrence():
    fake = _mock_client()
    fake.patch.return_value = {"id": TASK_ID}

    with patch("app.cli.main._make_client", return_value=fake):
        result = runner.invoke(app, ["task", "update", TASK_ID, "--clear-recurrence"])

    assert result.exit_code == 0
    fake.patch.assert_called_once_with(
        f"/api/v1/tasks/{TASK_ID}",
        json={
            "recurrence_type": None,
            "recurrence_start_date": None,
            "recurrence_end_date": None,
            "recurrence_weekday": None,
            "recurrence_monthday": None,
            "reminder_offset_minutes": None,
        },
    )


def test_task_update_rejects_clear_recurrence_with_rule_fields():
    result = runner.invoke(
        app,
        [
            "task",
            "update",
            TASK_ID,
            "--clear-recurrence",
            "--recurrence-end",
            "2026-12-31",
        ],
    )

    assert result.exit_code == 2
    assert "不能与其他循环参数" in json.loads(result.stderr)["error"]["message"]
