from __future__ import annotations

import os
import sys
from typing import Any
from uuid import UUID

import typer

from app.cli.auth_store import delete_session, get_session, normalize_api_url, save_session
from app.cli.client import ApiClient, cli_exit_error, parse_uuid
from app.cli.inputs import (
    load_json_input,
    parse_priority,
    parse_rfc3339,
    parse_tag_list,
)
from app.cli.output import render_output
from app.cli.selectors import resolve_group, resolve_list, resolve_tag

app = typer.Typer(
    help="AI 清单 CLI",
    no_args_is_help=True,
    context_settings={"allow_interspersed_args": False},
)

VERSION = "0.1.0"


def _get_env(key: str, default: str) -> str:
    return os.environ.get(key, default)


def _get_api_url(ctx: typer.Context) -> str:
    obj = ctx.obj or {}
    return normalize_api_url(
        obj.get("api_url") or _get_env("TODOLIST_API_URL", "http://127.0.0.1:8000")
    )


def _get_timeout(ctx: typer.Context) -> float:
    obj = ctx.obj or {}
    timeout = obj.get("timeout")
    if timeout is None:
        timeout = float(_get_env("TODOLIST_TIMEOUT", "8"))
    return timeout


def _get_token(ctx: typer.Context) -> str | None:
    obj = ctx.obj or {}
    explicit = obj.get("token") or os.environ.get("TODOLIST_TOKEN")
    if explicit:
        return explicit
    session = get_session(_get_api_url(ctx))
    token = session.get("access_token") if session else None
    return token if isinstance(token, str) else None


def _make_client(ctx: typer.Context) -> ApiClient:
    return ApiClient(_get_api_url(ctx), _get_timeout(ctx), _get_token(ctx))


def _get_output_fmt(ctx: typer.Context) -> str:
    obj = ctx.obj or {}
    return obj.get("output") or _get_env("TODOLIST_OUTPUT", "json")


def _get_pretty(ctx: typer.Context) -> bool:
    obj = ctx.obj or {}
    return obj.get("pretty", False)


def _success(ctx: typer.Context, data: Any, meta: dict[str, Any] | None = None) -> None:
    fmt = _get_output_fmt(ctx)
    render_output(data, meta=meta, fmt=fmt, pretty=_get_pretty(ctx))
    sys.exit(0)


@app.callback(invoke_without_command=True)
def root(
    ctx: typer.Context,
    api_url: str | None = typer.Option(None, envvar="TODOLIST_API_URL", help="API 根地址"),
    timeout: float | None = typer.Option(None, envvar="TODOLIST_TIMEOUT", help="请求超时秒数"),
    token: str | None = typer.Option(None, envvar="TODOLIST_TOKEN", help="Bearer 访问令牌"),
    output: str | None = typer.Option(
        None, envvar="TODOLIST_OUTPUT", help="输出格式: json/jsonl/table"
    ),
    pretty: bool = typer.Option(False, "--pretty", help="缩进 JSON"),
    version: bool = typer.Option(False, "--version", "-v", help="输出 CLI 版本"),
) -> None:
    ctx.ensure_object(dict)
    ctx.obj["api_url"] = api_url
    ctx.obj["timeout"] = timeout
    ctx.obj["token"] = token
    ctx.obj["output"] = output
    ctx.obj["pretty"] = pretty
    if version:
        typer.echo(f"todo {VERSION}")
        raise typer.Exit()
    if ctx.invoked_subcommand is None:
        typer.echo(ctx.get_help())
        raise typer.Exit()


@app.command("health")
def health_cmd(ctx: typer.Context) -> None:
    """检查 API 健康状态"""
    with _make_client(ctx) as client:
        data = client.get("/health")
        _success(ctx, data)


# ---------------------------------------------------------------------------
# Authentication commands
# ---------------------------------------------------------------------------
auth_app = typer.Typer(help="登录认证", no_args_is_help=True)
app.add_typer(auth_app, name="auth")


