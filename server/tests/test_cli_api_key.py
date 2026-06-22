import json
from unittest.mock import MagicMock, patch

from typer.testing import CliRunner

from app.cli.main import app

runner = CliRunner()


def _mock_client():
    """返回一个可作 context manager 的 mock client。"""
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=None)
    return client


def test_api_key_create_calls_post_and_outputs_plaintext():
    fake = _mock_client()
    fake.post.return_value = {
        "id": "00000000-0000-4000-8000-000000000001",
        "name": "CI",
        "key_prefix": "tdl_abc12345",
        "last_used_at": None,
        "expires_at": None,
        "created_at": "2026-06-21T00:00:00Z",
        "api_key": "tdl_secretvalue",
    }
    with patch("app.cli.main._make_client", return_value=fake):
        result = runner.invoke(app, ["api-key", "create", "--name", "CI"])
    assert result.exit_code == 0
    fake.post.assert_called_once_with("/api/v1/api-keys", json={"name": "CI"})
    payload = json.loads(result.stdout)
    assert payload["data"]["api_key"] == "tdl_secretvalue"
    assert payload["data"]["name"] == "CI"


def test_api_key_ls_calls_get_and_outputs_list():
    fake = _mock_client()
    fake.get.return_value = [
        {
            "id": "00000000-0000-4000-8000-000000000001",
            "name": "CI",
            "key_prefix": "tdl_abc12345",
            "last_used_at": None,
            "expires_at": None,
            "created_at": "2026-06-21T00:00:00Z",
        }
    ]
    with patch("app.cli.main._make_client", return_value=fake):
        result = runner.invoke(app, ["api-key", "ls"])
    assert result.exit_code == 0
    fake.get.assert_called_once_with("/api/v1/api-keys")
    payload = json.loads(result.stdout)
    items = payload["data"]
    assert len(items) == 1
    assert items[0]["name"] == "CI"


def test_api_key_delete_requires_confirmation():
    result = runner.invoke(
        app, ["api-key", "delete", "00000000-0000-4000-8000-000000000001"]
    )
    assert result.exit_code != 0


def test_api_key_delete_calls_delete_endpoint():
    fake = _mock_client()
    fake.delete.return_value = None
    with patch("app.cli.main._make_client", return_value=fake):
        result = runner.invoke(
            app, ["api-key", "delete", "00000000-0000-4000-8000-000000000001", "--yes"]
        )
    assert result.exit_code == 0
    fake.delete.assert_called_once_with(
        "/api/v1/api-keys/00000000-0000-4000-8000-000000000001"
    )


def test_api_key_option_is_used_as_bearer_token():
    """--api-key 应作为 Bearer 凭据传给 ApiClient。"""
    captured = {}

    def capture_make_client(ctx):
        from app.cli.main import _get_token

        token = _get_token(ctx)
        captured["token"] = token
        fake = _mock_client()
        fake.get.return_value = []
        return fake

    with patch("app.cli.main._make_client", side_effect=capture_make_client):
        result = runner.invoke(
            app, ["--api-key", "tdl_testkey123", "api-key", "ls"]
        )
    assert result.exit_code == 0
    assert captured["token"] == "tdl_testkey123"


def test_token_option_overrides_api_key_option():
    """--token 优先级高于 --api-key。"""
    captured = {}

    def capture_make_client(ctx):
        from app.cli.main import _get_token

        captured["token"] = _get_token(ctx)
        fake = _mock_client()
        fake.get.return_value = []
        return fake

    with patch("app.cli.main._make_client", side_effect=capture_make_client):
        runner.invoke(
            app,
            ["--token", "jwt-token", "--api-key", "tdl_key", "api-key", "ls"],
        )
    assert captured["token"] == "jwt-token"


def test_api_key_env_var_is_used(monkeypatch):
    """TODOLIST_API_KEY 环境变量应作为凭据。"""
    monkeypatch.setenv("TODOLIST_API_KEY", "tdl_envkey")
    captured = {}

    def capture_make_client(ctx):
        from app.cli.main import _get_token

        captured["token"] = _get_token(ctx)
        fake = _mock_client()
        fake.get.return_value = []
        return fake

    with patch("app.cli.main._make_client", side_effect=capture_make_client):
        result = runner.invoke(app, ["api-key", "ls"])
    assert result.exit_code == 0
    assert captured["token"] == "tdl_envkey"
