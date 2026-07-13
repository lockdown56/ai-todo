from __future__ import annotations

import os
import sys
from typing import Any
from uuid import UUID

import typer
from typer.core import TyperGroup

from app.cli.auth_store import delete_session, get_session, normalize_api_url, save_session
from app.cli.client import ApiClient, cli_exit_error, parse_uuid
from app.cli.inputs import (
    load_json_input,
    parse_iso_date,
    parse_priority,
    parse_rfc3339,
    parse_tag_list,
)
from app.cli.output import render_output
from app.cli.selectors import resolve_group, resolve_list, resolve_tag

GLOBAL_VALUE_OPTIONS = {"--api-url", "--timeout", "--token", "--api-key", "--output"}
GLOBAL_FLAG_OPTIONS = {"--pretty", "--version", "-v"}


class GlobalOptionsGroup(TyperGroup):
    """Allow root options before or after nested commands."""

    def parse_args(self, ctx: typer.Context, args: list[str]) -> list[str]:
        global_args: list[str] = []
        command_args: list[str] = []
        index = 0
        while index < len(args):
            arg = args[index]
            if arg == "--":
                command_args.extend(args[index:])
                break
            option_name = arg.split("=", 1)[0]
            if option_name in GLOBAL_FLAG_OPTIONS:
                global_args.append(arg)
            elif option_name in GLOBAL_VALUE_OPTIONS:
                global_args.append(arg)
                if "=" not in arg and index + 1 < len(args):
                    index += 1
                    global_args.append(args[index])
            else:
                command_args.append(arg)
            index += 1
        return super().parse_args(ctx, global_args + command_args)