@auth_app.command("login")
def auth_login(
    ctx: typer.Context,
    username: str = typer.Option(..., "--username", "-u", prompt="用户名"),
    password: str = typer.Option(
        ...,
        "--password",
        prompt="密码",
        hide_input=True,
        help="登录密码；省略时隐藏输入",
    ),
) -> None:
    """登录并保存当前 API 地址的访问令牌"""
    api_url = _get_api_url(ctx)
    with ApiClient(api_url, _get_timeout(ctx), auth_hint=False) as client:
        data: dict[str, Any] = client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password},
        )
    save_session(
        api_url,
        {
            "access_token": data["access_token"],
            "expires_at": data["expires_at"],
            "user": data["user"],
        },
    )
    _success(
        ctx,
        {
            "api_url": api_url,
            "user": data["user"],
            "expires_at": data["expires_at"],
        },
    )


@auth_app.command("status")
def auth_status(ctx: typer.Context) -> None:
    """验证并显示当前登录状态"""
    token = _get_token(ctx)
    if not token:
        cli_exit_error(
            "AUTH_REQUIRED",
            "当前 API 地址尚未登录；请执行 todo auth login",
            http_status=401,
            exit_code=6,
        )
    with ApiClient(_get_api_url(ctx), _get_timeout(ctx), token) as client:
        user = client.get("/api/v1/auth/me")
    session = get_session(_get_api_url(ctx))
    _success(
        ctx,
        {
            "api_url": _get_api_url(ctx),
            "user": user,
            "expires_at": session.get("expires_at") if session else None,
        },
    )


@auth_app.command("logout")
def auth_logout(ctx: typer.Context) -> None:
    """删除当前 API 地址保存的访问令牌"""
    api_url = _get_api_url(ctx)
    removed = delete_session(api_url)
    _success(ctx, {"api_url": api_url, "logged_out": removed})


# ---------------------------------------------------------------------------
# List commands
# ---------------------------------------------------------------------------
list_app = typer.Typer(help="清单管理", no_args_is_help=True)
app.add_typer(list_app, name="list")


@list_app.command("ls")
def list_ls(
    ctx: typer.Context,
    trash: bool = typer.Option(False, "--trash", help="列出已删除清单"),
    archived: bool = typer.Option(False, "--archived", help="列出已归档清单"),
) -> None:
    """列出清单"""
    if trash and archived:
        cli_exit_error("CLI_USAGE_ERROR", "--trash 和 --archived 互斥")
    with _make_client(ctx) as client:
        if trash:
            path = "/api/v1/lists/trash"
        elif archived:
            path = "/api/v1/lists/archived"
        else:
            path = "/api/v1/lists"
        data = client.get(path)
        _success(ctx, data)


@list_app.command("get")
def list_get(
    ctx: typer.Context,
    list_selector: str = typer.Argument(..., help="清单 UUID 或名称"),
) -> None:
    """获取清单详情"""
    with _make_client(ctx) as client:
        list_id = resolve_list(client, list_selector)
        lists: list[dict[str, Any]] = client.get("/api/v1/lists")
        archived: list[dict[str, Any]] = client.get("/api/v1/lists/archived")
        trash: list[dict[str, Any]] = client.get("/api/v1/lists/trash")
        for item in lists + archived + trash:
            if item["id"] == str(list_id):
                _success(ctx, item)
        cli_exit_error("LIST_NOT_FOUND", f"清单不存在: {list_selector}")


@list_app.command("create")
def list_create(
    ctx: typer.Context,
    name: str = typer.Option(..., "--name", help="清单名称"),
    color: str | None = typer.Option(None, "--color", help="颜色 (HEX)"),
    group_selector: str | None = typer.Option(None, "--group", "-g", help="分组 UUID 或名称"),
) -> None:
    """创建清单"""
    body: dict[str, Any] = {"name": name}
    if color is not None:
        body["color"] = color
    with _make_client(ctx) as client:
        if group_selector is not None:
            body["group_id"] = str(resolve_group(client, group_selector))
        data = client.post("/api/v1/lists", json=body)
        _success(ctx, data)


