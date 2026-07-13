# API 映射参考

CLI 命令与 FastAPI 端点的对应关系。

## 健康检查

| CLI | HTTP |
|---|---|
| `todo health` | `GET /health` |

## 清单

| CLI | HTTP | 备注 |
|---|---|---|
| `todo list ls` | `GET /api/v1/lists` | 活动清单 |
| `todo list ls --trash` | `GET /api/v1/lists/trash` | 回收站 |
| `todo list ls --archived` | `GET /api/v1/lists/archived` | 已归档 |
| `todo list get SELECTOR` | 组合活动、归档和回收站查询 | 按 ID 或名称匹配 |
| `todo list create` | `POST /api/v1/lists` | |
| `todo list update` | `PATCH /api/v1/lists/{id}` | 先通过选择器解析 ID |
| `todo list archive` | `POST /api/v1/lists/{id}/archive` | |
| `todo list unarchive` | `POST /api/v1/lists/{id}/unarchive` | |
| `todo list delete` | `DELETE /api/v1/lists/{id}` | 软删除 |
| `todo list restore` | `POST /api/v1/lists/{id}/restore` | |
| `todo list purge` | `DELETE /api/v1/lists/{id}/permanent` | 永久删除 |

## 任务

| CLI | HTTP | 备注 |
|---|---|---|
| `todo task ls` | `GET /api/v1/tasks?view=...` | view/list 互斥 |
| `todo task get` | `GET /api/v1/tasks/{id}` | |
| `todo task create` | `POST /api/v1/tasks` | |
| `todo task update` | `PATCH /api/v1/tasks/{id}` | |
| `todo task complete` | `POST /api/v1/tasks/{id}/complete` | |
| `todo task reopen` | `POST /api/v1/tasks/{id}/reopen` | |
| `todo task delete` | `DELETE /api/v1/tasks/{id}` | 软删除 |
| `todo task restore` | `POST /api/v1/tasks/{id}/restore` | |
| `todo task purge` | `DELETE /api/v1/tasks/{id}/permanent` | 永久删除 |

### 任务列表参数

| CLI 参数 | API 参数 | 说明 |
|---|---|---|
| `--view inbox` | `view=inbox` | 默认 |
| `--view today` | `view=today` | |
| `--view all` | `view=all` | |
| `--view completed` | `view=completed` | |
| `--view trash` | `view=trash` | |
| `--list SELECTOR` | `list_id=UUID` | 先解析选择器 |
| `--status open|completed` | `status=0|2` | 仅用于 `--list` |
| `--query TEXT` | `query=TEXT` | |
| `--sort manual` | `sort=manual` | 默认 |
| `--sort created-asc` | `sort=created_asc` | |
| `--sort priority-desc` | `sort=priority_desc` | |
| `--limit N` | `limit=N` | 默认 100 |
| `--cursor C` | `cursor=C` | |
| `--all` | 自动分页 | 循环直到 next_cursor 为空 |

### 优先级映射

| CLI 值 | API 值 |
|---|---|
| `none` / `0` | `0` |
| `low` / `1` | `1` |
| `medium` / `3` | `3` |
| `high` / `5` | `5` |

### 周期任务字段

| CLI 参数 | API 字段 |
|---|---|
| `--recurrence` | `recurrence_type` |
| `--recurrence-start` | `recurrence_start_date` |
| `--recurrence-end` | `recurrence_end_date` |
| `--recurrence-weekday mon..sun` | `recurrence_weekday=0..6` |
| `--recurrence-monthday` | `recurrence_monthday` |
| `--reminder-offset-minutes` | `reminder_offset_minutes` |

## 认证与 API Key

| CLI | HTTP |
|---|---|
| `todo auth login` | `POST /api/v1/auth/login` |
| `todo auth status` | `GET /api/v1/auth/me` |
| 登录会话自动续期 | `POST /api/v1/auth/refresh` |
| `todo auth logout` | `POST /api/v1/auth/logout` 后删除本地会话 |
| `todo api-key create` | `POST /api/v1/api-keys` |
| `todo api-key ls` | `GET /api/v1/api-keys` |
| `todo api-key delete` | `DELETE /api/v1/api-keys/{id}` |

刷新成功后 CLI 保存轮换后的 access token 和 refresh token。

## 清单分组

| CLI | HTTP |
|---|---|
| `todo group ls/get` | `GET /api/v1/list-groups` |
| `todo group create` | `POST /api/v1/list-groups` |
| `todo group update` | `PATCH /api/v1/list-groups/{id}` |
| `todo group delete` | `DELETE /api/v1/list-groups/{id}` |

## 标签

| CLI | HTTP | 备注 |
|---|---|---|
| `todo tag ls` | `GET /api/v1/tags` | |
| `todo tag get SELECTOR` | 组合 `GET /tags` + 按 ID/名称匹配 | |
| `todo tag create` | `POST /api/v1/tags` | |
| `todo tag update` | `PATCH /api/v1/tags/{id}` | |
| `todo tag delete` | `DELETE /api/v1/tags/{id}` | 永久删除，需 `--yes` |

## 检查项

| CLI | HTTP | 备注 |
|---|---|---|
| `todo item ls TASK_ID` | `GET /api/v1/tasks/{task_id}` → `.checklist_items` | 从任务详情提取 |
| `todo item get TASK_ID ITEM_ID` | 同上 + 按 item_id 匹配 | |
| `todo item create` | `POST /api/v1/tasks/{task_id}/items` | |
| `todo item update` | `PATCH /api/v1/tasks/{task_id}/items/{item_id}` | |
| `todo item complete` | `PATCH .../items/{id}` `{"is_completed": true}` | |
| `todo item reopen` | `PATCH .../items/{id}` `{"is_completed": false}` | |
| `todo item delete` | `DELETE /api/v1/tasks/{task_id}/items/{item_id}` | 永久删除 |
| `todo item reorder` | `POST /api/v1/tasks/{task_id}/items/reorder` | 提交全部 UUID |

## 错误码映射

| HTTP 状态 | CLI 退出码 | 含义 |
|---|---|---|
| 200/201/204 | 0 | 成功 |
| 404 | 3 | 资源不存在 |
| 409 | 4 | 状态冲突 |
| 422 | 5 | 校验失败 |
| 401/403 | 6 | 鉴权错误 |
| 5xx/网络 | 7 | 服务不可用 |
