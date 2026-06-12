from __future__ import annotations

from typing import Any
from uuid import UUID

from app.cli.client import ApiClient, cli_exit_error


def resolve_list(client: ApiClient, selector: str) -> UUID:
    try:
        return UUID(selector)
    except ValueError:
        pass

    name = selector.strip()
    if not name:
        cli_exit_error("INVALID_SELECTOR", "清单选择器不能为空")

    active: list[dict[str, Any]] = client.get("/api/v1/lists")
    trash: list[dict[str, Any]] = client.get("/api/v1/lists/trash")
    all_lists = active + trash

    matches = [item for item in all_lists if item["name"].strip().lower() == name.lower()]

    if not matches:
        cli_exit_error("LIST_NOT_FOUND", f"清单不存在: {selector}")
    if len(matches) > 1:
        ids = [item["id"] for item in matches]
        cli_exit_error(
            "AMBIGUOUS_SELECTOR",
            f"清单名称匹配到多个资源: {selector}",
            fields={"candidates": ids},
        )
    return UUID(matches[0]["id"])


def resolve_tag(client: ApiClient, selector: str) -> UUID:
    try:
        return UUID(selector)
    except ValueError:
        pass

    name = selector.strip()
    if not name:
        cli_exit_error("INVALID_SELECTOR", "标签选择器不能为空")

    tags: list[dict[str, Any]] = client.get("/api/v1/tags")
    matches = [tag for tag in tags if tag["name"].strip().lower() == name.lower()]

    if not matches:
        cli_exit_error("TAG_NOT_FOUND", f"标签不存在: {selector}")
    return UUID(matches[0]["id"])