@list_app.command("update")
def list_update(
    ctx: typer.Context,
    list_selector: str = typer.Argument(..., help="清单 UUID 或名称"),
    name: str | None = typer.Option(None, "--name", help="清单名称"),
    color: str | None = typer.Option(None, "--color", help="颜色 (HEX)"),
    sort_order: int | None = typer.Option(None, "--sort-order", help="排序序号"),
    group_selector: str | None = typer.Option(None, "--group", "-g", help="分组 UUID 或名称"),
    clear_group: bool = typer.Option(False, "--clear-group", help="从分组中移出"),
) -> None:
    """更新清单"""
    if group_selector is not None and clear_group:
        cli_exit_error("CLI_USAGE_ERROR", "--group 和 --clear-group 互斥")
    body: dict[str, Any] = {}
    if name is not None:
        body["name"] = name
    if color is not None:
        body["color"] = color
    if sort_order is not None:
        body["sort_order"] = sort_order
    if clear_group:
        body["group_id"] = None
    if not body and group_selector is None:
        cli_exit_error("CLI_USAGE_ERROR", "至少提供一个待修改字段")
    with _make_client(ctx) as client:
        if group_selector is not None:
            body["group_id"] = str(resolve_group(client, group_selector))
        list_id = resolve_list(client, list_selector)
        data = client.patch(f"/api/v1/lists/{list_id}", json=body)
        _success(ctx, data)


@list_app.command("archive")
def list_archive(
    ctx: typer.Context,
    list_selector: str = typer.Argument(..., help="清单 UUID 或名称"),
) -> None:
    """归档清单"""
    with _make_client(ctx) as client:
        list_id = resolve_list(client, list_selector)
        data = client.post(f"/api/v1/lists/{list_id}/archive")
        _success(ctx, data)


@list_app.command("unarchive")
def list_unarchive(
    ctx: typer.Context,
    list_selector: str = typer.Argument(..., help="清单 UUID 或名称"),
) -> None:
    """取消归档清单"""
    with _make_client(ctx) as client:
        list_id = resolve_list(client, list_selector)
        data = client.post(f"/api/v1/lists/{list_id}/unarchive")
        _success(ctx, data)


@list_app.command("delete")
def list_delete(
    ctx: typer.Context,
    list_selector: str = typer.Argument(..., help="清单 UUID 或名称"),
) -> None:
    """软删除清单"""
    with _make_client(ctx) as client:
        list_id = resolve_list(client, list_selector)
        client.delete(f"/api/v1/lists/{list_id}")
        _success(ctx, {"id": str(list_id), "deleted": True, "permanent": False})


@list_app.command("restore")
def list_restore(
    ctx: typer.Context,
    list_selector: str = typer.Argument(..., help="清单 UUID 或名称"),
) -> None:
    """恢复已删除清单"""
    with _make_client(ctx) as client:
        list_id = resolve_list(client, list_selector)
        data = client.post(f"/api/v1/lists/{list_id}/restore")
        _success(ctx, data)


@list_app.command("purge")
def list_purge(
    ctx: typer.Context,
    list_selector: str = typer.Argument(..., help="清单 UUID 或名称"),
    yes: bool = typer.Option(False, "--yes", "-y", help="确认永久删除"),
) -> None:
    """永久删除清单"""
    if not yes:
        cli_exit_error("CONFIRMATION_REQUIRED", "永久删除需要 --yes 确认")
    with _make_client(ctx) as client:
        list_id = resolve_list(client, list_selector)
        client.delete(f"/api/v1/lists/{list_id}/permanent")
        _success(ctx, {"id": str(list_id), "deleted": True, "permanent": True})


# ---------------------------------------------------------------------------
# List group commands
# ---------------------------------------------------------------------------
group_app = typer.Typer(help="清单分组管理", no_args_is_help=True)
app.add_typer(group_app, name="group")


@group_app.command("ls")
def group_ls(ctx: typer.Context) -> None:
    """列出分组"""
    with _make_client(ctx) as client:
        data = client.get("/api/v1/list-groups")
        _success(ctx, data)


@group_app.command("get")
def group_get(
    ctx: typer.Context,
    group_selector: str = typer.Argument(..., help="分组 UUID 或名称"),
) -> None:
    """获取分组详情"""
    with _make_client(ctx) as client:
        group_id = resolve_group(client, group_selector)
        groups: list[dict[str, Any]] = client.get("/api/v1/list-groups")
        for item in groups:
            if item["id"] == str(group_id):
                _success(ctx, item)
        cli_exit_error("GROUP_NOT_FOUND", f"分组不存在: {group_selector}")


