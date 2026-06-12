from __future__ import annotations

import json
import sys
from typing import Any


def write_success(data: Any, *, meta: dict[str, Any] | None = None) -> None:
    envelope: dict[str, Any] = {"ok": True, "data": data}
    if meta is not None:
        envelope["meta"] = meta
    else:
        envelope["meta"] = {}
    _write_stdout(envelope)


def write_error(code: str, message: str, *, fields: Any = None, http_status: int = 0) -> None:
    envelope = {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "fields": fields,
            "http_status": http_status,
        },
    }
    _write_stderr(envelope)


def render_output(
    data: Any,
    *,
    meta: dict[str, Any] | None = None,
    fmt: str = "json",
    pretty: bool = False,
) -> None:
    if fmt == "json":
        _render_json(data, meta=meta, pretty=pretty)
    elif fmt == "jsonl":
        _render_jsonl(data, meta=meta)
    elif fmt == "table":
        _render_table(data, meta=meta)
    else:
        _render_json(data, meta=meta, pretty=pretty)


def _render_json(data: Any, *, meta: dict[str, Any] | None, pretty: bool) -> None:
    envelope: dict[str, Any] = {"ok": True, "data": data, "meta": meta or {}}
    indent = 2 if pretty else None
    text = json.dumps(envelope, ensure_ascii=False, default=_json_default, indent=indent)
    sys.stdout.write(text + "\n")


def _render_jsonl(data: Any, *, meta: dict[str, Any] | None) -> None:
    if isinstance(data, list):
        for item in data:
            _write_jsonl_line("item", item)
    else:
        _write_jsonl_line("item", data)
    meta_line = json.dumps(
        {"type": "meta", "meta": meta or {}},
        ensure_ascii=False,
        default=_json_default,
    )
    sys.stdout.write(meta_line + "\n")


def _write_jsonl_line(type_name: str, data: Any) -> None:
    line = json.dumps(
        {"type": type_name, "data": data},
        ensure_ascii=False,
        default=_json_default,
    )
    sys.stdout.write(line + "\n")


def _render_table(data: Any, *, meta: dict[str, Any] | None) -> None:
    try:
        from rich.console import Console
        from rich.table import Table
    except ImportError:
        _render_json(data, meta=meta, pretty=True)
        return

    console = Console(file=sys.stdout, stderr=False)
    if isinstance(data, list) and data and isinstance(data[0], dict):
        table = Table(show_header=True, header_style="bold")
        for key in data[0]:
            table.add_column(key)
        for row in data:
            table.add_row(*[str(row.get(k, "")) for k in data[0]])
        console.print(table)
    elif isinstance(data, dict):
        table = Table(show_header=True, header_style="bold")
        table.add_column("Field")
        table.add_column("Value")
        for key, val in data.items():
            table.add_row(str(key), str(val))
        console.print(table)
    else:
        _render_json(data, meta=meta, pretty=True)

    if meta:
        sys.stderr.write(f"meta: {json.dumps(meta, ensure_ascii=False)}\n")


def _write_stdout(envelope: dict[str, Any]) -> None:
    text = json.dumps(envelope, ensure_ascii=False, default=_json_default)
    sys.stdout.write(text + "\n")


def _write_stderr(envelope: dict[str, Any]) -> None:
    text = json.dumps(envelope, ensure_ascii=False, default=_json_default)
    sys.stderr.write(text + "\n")


def _json_default(obj: Any) -> Any:
    from datetime import datetime
    from uuid import UUID

    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")
