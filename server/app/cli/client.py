from __future__ import annotations

import sys
from typing import Any
from uuid import UUID

import httpx

from app.cli.output import write_error

EXIT_SUCCESS = 0
EXIT_USAGE = 2
EXIT_NOT_FOUND = 3
EXIT_CONFLICT = 4
EXIT_VALIDATION = 5
EXIT_AUTH = 6
EXIT_NETWORK = 7
EXIT_OTHER = 8

_HTTP_STATUS_TO_EXIT: dict[int, int] = {
    404: EXIT_NOT_FOUND,
    409: EXIT_CONFLICT,
    422: EXIT_VALIDATION,
    401: EXIT_AUTH,
    403: EXIT_AUTH,
}

CLI_ERROR_CODES = {
    "CLI_USAGE_ERROR",
    "INVALID_SELECTOR",
    "AMBIGUOUS_SELECTOR",
    "CONFIRMATION_REQUIRED",
    "NETWORK_ERROR",
    "REQUEST_TIMEOUT",
    "INVALID_RESPONSE",
}


class ApiClient:
    def __init__(self, base_url: str, timeout: float) -> None:
        self._base = base_url.rstrip("/")
        self._client = httpx.Client(base_url=self._base, timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> ApiClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        return self._request("GET", path, params=params)

    def post(self, path: str, *, json: dict[str, Any] | None = None) -> Any:
        return self._request("POST", path, json=json)

    def patch(self, path: str, *, json: dict[str, Any] | None = None) -> Any:
        return self._request("PATCH", path, json=json)

    def delete(self, path: str) -> Any:
        return self._request("DELETE", path)

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            resp = self._client.request(method, path, **kwargs)
        except httpx.TimeoutException:
            cli_exit_error("REQUEST_TIMEOUT", "请求超时", http_status=0)
        except httpx.HTTPError:
            cli_exit_error("NETWORK_ERROR", "无法连接 API", http_status=0)

        if resp.status_code == 204:
            return None

        try:
            body = resp.json()
        except Exception:
            cli_exit_error(
                "INVALID_RESPONSE",
                f"服务端响应不是有效 JSON (HTTP {resp.status_code})",
                http_status=resp.status_code,
            )

        if resp.status_code >= 400:
            error = body.get("error", {})
            code = error.get("code", "UNKNOWN")
            message = error.get("message", f"HTTP {resp.status_code}")
            fields = error.get("fields")
            exit_code = _HTTP_STATUS_TO_EXIT.get(resp.status_code, EXIT_OTHER)
            cli_exit_error(
                code,
                message,
                fields=fields,
                http_status=resp.status_code,
                exit_code=exit_code,
            )

        return body


def cli_exit_ok(data: Any, meta: dict[str, Any] | None = None) -> None:
    from app.cli.output import write_success

    write_success(data, meta=meta)
    sys.exit(EXIT_SUCCESS)


def cli_exit_error(
    code: str,
    message: str,
    *,
    fields: Any = None,
    http_status: int = 0,
    exit_code: int | None = None,
) -> None:
    if exit_code is None:
        exit_code = EXIT_USAGE if code in CLI_ERROR_CODES else EXIT_OTHER
    write_error(code, message, fields=fields, http_status=http_status)
    sys.exit(exit_code)


def parse_uuid(value: str, label: str = "ID") -> UUID:
    try:
        return UUID(value)
    except ValueError:
        cli_exit_error("INVALID_SELECTOR", f"{label} 不是有效的 UUID: {value}")
        raise  # unreachable