@group_app.command("create")
def group_create(
    ctx: typer.Context,
    name: str = typer.Option(..., "--name", help="分组名称"),
) -> None:
    """创建分组"""
    with _make_client(ctx) as client:
        data = client.post("/api/v1/list-groups", json={"name": name})
        _success(ctx, data)


@group_app.command("update")
def group_update(
    ctx: typer.Context,
    group_selector: str = typer.Argument(..., help="分组 UUID 或名称"),
    name: str | None = typer.Option(None, "--name", help="分组名称"),
    sort_order: int | None = typer.Option(None, "--sort-order", help="排序序号"),
    collapsed: bool | None = typer.Option(None, "--collapsed/--expanded", help="折叠或展开分组"),
) -> None:
    """更新分组"""
    body: dict[str, Any] = {}
    if name is not None:
        body["name"] = name
    if sort_order is not None:
        body["sort_order"] = sort_order
    if collapsed is not None:
        body["is_collapsed"] = collapsed
    if not body:
        cli_exit_error("CLI_USAGE_ERROR", "至少提供一个待修改字段")
    with _make_client(ctx) as client:
        group_id = resolve_group(client, group_selector)
        data = client.patch(f"/api/v1/list-groups/{group_id}", json=body)
        _success(ctx, data)


@group_app.command("delete")
def group_delete(
    ctx: typer.Context,
    group_selector: str = typer.Argument(..., help="分组 UUID 或名称"),
    yes: bool = typer.Option(False, "--yes", "-y", help="确认删除"),
) -> None:
    """删除分组（清单将移出分组，不受影响）"""
    if not yes:
        cli_exit_error("CONFIRMATION_REQUIRED", "分组删除是永久操作，需要 --yes 确认")
    with _make_client(ctx) as client:
        group_id = resolve_group(client, group_selector)
        client.delete(f"/api/v1/list-groups/{group_id}")
        _success(ctx, {"id": str(group_id), "deleted": True, "permanent": True})


# ---------------------------------------------------------------------------
# Task commands
# ---------------------------------------------------------------------------
task_app = typer.Typer(help="任务管理", no_args_is_help=True)
app.add_typer(task_app, name="task")

VALID_VIEWS = ("inbox", "today", "all", "completed", "trash")
VALID_SORTS = ("manual", "created-asc", "created-desc", "due-asc", "priority-desc")

_SORT_MAP: dict[str, str] = {
    "manual": "manual",
    "created-asc": "created_asc",
    "created-desc": "created_desc",
    "due-asc": "due_asc",
    "priority-desc": "priority_desc",
}


@task_app.command("ls")
def task_ls(
    ctx: typer.Context,
    view: str | None = typer.Option(None, "--view", help="视图: inbox/today/all/completed/trash"),
    list_selector: str | None = typer.Option(None, "--list", "-l", help="清单 UUID 或名称"),
    query: str | None = typer.Option(None, "--query", "-q", help="搜索文本"),
    sort: str = typer.Option("manual", "--sort", help="排序方式"),
    limit: int = typer.Option(100, "--limit", min=1, max=200, help="每页数量"),
    cursor: str | None = typer.Option(None, "--cursor", help="分页游标"),
    all_pages: bool = typer.Option(False, "--all", "-a", help="自动拉取全部页面"),
) -> None:
    """列出任务"""
    if view and list_selector:
        cli_exit_error("CLI_USAGE_ERROR", "--view 和 --list 互斥")
    if not view and not list_selector:
        view = "inbox"
    if view and view not in VALID_VIEWS:
        cli_exit_error("CLI_USAGE_ERROR", f"无效的视图: {view}，可选: {', '.join(VALID_VIEWS)}")
    if sort not in VALID_SORTS:
        cli_exit_error("CLI_USAGE_ERROR", f"无效的排序: {sort}，可选: {', '.join(VALID_SORTS)}")
    if all_pages and cursor:
        cli_exit_error("CLI_USAGE_ERROR", "--all 和 --cursor 互斥")

    api_sort = _SORT_MAP[sort]
    params: dict[str, Any] = {"sort": api_sort, "limit": limit}
    if view:
        params["view"] = view
    if query:
        params["query"] = query
    if cursor:
        params["cursor"] = cursor

    with _make_client(ctx) as client:
        if list_selector:
            list_id = resolve_list(client, list_selector)
            params["list_id"] = str(list_id)

        if all_pages:
            all_items: list[dict[str, Any]] = []
            while True:
                resp: dict[str, Any] = client.get("/api/v1/tasks", params=params)
                items = resp.get("items", [])
                all_items.extend(items)
                next_cursor = resp.get("next_cursor")
                if not next_cursor:
                    break
                params["cursor"] = next_cursor
                if "limit" not in params:
                    pass
            _success(ctx, all_items, meta={"count": len(all_items), "next_cursor": None})
        else:
            resp = client.get("/api/v1/tasks", params=params)
            items = resp.get("items", [])
            next_cursor = resp.get("next_cursor")
            _success(ctx, items, meta={"count": len(items), "next_cursor": next_cursor})


