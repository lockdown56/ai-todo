import os

from app.cli.auth_store import delete_session, get_session, save_session


def test_auth_session_is_stored_per_api_url(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    session = {
        "access_token": "secret-token",
        "expires_at": "2026-06-20T00:00:00Z",
        "user": {"username": "admin"},
    }

    save_session("http://127.0.0.1:8000/", session)

    assert get_session("http://127.0.0.1:8000") == session
    assert get_session("http://127.0.0.1:9000") is None
    path = tmp_path / "todolist" / "auth.json"
    if os.name != "nt":
        assert path.stat().st_mode & 0o777 == 0o600
    assert delete_session("http://127.0.0.1:8000")
    assert get_session("http://127.0.0.1:8000") is None
