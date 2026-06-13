from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def config_path() -> Path:
    if os.name == "nt":
        root = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return root / "todolist" / "auth.json"


def _read_store() -> dict[str, dict[str, Any]]:
    path = config_path()
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _write_store(value: dict[str, dict[str, Any]]) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    if os.name != "nt":
        path.chmod(0o600)


def normalize_api_url(api_url: str) -> str:
    return api_url.rstrip("/")


def get_session(api_url: str) -> dict[str, Any] | None:
    value = _read_store().get(normalize_api_url(api_url))
    return value if isinstance(value, dict) else None


def save_session(api_url: str, session: dict[str, Any]) -> None:
    store = _read_store()
    store[normalize_api_url(api_url)] = session
    _write_store(store)


def delete_session(api_url: str) -> bool:
    store = _read_store()
    removed = store.pop(normalize_api_url(api_url), None) is not None
    if removed:
        _write_store(store)
    return removed