@task_app.command("get")
def task_get(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
) -> None:
    """获取任务详情"""
    tid = parse_uuid(task_id, "任务 ID")
    with _make_client(ctx) as client:
        data = client.get(f"/api/v1/tasks/{tid}")
        _success(ctx, data)


@task_app.command("create")
def task_create(
    ctx: typer.Context,
    title: str | None = typer.Option(None, "--title", help="任务标题"),
    list_selector: str | None = typer.Option(None, "--list", "-l", help="清单 UUID 或名称"),
    description: str | None = typer.Option(None, "--description", "-d", help="任务描述"),
    due_at: str | None = typer.Option(None, "--due-at", help="截止时间 (RFC3339)"),
    all_day: bool = typer.Option(False, "--all-day", help="全天任务"),
    reminder_at: str | None = typer.Option(None, "--reminder-at", help="提醒时间 (RFC3339)"),
    priority: str | None = typer.Option(
        None, "--priority", "-p", help="优先级: none/low/medium/high"
    ),
    tags: list[str] | None = typer.Option(None, "--tag", "-t", help="标签 (可重复)"),
    items: list[str] | None = typer.Option(None, "--item", "-i", help="初始检查项 (可重复)"),
    input_file: str | None = typer.Option(
        None, "--input", "-I", help="JSON 输入文件或 - 表示 stdin"
    ),
) -> None:
    """创建任务"""
    if input_file and title:
        cli_exit_error("CLI_USAGE_ERROR", "--input 和 --title 互斥")

    json_data = load_json_input(input_file) if input_file else None

    if json_data:
        if "title" not in json_data:
            cli_exit_error("CLI_USAGE_ERROR", "JSON 输入必须包含 title 字段")
        body = json_data
    else:
        if not title:
            cli_exit_error("CLI_USAGE_ERROR", "必须提供 --title 或 --input")
        body: dict[str, Any] = {"title": title}
        if description is not None:
            body["description"] = description
        if due_at is not None:
            body["due_at"] = parse_rfc3339(due_at, "截止时间").isoformat()
        if all_day:
            body["is_all_day"] = True
        if reminder_at is not None:
            body["reminder_at"] = parse_rfc3339(reminder_at, "提醒时间").isoformat()
        if priority is not None:
            body["priority"] = parse_priority(priority)
        if tags is not None:
            tag_list = parse_tag_list(tags)
            if tag_list:
                body["tag_ids"] = tag_list
        if items is not None:
            body["checklist_items"] = [{"title": t} for t in items]

    with _make_client(ctx) as client:
        if "list_id" not in body and list_selector:
            body["list_id"] = str(resolve_list(client, list_selector))
        elif "list_id" not in body and not list_selector:
            pass
        data = client.post("/api/v1/tasks", json=body)
        _success(ctx, data)


