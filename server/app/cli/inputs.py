from __future__ import annotations

import json
import sys
from datetime import datetime
from typing import Any

from app.cli.client import cli_exit_error

PRIORITY_MAP: dict[str, int] = {
    "none": 0,
    "low": 1,
    "medium": 3,
    "high": 5,
    "0": 0,
    "1": 1,
    "3": 3,
    "5": 5,
}


def parse_priority(value: str) -> int:
    key = value.strip().lower()
    if key not in PRIORITY_MAP:
        cli_exit_error(
            "CLI_USAGE_ERROR",
            f"无效的优先级: {value}，可选: none/low/medium/high/0/1/3/5",
        )
    return PRIORITY_MAP[key]


def parse_rfc3339(value: str, field_name: str = "时间") -> datetime:
    try:
        dt = datetime.fromisoformat(value)
    except (ValueError, TypeError):
        cli_exit_error("CLI_USAGE_ERROR", f"{field_name} 不是有效的 RFC3339 格式: {value}")
        raise  # unreachable

    if dt.tzinfo is None:
        cli_exit_error(
            "CLI_USAGE_ERROR",
            f"{field_name} 必须带时区偏移，例如 2026-06-12T18:00:00+08:00",
        )
    return dt


def load_json_input(source: str | None) -> dict[str, Any] | None:
    if source is None:
        return None

    if source == "-":
        raw = sys.stdin.read()
    else:
        try:
            with open(source) as f:
                raw = f.read()
        except FileNotFoundError:
            cli_exit_error("CLI_USAGE_ERROR", f"文件不存在: {source}")
        except OSError as exc:
            cli_exit_error("CLI_USAGE_ERROR", f"无法读取文件: {exc}")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        cli_exit_error("CLI_USAGE_ERROR", f"JSON 解析失败: {exc}")

    if not isinstance(data, dict):
        cli_exit_error("CLI_USAGE_ERROR", "JSON 输入必须是对象")

    return data


def ensure_mutually_exclusive(
    set_fields: set[str],
    pairs: list[tuple[str, str]],
) -> None:
    for a, b in pairs:
        if a in set_fields and b in set_fields:
            cli_exit_error("CLI_USAGE_ERROR", f"参数 --{_kebab(a)} 和 --{_kebab(b)} 互斥")


def _kebab(name: str) -> str:
    return name.replace("_", "-")


def parse_tag_list(values: tuple[str, ...] | list[str] | None) -> list[str] | None:
    if values is None:
        return None
    return list(values)
