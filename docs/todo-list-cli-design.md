# AI 清单 CLI 设计方案

**日期:** 2026-06-11  
**状态:** 待实施

## 1. 目标

为 AI 清单提供覆盖全部业务操作的命令行接口，供本地用户、脚本和 Agent 稳定调用。

核心要求：

- 所有业务写操作复用 FastAPI，不直接访问 PostgreSQL。
- 默认输出机器可解析的 JSON，不混入日志、颜色或进度信息。
- 命令非交互执行，参数错误快速失败。
- UUID 是资源的稳定标识；清单和标签名称仅作为便利选择器。
- 网络失败不会自动重试写操作，避免重复创建。
- 软删除与永久删除明确区分，永久操作必须传入 `--yes`。

## 2. 技术方案

CLI 放在现有 `server` Python 项目中，发布同一个安装包：

```toml
[project.scripts]
todo = "app.cli.main:app"
```

实现使用：

- `Typer >=0.15,<1`：命令树、参数校验和帮助信息。
- `httpx >=0.28,<1`：调用 AI 清单 HTTP API；从 dev 依赖移动到运行时依赖。
- `Pydantic`：复用或镜像请求、响应类型，避免手写字典协议。

安装后可直接执行 `todo`；仓库开发环境使用：

```bash
uv run --project server todo health
```

CLI 是薄客户端。服务端继续负责日期约束、系统清单保护、删除批次恢复、标签唯一性和排序规则。

## 3. 全局接口

```text
todo [GLOBAL_OPTIONS] <resource> <command> [COMMAND_OPTIONS]
```

全局参数：

| 参数 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `--api-url` | `TODOLIST_API_URL` | `http://127.0.0.1:8000` | API 根地址 |
| `--timeout` | `TODOLIST_TIMEOUT` | `8` | 请求超时秒数 |
| `--output` | `TODOLIST_OUTPUT` | `json` | `json`、`jsonl` 或 `table` |
| `--pretty` | - | 关闭 | 缩进 JSON，仅影响 `json` |
| `--version` | - | - | 输出 CLI 版本 |

配置优先级为：命令参数 > 环境变量 > 默认值。第一版不增加用户配置文件和鉴权；API 继续只监听回环地址。

### 3.1 标准输出

成功响应统一写入 stdout：

```json
{
  "ok": true,
  "data": {},
  "meta": {}
}
```

- 单资源命令的 `data` 是对象。
- 列表命令的 `data` 是数组。
- `204 No Content` 命令返回操作结果，例如：

```json
{
  "ok": true,
  "data": {
    "id": "UUID",
    "deleted": true,
    "permanent": false
  },
  "meta": {}
}
```

任务分页信息放入 `meta`：

```json
{
  "ok": true,
  "data": [],
  "meta": {
    "count": 0,
    "next_cursor": null
  }
}
```

`jsonl` 仅用于列表命令，每个资源和最终元数据各占一行：

```json
{"type":"item","data":{"id":"UUID"}}
{"type":"meta","meta":{"count":1,"next_cursor":null}}
```

`table` 面向人工查看，不承诺列格式稳定。

### 3.2 错误输出

错误 JSON 写入 stderr，stdout 保持为空：

```json
{
  "ok": false,
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "任务不存在",
    "fields": null,
    "http_status": 404
  }
}
```

API 返回的 `code`、`message` 和 `fields` 原样保留。CLI 自身错误使用以下代码：

- `CLI_USAGE_ERROR`：参数组合无效。
- `INVALID_SELECTOR`：资源选择器格式无效。
- `AMBIGUOUS_SELECTOR`：名称匹配到多个资源。
- `CONFIRMATION_REQUIRED`：永久操作缺少 `--yes`。
- `NETWORK_ERROR`：无法连接 API。
- `REQUEST_TIMEOUT`：请求超时。
- `INVALID_RESPONSE`：服务端响应不符合协议。

退出码：

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `2` | CLI 参数、输入或选择器错误 |
| `3` | 资源不存在，HTTP 404 |
| `4` | 状态冲突，HTTP 409 |
| `5` | 服务端校验失败，HTTP 422 |
| `6` | HTTP 401/403，预留给未来鉴权 |
| `7` | 网络、超时或 HTTP 5xx |
| `8` | 其他 API 错误 |

## 4. 资源选择规则

- 任务和检查项始终使用 UUID，不允许按标题选择。
- 清单和标签参数接受 UUID 或名称。
- 名称按去除首尾空格后的大小写不敏感精确匹配，不做模糊搜索。
- 没有匹配返回资源对应的 `*_NOT_FOUND`。
- 多个清单同名时返回 `AMBIGUOUS_SELECTOR`，列出候选 UUID。
- CLI 输出始终包含 UUID，Agent 后续操作应优先使用 UUID。