@task_app.command("update")
def task_update(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
    title: str | None = typer.Option(None, "--title", help="任务标题"),
    list_selector: str | None = typer.Option(None, "--list", "-l", help="清单 UUID 或名称"),
    description: str | None = typer.Option(None, "--description", "-d", help="任务描述"),
    clear_description: bool = typer.Option(False, "--clear-description", help="清除描述"),
    due_at: str | None = typer.Option(None, "--due-at", help="截止时间 (RFC3339)"),
    clear_due: bool = typer.Option(False, "--clear-due", help="清除截止时间"),
    all_day: bool = typer.Option(False, "--all-day", help="设为全天任务"),
    timed: bool = typer.Option(False, "--timed", help="设为定时任务"),
    reminder_at: str | None = typer.Option(None, "--reminder-at", help="提醒时间 (RFC3339)"),
    clear_reminder: bool = typer.Option(False, "--clear-reminder", help="清除提醒时间"),
    priority: str | None = typer.Option(None, "--priority", "-p", help="优先级"),
    tags: list[str] | None = typer.Option(None, "--tag", "-t", help="标签 (可重复，完整替换)"),
    clear_tags: bool = typer.Option(False, "--clear-tags", help="清除所有标签"),
    sort_order: int | None = typer.Option(None, "--sort-order", help="排序序号"),
    input_file: str | None = typer.Option(None, "--input", "-I", help="JSON 输入文件或 -"),
) -> None:
    """更新任务"""
    tid = parse_uuid(task_id, "任务 ID")

    if input_file and (title or description or clear_description or due_at or clear_due):
        cli_exit_error("CLI_USAGE_ERROR", "--input 不能与其他业务字段同时使用")
    if description and clear_description:
        cli_exit_error("CLI_USAGE_ERROR", "--description 和 --clear-description 互斥")
    if due_at and clear_due:
        cli_exit_error("CLI_USAGE_ERROR", "--due-at 和 --clear-due 互斥")
    if reminder_at and clear_reminder:
        cli_exit_error("CLI_USAGE_ERROR", "--reminder-at 和 --clear-reminder 互斥")
    if all_day and timed:
        cli_exit_error("CLI_USAGE_ERROR", "--all-day 和 --timed 互斥")
    if tags is not None and clear_tags:
        cli_exit_error("CLI_USAGE_ERROR", "--tag 和 --clear-tags 互斥")

    json_data = load_json_input(input_file) if input_file else None

    if json_data:
        body = json_data
    else:
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if clear_description:
            body["description"] = ""
        elif description is not None:
            body["description"] = description
        if clear_due:
            body["due_at"] = None
        elif due_at is not None:
            body["due_at"] = parse_rfc3339(due_at, "截止时间").isoformat()
        if all_day:
            body["is_all_day"] = True
        elif timed:
            body["is_all_day"] = False
        if clear_reminder:
            body["reminder_at"] = None
        elif reminder_at is not None:
            body["reminder_at"] = parse_rfc3339(reminder_at, "提醒时间").isoformat()
        if priority is not None:
            body["priority"] = parse_priority(priority)
        if tags is not None:
            body["tag_ids"] = parse_tag_list(tags)
        elif clear_tags:
            body["tag_ids"] = []
        if sort_order is not None:
            body["sort_order"] = sort_order

        if not body and not list_selector:
            cli_exit_error("CLI_USAGE_ERROR", "至少提供一个待修改字段")

    with _make_client(ctx) as client:
        if list_selector:
            body["list_id"] = str(resolve_list(client, list_selector))
        data = client.patch(f"/api/v1/tasks/{tid}", json=body)
        _success(ctx, data)


@task_app.command("complete")
def task_complete(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
) -> None:
    """完成任务"""
    tid = parse_uuid(task_id, "任务 ID")
    with _make_client(ctx) as client:
        data = client.post(f"/api/v1/tasks/{tid}/complete")
        _success(ctx, data)


@task_app.command("reopen")
def task_reopen(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
) -> None:
    """重开任务"""
    tid = parse_uuid(task_id, "任务 ID")
    with _make_client(ctx) as client:
        data = client.post(f"/api/v1/tasks/{tid}/reopen")
        _success(ctx, data)


@task_app.command("delete")
def task_delete(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
) -> None:
    """软删除任务"""
    tid = parse_uuid(task_id, "任务 ID")
    with _make_client(ctx) as client:
        client.delete(f"/api/v1/tasks/{tid}")
        _success(ctx, {"id": str(tid), "deleted": True, "permanent": False})