app = typer.Typer(
    cls=GlobalOptionsGroup,
    help="AI 清单 CLI",
    epilog=(
        "全局选项可放在资源命令前或最终子命令后，例如："
        "todo --output table task ls 或 todo task ls --output table。"
    ),
    no_args_is_help=True,
    options_metavar="[GLOBAL_OPTIONS]",
    subcommand_metavar="RESOURCE COMMAND [ARGS]...",
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


def _get_explicit_api_key(ctx: typer.Context) -> str | None:
    obj = ctx.obj or {}
    api_key = obj.get("api_key") or os.environ.get("TODOLIST_API_KEY")
    return api_key if isinstance(api_key, str) else None


def _get_token(ctx: typer.Context) -> str | None:
    obj = ctx.obj or {}
    explicit = obj.get("token") or os.environ.get("TODOLIST_TOKEN")
    if explicit:
        return explicit
    api_key = _get_explicit_api_key(ctx)
    if api_key:
        return api_key
    session = get_session(_get_api_url(ctx))
    token = (session.get("access_token") or session.get("api_key")) if session else None
    return token if isinstance(token, str) else None


def _make_client(ctx: typer.Context) -> ApiClient:
    api_url = _get_api_url(ctx)
    obj = ctx.obj or {}
    explicit_credential = bool(
        obj.get("token")
        or os.environ.get("TODOLIST_TOKEN")
        or obj.get("api_key")
        or os.environ.get("TODOLIST_API_KEY")
    )
    session = None if explicit_credential else get_session(api_url)

    def persist_refreshed_session(data: dict[str, Any]) -> None:
        save_session(api_url, _session_from_auth_response(data))

    return ApiClient(
        api_url,
        _get_timeout(ctx),
        _get_token(ctx),
        refresh_token=session.get("refresh_token") if session else None,
        on_refresh=persist_refreshed_session if session else None,
    )


def _session_from_auth_response(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "credential_type": "jwt",
        "access_token": data["access_token"],
        "expires_at": data["expires_at"],
        "refresh_token": data["refresh_token"],
        "refresh_expires_at": data["refresh_expires_at"],
        "user": data["user"],
    }


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
    api_key: str | None = typer.Option(
        None, envvar="TODOLIST_API_KEY", help="API Key (长期凭据，替代 JWT)"
    ),
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
    ctx.obj["api_key"] = api_key
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
    username: str | None = typer.Option(None, "--username", "-u", help="登录用户名"),
    password: str | None = typer.Option(
        None,
        "--password",
        help="登录密码（省略选项时将隐藏提示输入）",
    ),
) -> None:
    """使用用户名密码或 --api-key 登录并保存当前 API 地址的凭据"""
    api_url = _get_api_url(ctx)
    api_key = _get_explicit_api_key(ctx)
    if api_key:
        if username is not None or password is not None:
            cli_exit_error(
                "CLI_USAGE_ERROR",
                "--api-key 不能与 --username 或 --password 同时使用",
            )
        with ApiClient(
            api_url,
            _get_timeout(ctx),
            api_key,
            auth_hint=False,
        ) as client:
            user = client.get("/api/v1/auth/me")
        save_session(
            api_url,
            {
                "credential_type": "api_key",
                "api_key": api_key,
                "user": user,
                "expires_at": None,
            },
        )
        _success(
            ctx,
            {
                "api_url": api_url,
                "credential_type": "api_key",
                "user": user,
                "expires_at": None,
            },
        )

    if username is None:
        username = typer.prompt("用户名")
    if password is None:
        password = typer.prompt("密码", hide_input=True)
    with ApiClient(api_url, _get_timeout(ctx), auth_hint=False) as client:
        data: dict[str, Any] = client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password},
        )
    save_session(api_url, _session_from_auth_response(data))
    _success(
        ctx,
        {
            "api_url": api_url,
            "credential_type": "jwt",
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
    obj = ctx.obj or {}
    if obj.get("token") or os.environ.get("TODOLIST_TOKEN"):
        credential_type = "token"
    elif _get_explicit_api_key(ctx):
        credential_type = "api_key"
    elif session:
        credential_type = session.get("credential_type") or (
            "api_key" if session.get("api_key") else "jwt"
        )
    else:
        credential_type = "token"
    _success(
        ctx,
        {
            "api_url": _get_api_url(ctx),
            "credential_type": credential_type,
            "user": user,
            "expires_at": (
                session.get("expires_at") if session and credential_type == "jwt" else None
            ),
        },
    )


@auth_app.command("logout")
def auth_logout(ctx: typer.Context) -> None:
    """撤销并删除当前 API 地址保存的登录会话"""
    api_url = _get_api_url(ctx)
    session = get_session(api_url)
    refresh_token = session.get("refresh_token") if session else None
    if isinstance(refresh_token, str):
        with ApiClient(api_url, _get_timeout(ctx), auth_hint=False) as client:
            client.post("/api/v1/auth/logout", json={"refresh_token": refresh_token})
    removed = delete_session(api_url)
    _success(ctx, {"api_url": api_url, "logged_out": removed})


# ---------------------------------------------------------------------------
# API Key commands
# ---------------------------------------------------------------------------
api_key_app = typer.Typer(help="API Key 管理", no_args_is_help=True)
app.add_typer(api_key_app, name="api-key")


@api_key_app.command("create")
def api_key_create(
    ctx: typer.Context,
    name: str = typer.Option(..., "--name", help="API Key 名称标签"),
) -> None:
    """创建 API Key（明文仅返回一次，请妥善保管）"""
    with _make_client(ctx) as client:
        data = client.post("/api/v1/api-keys", json={"name": name})
        _success(ctx, data)


@api_key_app.command("ls")
def api_key_ls(ctx: typer.Context) -> None:
    """列出 API Key（不返回明文）"""
    with _make_client(ctx) as client:
        data = client.get("/api/v1/api-keys")
        _success(ctx, data)


@api_key_app.command("delete")
def api_key_delete(
    ctx: typer.Context,
    key_id: str = typer.Argument(..., help="API Key UUID"),
    yes: bool = typer.Option(False, "--yes", "-y", help="确认删除"),
) -> None:
    """吊销（删除）API Key"""
    if not yes:
        cli_exit_error("CONFIRMATION_REQUIRED", "吊销 API Key 需要 --yes 确认")
    kid = parse_uuid(key_id, "API Key ID")
    with _make_client(ctx) as client:
        client.delete(f"/api/v1/api-keys/{kid}")
        _success(ctx, {"id": str(kid), "deleted": True, "permanent": True})


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
VALID_LIST_STATUSES = ("open", "completed")
VALID_RECURRENCES = ("daily", "weekdays", "weekly", "monthly")
WEEKDAY_MAP = {
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}

_SORT_MAP: dict[str, str] = {
    "manual": "manual",
    "created-asc": "created_asc",
    "created-desc": "created_desc",
    "due-asc": "due_asc",
    "priority-desc": "priority_desc",
}


def _parse_recurrence(value: str) -> str:
    normalized = value.strip().lower()
    if normalized not in VALID_RECURRENCES:
        cli_exit_error(
            "CLI_USAGE_ERROR",
            f"无效的循环类型: {value}，可选: {', '.join(VALID_RECURRENCES)}",
        )
    return normalized


def _parse_weekday(value: str) -> int:
    normalized = value.strip().lower()
    if normalized not in WEEKDAY_MAP:
        cli_exit_error(
            "CLI_USAGE_ERROR",
            f"无效的星期: {value}，可选: {', '.join(WEEKDAY_MAP)}",
        )
    return WEEKDAY_MAP[normalized]


def _validate_recurrence_dates(start: str | None, end: str | None) -> tuple[str | None, str | None]:
    parsed_start = parse_iso_date(start, "循环开始日期") if start else None
    parsed_end = parse_iso_date(end, "循环结束日期") if end else None
    if parsed_start and parsed_end and parsed_end < parsed_start:
        cli_exit_error("CLI_USAGE_ERROR", "循环结束日期不得早于开始日期")
    return (
        parsed_start.isoformat() if parsed_start else None,
        parsed_end.isoformat() if parsed_end else None,
    )


def _add_recurrence_create_fields(
    body: dict[str, Any],
    *,
    recurrence: str | None,
    start: str | None,
    end: str | None,
    weekday: str | None,
    monthday: int | None,
    reminder_offset_minutes: int | None,
) -> None:
    recurrence_options_present = any(
        value is not None for value in (start, end, weekday, monthday, reminder_offset_minutes)
    )
    if recurrence is None:
        if recurrence_options_present:
            cli_exit_error("CLI_USAGE_ERROR", "设置循环参数前必须提供 --recurrence")
        return

    kind = _parse_recurrence(recurrence)
    if start is None:
        cli_exit_error("CLI_USAGE_ERROR", "循环任务必须提供 --recurrence-start")
    if kind == "weekly" and weekday is None:
        cli_exit_error("CLI_USAGE_ERROR", "每周循环必须提供 --recurrence-weekday")
    if kind == "monthly" and monthday is None:
        cli_exit_error("CLI_USAGE_ERROR", "每月循环必须提供 --recurrence-monthday")
    if kind != "weekly" and weekday is not None:
        cli_exit_error("CLI_USAGE_ERROR", "--recurrence-weekday 仅适用于 weekly")
    if kind != "monthly" and monthday is not None:
        cli_exit_error("CLI_USAGE_ERROR", "--recurrence-monthday 仅适用于 monthly")

    parsed_start, parsed_end = _validate_recurrence_dates(start, end)
    body["recurrence_type"] = kind
    body["recurrence_start_date"] = parsed_start
    if parsed_end is not None:
        body["recurrence_end_date"] = parsed_end
    if weekday is not None:
        body["recurrence_weekday"] = _parse_weekday(weekday)
    if monthday is not None:
        body["recurrence_monthday"] = monthday
    if reminder_offset_minutes is not None:
        body["reminder_offset_minutes"] = reminder_offset_minutes


def _add_recurrence_update_fields(
    body: dict[str, Any],
    *,
    recurrence: str | None,
    start: str | None,
    end: str | None,
    clear_end: bool,
    weekday: str | None,
    monthday: int | None,
    reminder_offset_minutes: int | None,
    clear_reminder_offset: bool,
) -> None:
    if recurrence is not None:
        kind = _parse_recurrence(recurrence)
        if start is None:
            cli_exit_error("CLI_USAGE_ERROR", "修改循环类型时必须同时提供 --recurrence-start")
        if kind == "weekly" and weekday is None:
            cli_exit_error("CLI_USAGE_ERROR", "每周循环必须提供 --recurrence-weekday")
        if kind == "monthly" and monthday is None:
            cli_exit_error("CLI_USAGE_ERROR", "每月循环必须提供 --recurrence-monthday")
        if kind != "weekly" and weekday is not None:
            cli_exit_error("CLI_USAGE_ERROR", "--recurrence-weekday 仅适用于 weekly")
        if kind != "monthly" and monthday is not None:
            cli_exit_error("CLI_USAGE_ERROR", "--recurrence-monthday 仅适用于 monthly")
        body["recurrence_type"] = kind

    parsed_start, parsed_end = _validate_recurrence_dates(start, end)
    if parsed_start is not None:
        body["recurrence_start_date"] = parsed_start
    if clear_end:
        body["recurrence_end_date"] = None
    elif parsed_end is not None:
        body["recurrence_end_date"] = parsed_end
    if weekday is not None:
        body["recurrence_weekday"] = _parse_weekday(weekday)
    if monthday is not None:
        body["recurrence_monthday"] = monthday
    if clear_reminder_offset:
        body["reminder_offset_minutes"] = None
    elif reminder_offset_minutes is not None:
        body["reminder_offset_minutes"] = reminder_offset_minutes


@task_app.command("ls")
def task_ls(
    ctx: typer.Context,
    view: str | None = typer.Option(None, "--view", help="视图: inbox/today/all/completed/trash"),
    list_selector: str | None = typer.Option(None, "--list", "-l", help="清单 UUID 或名称"),
    status: str = typer.Option("open", "--status", help="清单任务状态: open/completed"),
    query: str | None = typer.Option(None, "--query", "-q", help="搜索文本"),
    sort: str = typer.Option("manual", "--sort", help="排序方式"),
    limit: int = typer.Option(100, "--limit", min=1, max=200, help="每页数量"),
    cursor: str | None = typer.Option(None, "--cursor", help="分页游标"),
    all_pages: bool = typer.Option(False, "--all", "-a", help="自动拉取全部页面"),
) -> None:
    """列出任务"""
    if view and list_selector:
        cli_exit_error("CLI_USAGE_ERROR", "--view 和 --list 互斥")
    if status not in VALID_LIST_STATUSES:
        cli_exit_error(
            "CLI_USAGE_ERROR",
            f"无效的清单任务状态: {status}，可选: {', '.join(VALID_LIST_STATUSES)}",
        )
    if view and status != "open":
        cli_exit_error("CLI_USAGE_ERROR", "--status 仅可与 --list 一起使用")
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
            params["status"] = 0 if status == "open" else 2

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
    recurrence: str | None = typer.Option(
        None, "--recurrence", help="循环: daily/weekdays/weekly/monthly"
    ),
    recurrence_start: str | None = typer.Option(
        None, "--recurrence-start", help="循环开始日期 (YYYY-MM-DD)"
    ),
    recurrence_end: str | None = typer.Option(
        None, "--recurrence-end", help="循环结束日期 (YYYY-MM-DD)"
    ),
    recurrence_weekday: str | None = typer.Option(
        None, "--recurrence-weekday", help="每周执行日: mon/tue/wed/thu/fri/sat/sun"
    ),
    recurrence_monthday: int | None = typer.Option(
        None, "--recurrence-monthday", min=1, max=31, help="每月执行日 (1-31)"
    ),
    reminder_offset_minutes: int | None = typer.Option(
        None, "--reminder-offset-minutes", min=0, help="相对截止时间的提前提醒分钟数"
    ),
    input_file: str | None = typer.Option(
        None, "--input", "-I", help="JSON 输入文件或 - 表示 stdin"
    ),
) -> None:
    """创建任务"""
    business_options = (
        title,
        list_selector,
        description,
        due_at,
        all_day,
        reminder_at,
        priority,
        tags,
        items,
        recurrence,
        recurrence_start,
        recurrence_end,
        recurrence_weekday,
        recurrence_monthday,
        reminder_offset_minutes,
    )
    if input_file and any(value is not None and value is not False for value in business_options):
        cli_exit_error("CLI_USAGE_ERROR", "--input 不能与其他业务字段同时使用")

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
        _add_recurrence_create_fields(
            body,
            recurrence=recurrence,
            start=recurrence_start,
            end=recurrence_end,
            weekday=recurrence_weekday,
            monthday=recurrence_monthday,
            reminder_offset_minutes=reminder_offset_minutes,
        )

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
    recurrence: str | None = typer.Option(
        None, "--recurrence", help="循环: daily/weekdays/weekly/monthly"
    ),
    recurrence_start: str | None = typer.Option(
        None, "--recurrence-start", help="循环开始日期 (YYYY-MM-DD)"
    ),
    recurrence_end: str | None = typer.Option(
        None, "--recurrence-end", help="循环结束日期 (YYYY-MM-DD)"
    ),
    clear_recurrence_end: bool = typer.Option(
        False, "--clear-recurrence-end", help="清除循环结束日期"
    ),
    recurrence_weekday: str | None = typer.Option(
        None, "--recurrence-weekday", help="每周执行日: mon/tue/wed/thu/fri/sat/sun"
    ),
    recurrence_monthday: int | None = typer.Option(
        None, "--recurrence-monthday", min=1, max=31, help="每月执行日 (1-31)"
    ),
    reminder_offset_minutes: int | None = typer.Option(
        None, "--reminder-offset-minutes", min=0, help="相对截止时间的提前提醒分钟数"
    ),
    clear_reminder_offset: bool = typer.Option(
        False, "--clear-reminder-offset", help="清除循环提醒偏移"
    ),
    clear_recurrence: bool = typer.Option(False, "--clear-recurrence", help="清除循环规则"),
    input_file: str | None = typer.Option(None, "--input", "-I", help="JSON 输入文件或 -"),
) -> None:
    """更新任务"""
    tid = parse_uuid(task_id, "任务 ID")

    business_options = (
        title,
        list_selector,
        description,
        clear_description,
        due_at,
        clear_due,
        all_day,
        timed,
        reminder_at,
        clear_reminder,
        priority,
        tags,
        clear_tags,
        sort_order,
        recurrence,
        recurrence_start,
        recurrence_end,
        clear_recurrence_end,
        recurrence_weekday,
        recurrence_monthday,
        reminder_offset_minutes,
        clear_reminder_offset,
        clear_recurrence,
    )
    if input_file and any(value is not None and value is not False for value in business_options):
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
    if recurrence_end and clear_recurrence_end:
        cli_exit_error("CLI_USAGE_ERROR", "--recurrence-end 和 --clear-recurrence-end 互斥")
    if reminder_offset_minutes is not None and clear_reminder_offset:
        cli_exit_error(
            "CLI_USAGE_ERROR",
            "--reminder-offset-minutes 和 --clear-reminder-offset 互斥",
        )
    recurrence_fields_present = any(
        value is not None and value is not False
        for value in (
            recurrence,
            recurrence_start,
            recurrence_end,
            clear_recurrence_end,
            recurrence_weekday,
            recurrence_monthday,
            reminder_offset_minutes,
            clear_reminder_offset,
        )
    )
    if clear_recurrence and recurrence_fields_present:
        cli_exit_error("CLI_USAGE_ERROR", "--clear-recurrence 不能与其他循环参数同时使用")

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
        if clear_recurrence:
            body.update(
                {
                    "recurrence_type": None,
                    "recurrence_start_date": None,
                    "recurrence_end_date": None,
                    "recurrence_weekday": None,
                    "recurrence_monthday": None,
                    "reminder_offset_minutes": None,
                }
            )
        else:
            _add_recurrence_update_fields(
                body,
                recurrence=recurrence,
                start=recurrence_start,
                end=recurrence_end,
                clear_end=clear_recurrence_end,
                weekday=recurrence_weekday,
                monthday=recurrence_monthday,
                reminder_offset_minutes=reminder_offset_minutes,
                clear_reminder_offset=clear_reminder_offset,
            )

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


GLOBAL_OPTIONS_HELP = (
    "全局选项 --api-url、--timeout、--token、--api-key、--output 和 --pretty "
    "可放在资源命令前或本命令后。"
)


def _add_global_options_help() -> None:
    for group in app.registered_groups:
        child = group.typer_instance
        child.info.epilog = GLOBAL_OPTIONS_HELP
        for command in child.registered_commands:
            if command.epilog is None:
                command.epilog = GLOBAL_OPTIONS_HELP
    for command in app.registered_commands:
        if command.epilog is None:
            command.epilog = GLOBAL_OPTIONS_HELP


_add_global_options_help()