清单选择器会同时查询活动清单和回收站清单。标签名称在服务端已保证大小写不敏感唯一。

## 5. 命令矩阵

### 5.1 健康检查

```text
todo health
```

对应 `GET /health`。

### 5.2 清单

```text
todo list ls [--trash | --archived]
todo list get LIST
todo list create --name NAME [--color HEX] [--group GROUP]
todo list update LIST [--name NAME] [--color HEX] [--sort-order INTEGER] [--group GROUP | --clear-group]
todo list archive LIST
todo list unarchive LIST
todo list delete LIST
todo list restore LIST
todo list purge LIST --yes
```

行为：

- `ls` 默认列出活动清单，`--trash` 列出已删除清单，`--archived` 列出已归档清单（两者互斥）。
- `get` 在活动清单、归档清单和回收站中解析目标。
- `delete` 是软删除，同时按服务端批次规则删除所属任务。
- `purge` 对应永久删除；系统收集箱仍由服务端拒绝。
- `archive` 将清单从主视图与聚合任务视图中隐藏但保留任务，可用 `unarchive` 还原；系统收集箱不可归档。
- `--group` 接受分组 UUID 或名称，`--clear-group` 将清单移出分组；两者互斥。

### 5.2.1 清单分组

```text
todo group ls
todo group get GROUP
todo group create --name NAME
todo group update GROUP [--name NAME] [--sort-order INTEGER] [--collapsed | --expanded]
todo group delete GROUP --yes
```

行为：

- 分组是清单的容器，清单通过 `group_id` 归属，未归属时视为未分组。
- `delete` 永久删除分组，组内清单的 `group_id` 被置空但清单本身保留，因此要求 `--yes`。

### 5.3 任务

```text
todo task ls [--view VIEW | --list LIST] [--query TEXT]
             [--sort SORT] [--limit N] [--cursor CURSOR] [--all]
todo task get TASK_ID
todo task create --title TITLE [OPTIONS]
todo task update TASK_ID [OPTIONS]
todo task complete TASK_ID
todo task reopen TASK_ID
todo task delete TASK_ID
todo task restore TASK_ID
todo task purge TASK_ID --yes
```

`task ls`：

- 默认使用 `--view inbox`。
- `--view` 可选 `inbox`、`today`、`all`、`completed`、`trash`。
- `--sort` 可选 `manual`、`created-asc`、`created-desc`、`due-asc`、`priority-desc`。
- `--view` 和 `--list` 互斥。
- 默认 `--limit 100`，范围 `1..200`。
- `--all` 自动跟随游标拉取全部页面，不能和 `--cursor` 同时使用。

创建参数：

```text
--title TEXT
--list LIST
--description TEXT
--due-at RFC3339
--all-day
--reminder-at RFC3339
--priority none|low|medium|high|0|1|3|5
--tag TAG                  可重复
--item TEXT                可重复，创建初始检查项
```

未提供 `--list` 时由服务端放入系统收集箱。

更新参数：

```text
--title TEXT
--list LIST
--description TEXT | --clear-description
--due-at RFC3339 | --clear-due
--all-day | --timed
--reminder-at RFC3339 | --clear-reminder
--priority none|low|medium|high|0|1|3|5
--tag TAG                  可重复，替换完整标签集合
--clear-tags
--sort-order INTEGER
```

约束：

- 同一字段的设置参数和清除参数互斥。
- `update` 至少提供一个待修改字段，否则返回 `CLI_USAGE_ERROR` 且不发请求。
- `--tag` 表示完整替换，而不是追加，避免隐式读改写。
- `--clear-due` 同时清除提醒时间，与现有 API 行为一致。
- 时间必须是带时区偏移的 RFC 3339，例如 `2026-06-12T18:00:00+08:00`；拒绝无时区时间。

### 5.4 标签

```text
todo tag ls
todo tag get TAG
todo tag create --name NAME [--color HEX]
todo tag update TAG [--name NAME] [--color HEX]
todo tag delete TAG --yes
```

标签删除是永久操作，会解除所有任务关联，因此必须提供 `--yes`。

### 5.5 检查项

```text
todo item ls TASK_ID
todo item get TASK_ID ITEM_ID
todo item create TASK_ID --title TITLE
todo item update TASK_ID ITEM_ID [--title TITLE]
todo item complete TASK_ID ITEM_ID
todo item reopen TASK_ID ITEM_ID
todo item delete TASK_ID ITEM_ID --yes
todo item reorder TASK_ID ITEM_ID [ITEM_ID ...]
```

行为：

- `ls` 和 `get` 通过任务详情中的 `checklist_items` 返回数据。
- `complete` 和 `reopen` 分别更新 `is_completed=true/false`。
- `reorder` 必须提交该任务的全部检查项 UUID，顺序即目标顺序；缺失、重复或包含其他任务的检查项时由服务端拒绝。
- 检查项删除不可恢复，因此要求 `--yes`。