@task_app.command("restore")
def task_restore(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
) -> None:
    """恢复已删除任务"""
    tid = parse_uuid(task_id, "任务 ID")
    with _make_client(ctx) as client:
        data = client.post(f"/api/v1/tasks/{tid}/restore")
        _success(ctx, data)


@task_app.command("purge")
def task_purge(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
    yes: bool = typer.Option(False, "--yes", "-y", help="确认永久删除"),
) -> None:
    """永久删除任务"""
    if not yes:
        cli_exit_error("CONFIRMATION_REQUIRED", "永久删除需要 --yes 确认")
    tid = parse_uuid(task_id, "任务 ID")
    with _make_client(ctx) as client:
        client.delete(f"/api/v1/tasks/{tid}/permanent")
        _success(ctx, {"id": str(tid), "deleted": True, "permanent": True})


# ---------------------------------------------------------------------------
# Tag commands
# ---------------------------------------------------------------------------
tag_app = typer.Typer(help="标签管理", no_args_is_help=True)
app.add_typer(tag_app, name="tag")


@tag_app.command("ls")
def tag_ls(ctx: typer.Context) -> None:
    """列出标签"""
    with _make_client(ctx) as client:
        data = client.get("/api/v1/tags")
        _success(ctx, data)


@tag_app.command("get")
def tag_get(
    ctx: typer.Context,
    tag_selector: str = typer.Argument(..., help="标签 UUID 或名称"),
) -> None:
    """获取标签详情"""
    with _make_client(ctx) as client:
        tag_id = resolve_tag(client, tag_selector)
        tags: list[dict[str, Any]] = client.get("/api/v1/tags")
        for tag in tags:
            if tag["id"] == str(tag_id):
                _success(ctx, tag)
        cli_exit_error("TAG_NOT_FOUND", f"标签不存在: {tag_selector}")


@tag_app.command("create")
def tag_create(
    ctx: typer.Context,
    name: str = typer.Option(..., "--name", help="标签名称"),
    color: str | None = typer.Option(None, "--color", help="颜色 (HEX)"),
) -> None:
    """创建标签"""
    body: dict[str, Any] = {"name": name}
    if color is not None:
        body["color"] = color
    with _make_client(ctx) as client:
        data = client.post("/api/v1/tags", json=body)
        _success(ctx, data)


@tag_app.command("update")
def tag_update(
    ctx: typer.Context,
    tag_selector: str = typer.Argument(..., help="标签 UUID 或名称"),
    name: str | None = typer.Option(None, "--name", help="标签名称"),
    color: str | None = typer.Option(None, "--color", help="颜色 (HEX)"),
) -> None:
    """更新标签"""
    body: dict[str, Any] = {}
    if name is not None:
        body["name"] = name
    if color is not None:
        body["color"] = color
    if not body:
        cli_exit_error("CLI_USAGE_ERROR", "至少提供一个待修改字段")
    with _make_client(ctx) as client:
        tag_id = resolve_tag(client, tag_selector)
        data = client.patch(f"/api/v1/tags/{tag_id}", json=body)
        _success(ctx, data)


@tag_app.command("delete")
def tag_delete(
    ctx: typer.Context,
    tag_selector: str = typer.Argument(..., help="标签 UUID 或名称"),
    yes: bool = typer.Option(False, "--yes", "-y", help="确认永久删除"),
) -> None:
    """永久删除标签"""
    if not yes:
        cli_exit_error("CONFIRMATION_REQUIRED", "标签删除是永久操作，需要 --yes 确认")
    with _make_client(ctx) as client:
        tag_id = resolve_tag(client, tag_selector)
        client.delete(f"/api/v1/tags/{tag_id}")
        _success(ctx, {"id": str(tag_id), "deleted": True, "permanent": True})


# ---------------------------------------------------------------------------
# Item (checklist) commands
# ---------------------------------------------------------------------------
item_app = typer.Typer(help="检查项管理", no_args_is_help=True)
app.add_typer(item_app, name="item")