## 6. JSON 输入

`create` 和 `update` 支持 `--input FILE`，`--input -` 表示从 stdin 读取 JSON：

```bash
todo task create --input task.json
printf '%s' '{"title":"准备发布","priority":5}' | todo task create --input -
```

规则：

- 使用 `--input` 时，不能同时提供业务字段参数。
- 资源 ID 等定位参数仍保留为位置参数，例如：

```bash
todo task update TASK_ID --input -
```

- JSON 字段使用 API snake_case 名称。
- `list_id` 和 `tag_ids` 必须是 UUID；JSON 输入不解析名称选择器。
- CLI 在发送前完成基础 schema 校验，服务端仍执行最终业务校验。

## 7. 调用示例

创建任务并读取返回 UUID：

```bash
todo task create \
  --title "准备周会材料" \
  --list "工作" \
  --priority high \
  --due-at "2026-06-12T18:00:00+08:00"
```

查询今天的任务：

```bash
todo task ls --view today --sort priority-desc --all
```

完整替换任务标签：

```bash
todo task update TASK_ID --tag "技术" --tag "本周"
```

完成任务：

```bash
todo task complete TASK_ID
```

永久删除回收站任务：

```bash
todo task purge TASK_ID --yes
```

## 8. 实现结构

建议目录：

```text
server/app/cli/
  main.py          # Typer 根应用和资源命令注册
  client.py        # httpx 封装、错误映射、分页
  output.py        # JSON/JSONL/table 渲染
  selectors.py     # 清单和标签精确解析
  inputs.py        # 参数归一化、RFC3339 和 JSON 输入校验
```

实现原则：

- 命令函数只负责解析参数和构造请求。
- `ApiClient` 统一处理 URL、超时、响应解码和错误。
- 输出渲染集中管理，业务命令不得直接 `print`。
- stdout 只由输出渲染器写入；诊断信息统一写 stderr。
- 接管 Click/Typer 的参数异常并关闭 Rich traceback；除 `--help` 和 `--version` 外，失败时 stderr 必须是单个标准错误 JSON。
- GET 请求和写请求默认都不自动重试。未来若服务端支持幂等键，再为创建命令增加安全重试。
- `table` 输出可使用 Typer/Rich，但 `json` 和 `jsonl` 不经过 Rich。

## 9. API 适配

第一版不要求新增后端接口：

- `list get` 组合活动清单和回收站列表完成解析。
- `tag get` 从标签列表中解析。
- `item ls/get` 从任务详情读取。
- 其他命令直接映射现有 API。

CLI 实施时应补齐桌面端尚未使用、但服务端已经提供的标签更新和删除能力测试。

后续如果资源规模增大，可增加以下只读接口优化请求次数，但不改变 CLI 契约：

```text
GET /api/v1/lists/{list_id}
GET /api/v1/tags/{tag_id}
GET /api/v1/tasks/{task_id}/items/{item_id}
```

## 10. 测试与验收

### 10.1 单元测试

- 全局配置优先级和 URL 规范化。
- 优先级、排序别名和 RFC3339 转换。
- 名称选择器的成功、未找到和歧义场景。
- JSON、JSONL、table 输出不污染 stdout。
- HTTP 状态与退出码映射。
- `--input` 与字段参数互斥。
- 所有永久操作缺少 `--yes` 时不发请求。

### 10.2 命令集成测试

使用 Typer `CliRunner` 和可注入的 `httpx.MockTransport`，覆盖：

- 清单创建、更新、软删除、恢复和永久删除。
- 任务所有视图、搜索、排序、分页和 `--all`。
- 任务完整创建、部分更新、完成、重开、删除和恢复。
- 标签 CRUD。
- 检查项 CRUD、完成状态和重排。
- API 404、409、422、500、网络失败和超时。

### 10.3 端到端验收

在 Docker API 上执行一组真实命令，验证：

1. 创建清单和标签。
2. 创建包含日期、优先级、标签和检查项的任务。
3. 查询并更新任务。
4. 完成及重开任务和检查项。
5. 重排检查项。
6. 软删除及恢复任务、清单。
7. 永久删除任务、清单、标签和检查项。
8. 每条命令的 stdout 都可被标准 JSON 解析器直接读取。

## 11. 第一版不包含

- 直接数据库模式或离线写入。
- 交互式 TUI、确认提示或编辑器调用。
- 模糊匹配任务标题。
- 多命令事务和批处理 DSL。
- 自动启动 Docker/API 服务。
- 写操作自动重试或服务端幂等键。
- 远程 API 鉴权。

这些能力后续可以扩展，但不得破坏本方案定义的命令名、JSON envelope 和退出码。