def _require_task_items(
    client: ApiClient, task_id: UUID
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    task = client.get(f"/api/v1/tasks/{task_id}")
    items = task.get("checklist_items", [])
    return task, items


@item_app.command("ls")
def item_ls(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
) -> None:
    """列出检查项"""
    tid = parse_uuid(task_id, "任务 ID")
    with _make_client(ctx) as client:
        _, items = _require_task_items(client, tid)
        _success(ctx, items)


@item_app.command("get")
def item_get(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
    item_id: str = typer.Argument(..., help="检查项 UUID"),
) -> None:
    """获取检查项详情"""
    tid = parse_uuid(task_id, "任务 ID")
    iid = parse_uuid(item_id, "检查项 ID")
    with _make_client(ctx) as client:
        _, items = _require_task_items(client, tid)
        for item in items:
            if item["id"] == str(iid):
                _success(ctx, item)
        cli_exit_error("CHECKLIST_ITEM_NOT_FOUND", f"检查项不存在: {item_id}")


@item_app.command("create")
def item_create(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
    title: str = typer.Option(..., "--title", help="检查项标题"),
) -> None:
    """创建检查项"""
    tid = parse_uuid(task_id, "任务 ID")
    with _make_client(ctx) as client:
        data = client.post(f"/api/v1/tasks/{tid}/items", json={"title": title})
        _success(ctx, data)


@item_app.command("update")
def item_update(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
    item_id: str = typer.Argument(..., help="检查项 UUID"),
    title: str | None = typer.Option(None, "--title", help="检查项标题"),
) -> None:
    """更新检查项"""
    tid = parse_uuid(task_id, "任务 ID")
    iid = parse_uuid(item_id, "检查项 ID")
    body: dict[str, Any] = {}
    if title is not None:
        body["title"] = title
    if not body:
        cli_exit_error("CLI_USAGE_ERROR", "至少提供一个待修改字段")
    with _make_client(ctx) as client:
        data = client.patch(f"/api/v1/tasks/{tid}/items/{iid}", json=body)
        _success(ctx, data)


@item_app.command("complete")
def item_complete(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
    item_id: str = typer.Argument(..., help="检查项 UUID"),
) -> None:
    """完成检查项"""
    tid = parse_uuid(task_id, "任务 ID")
    iid = parse_uuid(item_id, "检查项 ID")
    with _make_client(ctx) as client:
        data = client.patch(f"/api/v1/tasks/{tid}/items/{iid}", json={"is_completed": True})
        _success(ctx, data)


@item_app.command("reopen")
def item_reopen(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
    item_id: str = typer.Argument(..., help="检查项 UUID"),
) -> None:
    """重开检查项"""
    tid = parse_uuid(task_id, "任务 ID")
    iid = parse_uuid(item_id, "检查项 ID")
    with _make_client(ctx) as client:
        data = client.patch(f"/api/v1/tasks/{tid}/items/{iid}", json={"is_completed": False})
        _success(ctx, data)


@item_app.command("delete")
def item_delete(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
    item_id: str = typer.Argument(..., help="检查项 UUID"),
    yes: bool = typer.Option(False, "--yes", "-y", help="确认删除"),
) -> None:
    """永久删除检查项"""
    if not yes:
        cli_exit_error("CONFIRMATION_REQUIRED", "检查项删除是永久操作，需要 --yes 确认")
    tid = parse_uuid(task_id, "任务 ID")
    iid = parse_uuid(item_id, "检查项 ID")
    with _make_client(ctx) as client:
        client.delete(f"/api/v1/tasks/{tid}/items/{iid}")
        _success(ctx, {"id": str(iid), "deleted": True, "permanent": True})


@item_app.command("reorder")
def item_reorder(
    ctx: typer.Context,
    task_id: str = typer.Argument(..., help="任务 UUID"),
    item_ids: list[str] = typer.Argument(..., help="检查项 UUID 列表 (按目标顺序)"),
) -> None:
    """重排检查项顺序"""
    tid = parse_uuid(task_id, "任务 ID")
    parsed_ids = [parse_uuid(iid, "检查项 ID") for iid in item_ids]
    with _make_client(ctx) as client:
        data = client.post(
            f"/api/v1/tasks/{tid}/items/reorder",
            json={"item_ids": [str(i) for i in parsed_ids]},
        )
        _success(ctx, data)
