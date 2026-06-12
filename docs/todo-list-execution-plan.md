# Tauri AI 清单详细执行计划

## 1. 目标与交付标准

本计划用于从空仓库实现一个 Windows 优先、自用、在线单用户的桌面 AI 清单。

最终交付应满足：

- Tauri 桌面端采用完整三栏布局，左栏可收起。
- FastAPI 提供任务、清单、标签、检查项和回收站 API。
- PostgreSQL 是唯一业务数据源，客户端不保存业务数据副本。
- Docker Compose 可一条命令启动 API 和 PostgreSQL。
- 支持收集箱、今天、全部、已完成、回收站和自定义清单。
- 支持任务新增、编辑、完成、重新打开、删除、恢复和永久删除。
- 支持截止时间、提醒时间、优先级、标签、描述及一级检查项。
- API 不可用时明确展示连接错误，不允许用户误以为修改已保存。
- 后端测试、前端测试、前端构建、Rust 检查全部通过。

首版不实现：

- 用户注册、登录和多用户隔离。
- 滴答清单账号或 OpenAPI 同步。
- 离线编辑和客户端数据库。
- 评论、附件、专注、习惯、倒计时、协作和日历视图。
- 重复任务、无限层级子任务和拖拽跨清单。
- 系统通知、后台常驻、自启动和托盘功能。

## 2. 工程结构

采用单仓库结构：

```text
.
├── desktop/                 # React + TypeScript + Vite + Tauri
│   ├── src/
│   ├── src-tauri/
│   ├── package.json
│   └── vite.config.ts
├── server/                  # FastAPI 服务
│   ├── app/
│   ├── migrations/
│   ├── tests/
│   └── pyproject.toml
├── docs/
├── docker-compose.yml
├── .env.example
└── README.md
```

约定：

- 前端依赖使用 `npm` 管理。
- Python 依赖与命令使用 `uv` 管理。
- 后端使用 Python 3.12、FastAPI、Pydantic v2、SQLAlchemy 2 和 Alembic。
- PostgreSQL 驱动使用 `asyncpg`，数据库访问采用 SQLAlchemy 异步会话。
- 前端使用 React、TanStack Query、React Router、Lucide React 和 CSS Modules。
- 不引入重量级 UI 组件库，避免界面风格偏离参考图。
- 前端测试使用 Vitest、Testing Library 和 MSW。
- 后端测试使用 Pytest、HTTPX 和独立测试数据库。

## 3. 固定业务规则

### 3.1 单用户规则

- 初始化数据库时创建一个固定默认用户。
- 默认用户 ID 由后端常量提供，API 暂不接受外部 `user_id`。
- 所有查询和写入都由服务层自动附加默认用户 ID。
- 数据库表保留 `user_id`，为后续增加登录功能留出迁移空间。

### 3.2 时间规则

- 数据库存储统一使用 UTC `timestamptz`。
- API 使用带时区的 ISO 8601 字符串。
- 服务端应用时区由 `APP_TIMEZONE` 配置，默认 `Asia/Shanghai`。
- “今天”视图按照 `APP_TIMEZONE` 计算当天起止时间。
- 全天任务仍保存 `due_at`，并通过 `is_all_day` 区分展示方式。
- `reminder_at` 只记录，不触发系统通知。
- 当同时存在 `reminder_at` 和 `due_at` 时，提醒时间不得晚于截止时间。

### 3.3 状态和优先级

- 任务状态：
  - `0`：待办。
  - `2`：已完成。
- 优先级：
  - `0`：无。
  - `1`：低。
  - `3`：中。
  - `5`：高。
- 完成任务时写入 `completed_at`。
- 重新打开任务时清空 `completed_at`。
- 任务进入回收站后，不出现在普通、今天、全部和已完成视图。

### 3.4 删除和恢复

- 删除任务为软删除，写入 `deleted_at` 和 `deletion_batch_id`。
- 删除自定义清单时，清单及其未删除任务使用同一个 `deletion_batch_id` 软删除。
- 恢复清单时，只恢复同一删除批次中的任务，避免恢复早已单独删除的任务。
- 系统收集箱不可删除。
- 永久删除清单前，永久删除其仍处于该清单下的软删除任务。
- 永久删除不可撤销，前端必须二次确认。

### 3.5 排序

- 清单和任务使用 `sort_order bigint`。
- 新记录默认取当前同级最大排序值加 `1024`。
- 首版只提供菜单排序，不提供拖拽排序：
  - 创建时间升序、降序。
  - 截止时间升序。
  - 优先级降序。
  - 手动排序字段升序。
- 检查项允许通过上移、下移按钮修改顺序。

## 4. 数据库设计

### 4.1 `users`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `email` | varchar(320) | 唯一，默认用户使用内部占位邮箱 |
| `display_name` | varchar(100) | 非空 |
| `created_at` | timestamptz | 非空 |
| `updated_at` | timestamptz | 非空 |

### 4.2 `task_lists`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `user_id` | UUID | 外键，非空 |
| `name` | varchar(100) | 非空 |
| `color` | varchar(7) | `#RRGGBB` |
| `system_type` | varchar(20) | `inbox` 或空 |
| `sort_order` | bigint | 非空 |
| `deleted_at` | timestamptz | 可空 |
| `deletion_batch_id` | UUID | 可空 |
| `created_at` | timestamptz | 非空 |
| `updated_at` | timestamptz | 非空 |

约束和索引：

- 同一用户只能有一个 `system_type = inbox` 的有效清单。
- 索引 `user_id, deleted_at, sort_order`。

### 4.3 `tasks`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `user_id` | UUID | 外键，非空 |
| `list_id` | UUID | 外键，非空 |
| `title` | varchar(500) | 非空 |
| `description` | text | 默认空字符串 |
| `due_at` | timestamptz | 可空 |
| `is_all_day` | boolean | 默认 `false` |
| `reminder_at` | timestamptz | 可空 |
| `priority` | smallint | 仅允许 `0/1/3/5` |
| `status` | smallint | 仅允许 `0/2` |
| `completed_at` | timestamptz | 可空 |
| `sort_order` | bigint | 非空 |
| `deleted_at` | timestamptz | 可空 |
| `deletion_batch_id` | UUID | 可空 |
| `created_at` | timestamptz | 非空 |
| `updated_at` | timestamptz | 非空 |

索引：

- `user_id, deleted_at, status`。
- `user_id, list_id, deleted_at, sort_order`。
- `user_id, due_at, deleted_at, status`。
- 标题搜索首版使用 PostgreSQL `ILIKE`，不引入全文搜索索引。

### 4.4 `checklist_items`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `task_id` | UUID | 外键，级联永久删除 |
| `title` | varchar(500) | 非空 |
| `is_completed` | boolean | 默认 `false` |
| `sort_order` | bigint | 非空 |
| `completed_at` | timestamptz | 可空 |
| `created_at` | timestamptz | 非空 |
| `updated_at` | timestamptz | 非空 |

### 4.5 `tags`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `user_id` | UUID | 外键，非空 |
| `name` | varchar(50) | 非空 |
| `color` | varchar(7) | `#RRGGBB` |
| `created_at` | timestamptz | 非空 |
| `updated_at` | timestamptz | 非空 |

约束：

- 标签名称保存前去除首尾空格。
- 标签名称按用户进行不区分大小写的唯一约束。

### 4.6 `task_tags`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `task_id` | UUID | 联合主键，外键 |
| `tag_id` | UUID | 联合主键，外键 |

### 4.7 初始化数据

首个 Alembic 迁移只创建表结构。

应用启动时执行幂等初始化：

1. 创建默认用户。
2. 为默认用户创建系统收集箱。
3. 不自动创建示例任务，保持真实空状态。

## 5. 后端 API 契约

统一规则：

- API 前缀为 `/api/v1`。
- 成功响应直接返回资源或分页结构。
- 错误响应格式：

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "任务不存在",
    "fields": null
  }
}
```

- 参数校验错误使用 HTTP `422`。
- 不存在使用 `404`。
- 状态冲突使用 `409`。
- 永久删除成功使用 `204`。

### 5.1 健康检查

`GET /health`

响应包含：

```json
{
  "status": "ok",
  "database": "ok"
}
```

数据库不可用时返回 `503`。

### 5.2 清单 API

- `GET /api/v1/lists`
  - 返回有效自定义清单和收集箱。
  - 包含每个清单的未完成任务数量。
- `POST /api/v1/lists`
  - 输入：`name`、`color`。
- `PATCH /api/v1/lists/{list_id}`
  - 可修改：`name`、`color`、`sort_order`。
- `DELETE /api/v1/lists/{list_id}`
  - 软删除清单及其中有效任务。
- `POST /api/v1/lists/{list_id}/restore`
  - 恢复清单及同批次任务。
- `DELETE /api/v1/lists/{list_id}/permanent`
  - 永久删除清单和其软删除任务。
- `GET /api/v1/lists/trash`
  - 返回回收站中的清单。

### 5.3 任务 API

- `GET /api/v1/tasks`
  - 查询参数：
    - `view=inbox|today|all|completed|trash`。
    - `list_id`，与 `view` 二选一。
    - `query`，标题和描述模糊匹配。
    - `sort=manual|created_asc|created_desc|due_asc|priority_desc`。
    - `limit`，默认 `100`，最大 `200`。
    - `cursor`，使用排序字段与 ID 组成的不透明游标。
- `GET /api/v1/tasks/{task_id}`
  - 返回任务详情、标签和检查项。
- `POST /api/v1/tasks`
  - 必填：`title`。
  - `list_id` 为空时自动写入收集箱。
  - 支持同时创建标签关联和检查项。
- `PATCH /api/v1/tasks/{task_id}`
  - 可修改任务所有可编辑字段。
  - 不通过此接口直接修改完成状态和删除状态。
- `DELETE /api/v1/tasks/{task_id}`
  - 软删除任务。
- `POST /api/v1/tasks/{task_id}/complete`
  - 幂等完成。
- `POST /api/v1/tasks/{task_id}/reopen`
  - 幂等重新打开。
- `POST /api/v1/tasks/{task_id}/restore`
  - 仅恢复所属清单有效的任务。
  - 所属清单已删除时返回 `409`，提示先恢复清单。
- `DELETE /api/v1/tasks/{task_id}/permanent`
  - 永久删除任务和检查项、标签关联。

任务列表响应：

```json
{
  "items": [],
  "next_cursor": null
}
```

### 5.4 检查项 API

- `POST /api/v1/tasks/{task_id}/items`
- `PATCH /api/v1/tasks/{task_id}/items/{item_id}`
- `DELETE /api/v1/tasks/{task_id}/items/{item_id}`
- `POST /api/v1/tasks/{task_id}/items/reorder`

重排请求一次提交完整的检查项 ID 顺序，服务端重新生成间隔排序值。

### 5.5 标签 API

- `GET /api/v1/tags`
- `POST /api/v1/tags`
- `PATCH /api/v1/tags/{tag_id}`
- `DELETE /api/v1/tags/{tag_id}`

删除标签只删除标签及关联关系，不删除任务。

任务标签通过 `PATCH /api/v1/tasks/{task_id}` 的 `tag_ids` 整体替换，避免额外的逐条关联接口。

## 6. 后端实现步骤

### 阶段 B1：服务骨架

1. 创建 `server/pyproject.toml` 和基础包结构。
2. 建立配置模块，读取数据库 URL、应用时区、CORS 地址和运行环境。
3. 建立异步数据库引擎和请求级会话。
4. 创建 FastAPI 应用工厂、统一异常响应和 `/health`。
5. 配置 Alembic 使用同一模型元数据。
6. 添加 Dockerfile 和开发启动命令。

完成标准：

- FastAPI 可启动。
- 数据库正常时 `/health` 返回 `200`。
- 数据库断开时 `/health` 返回 `503`。

### 阶段 B2：数据库模型和迁移

1. 实现所有 ORM 模型、枚举和约束。
2. 生成并审阅首个 Alembic 迁移。
3. 实现默认用户和收集箱的幂等初始化。
4. 为常用查询添加索引。
5. 添加数据库模型测试。

完成标准：

- 空数据库可以从零迁移到最新版本。
- 重复启动服务不会重复创建默认用户或收集箱。
- 数据库约束拒绝非法状态、优先级和重复标签。

### 阶段 B3：清单与任务服务

1. 实现 repository 层，只负责数据库查询。
2. 实现 service 层，承载状态转换、删除批次和业务校验。
3. 实现清单 CRUD、删除、恢复和永久删除。
4. 实现任务 CRUD、完成、重新打开、删除、恢复和永久删除。
5. 实现智能视图查询和排序、游标分页。
6. 所有资源查询必须限制为默认用户。

完成标准：

- 清单删除和恢复严格遵循删除批次规则。
- 所有任务视图结果互斥且符合状态规则。
- 重复调用完成、重新打开操作保持幂等。

### 阶段 B4：检查项和标签

1. 实现检查项新增、编辑、完成、删除和重排。
2. 实现标签 CRUD 和不区分大小写唯一校验。
3. 实现任务标签整体替换。
4. 任务详情查询一次返回检查项和标签，避免前端多次请求。

完成标准：

- 检查项状态切换正确维护 `completed_at`。
- 标签删除后任务仍然存在。
- 任务更新标签不会生成重复关联。

### 阶段 B5：后端测试

至少覆盖：

- 健康检查与数据库故障。
- 默认用户和收集箱初始化。
- 清单名称、颜色和系统清单限制。
- 任务标题、日期、提醒和优先级校验。
- 收集箱、今天、全部、已完成和回收站查询。
- 搜索与每一种排序。
- 完成和重新打开幂等性。
- 单任务软删除、恢复和永久删除。
- 清单批量软删除及按批次恢复。
- 检查项 CRUD 与重排。
- 标签唯一性、关联替换和删除。

后端完成门槛：

- 全部测试通过。
- Alembic 可在空测试库执行升级和降级。
- Ruff 检查和格式检查通过。

## 7. 前端与 Tauri 实现步骤

### 阶段 D1：桌面工程骨架

1. 创建 Vite React TypeScript 工程。
2. 初始化 Tauri 2，窗口标题设为 AI 清单。
3. 默认窗口尺寸设为 `1440 x 900`，最小尺寸为 `960 x 640`。
4. 配置开发 API 地址 `http://127.0.0.1:8000`。
5. API 地址通过 `VITE_API_BASE_URL` 注入，不硬编码到业务组件。
6. 配置 Tauri CSP 仅允许连接配置的 API 地址。
7. 添加 TanStack Query、React Router、图标库和测试工具。

完成标准：

- 浏览器开发模式和 Tauri 开发模式均可打开同一 React 应用。
- 应用可以调用 `/health` 并显示连接状态。

### 阶段 D2：API 客户端与类型

1. 定义与后端响应一致的 TypeScript 类型。
2. 建立统一 `apiClient`：
   - JSON 编解码。
   - 超时。
   - 错误结构转换。
   - `204` 响应处理。
3. 按资源建立 query key 工厂。
4. 建立 lists、tasks、tags、checklist items hooks。
5. MSW 提供前端测试用 API 模拟。

完成标准：

- 组件不直接调用 `fetch`。
- API 错误都转换为统一前端错误对象。
- 查询失效范围明确，不通过全局刷新掩盖状态问题。

### 阶段 D3：应用外壳和左栏

1. 创建三栏 CSS Grid：
   - 左栏展开宽度 `240px`，收起宽度 `56px`。
   - 中栏最小宽度 `420px`。
   - 右栏默认宽度 `420px`，无选中任务时显示空状态。
2. 左栏包含：
   - 收集箱。
   - 今天。
   - 全部。
   - 已完成。
   - 回收站。
   - 自定义清单。
3. 展开状态保存在 `localStorage`，这不是业务数据。
4. 清单支持新增、重命名、改色和删除。
5. API 不可用时显示全屏连接错误页和重试按钮。

完成标准：

- 左栏展开和收起不影响当前任务视图。
- 智能清单和自定义清单可正确切换路由。
- 删除系统收集箱的入口不可见。

### 阶段 D4：任务列表

1. 中栏顶部展示当前视图名称、任务数量、搜索和排序菜单。
2. 快速新增任务：
   - 回车提交。
   - 当前为自定义清单或收集箱时沿用当前清单。
   - 其他智能视图默认进入收集箱。
3. 任务行展示：
   - 完成复选框。
   - 标题。
   - 截止日期。
   - 优先级颜色。
   - 标签摘要。
4. 点击任务行在右栏打开详情。
5. 已完成视图允许重新打开。
6. 回收站视图使用恢复和永久删除操作，不展示完成按钮。
7. 搜索输入使用 `300ms` 防抖。
8. 列表滚动到底时加载下一页。

完成标准：

- 新增任务成功后自动选中并打开详情。
- 完成任务后从普通视图移除并进入已完成。
- 搜索和排序会重置分页游标。
- 空列表、加载中和请求失败都有独立状态。

### 阶段 D5：任务详情

1. 标题、描述采用受控输入。
2. 日期区域支持：
   - 无日期。
   - 全天日期。
   - 具体日期和时间。
   - 清除日期。
3. 提醒时间只有存在截止时间时可设置。
4. 优先级通过四档菜单选择。
5. 清单可切换，系统自动刷新两侧计数。
6. 标签支持选择已有标签和创建标签。
7. 检查项支持新增、编辑、完成、删除、上移和下移。
8. 普通字段使用 `500ms` 防抖自动保存。
9. 完成、删除、检查项操作立即提交，不进入防抖队列。
10. 自动保存状态显示为：
    - 已修改。
    - 保存中。
    - 已保存。
    - 保存失败。
11. 保存失败时保留用户输入，提供重试按钮，不伪造成功状态。
12. 切换任务前先立即提交当前待保存修改；提交失败则阻止切换并提示。

完成标准：

- 快速连续编辑只发送最后一次字段更新。
- 任务切换不会把上一任务的延迟请求写到下一任务。
- 日期和提醒校验错误在客户端可见，服务端仍执行最终校验。
- 删除任务后右栏关闭并更新当前列表。

### 阶段 D6：键盘和细节

固定快捷键：

- `Ctrl+N`：聚焦快速新增任务。
- `Ctrl+F`：聚焦任务搜索。
- `Ctrl+Enter`：完成或重新打开当前任务。
- `Escape`：关闭任务详情或取消当前弹层。

交互细节：

- 危险操作使用确认对话框。
- 焦点样式必须可见。
- 所有图标按钮提供中文 `aria-label`。
- 动画保持在 `120ms` 到 `180ms`，不使用大范围弹跳动画。
- 字体优先使用 Windows 系统字体。

## 8. 状态与数据流

### 8.1 服务端状态

由 TanStack Query 管理：

- 清单列表和数量。
- 当前任务列表分页。
- 当前任务详情。
- 标签列表。
- 健康检查。

### 8.2 本地界面状态

由 React 状态和路由管理：

- 当前视图或清单 ID。
- 当前选中任务 ID。
- 左栏是否收起。
- 搜索输入的未防抖值。
- 当前排序方式。
- 对话框和菜单状态。

### 8.3 更新策略

- 新增任务成功后插入当前列表并刷新清单计数。
- 完成、重新打开、删除和恢复使用乐观更新；失败时回滚。
- 详情自动保存不做跨资源乐观更新，成功后更新详情缓存并使相关列表失效。
- 标签和检查项更新成功后只刷新当前任务详情。
- 清单删除成功后切换到收集箱并刷新清单和任务查询。

## 9. Docker 与运行配置

`docker-compose.yml` 包含：

- `postgres`
  - 使用持久化 volume。
  - 暴露本机端口供开发调试。
  - 配置健康检查。
- `api`
  - 等待 PostgreSQL 健康后启动。
  - 启动前执行 `alembic upgrade head`。
  - 绑定 `127.0.0.1:8000`。
  - 挂载源代码只用于开发配置。

`.env.example` 至少包含：

```dotenv
POSTGRES_DB=todolist
POSTGRES_USER=todolist
POSTGRES_PASSWORD=change-me
DATABASE_URL=postgresql+asyncpg://todolist:change-me@postgres:5432/todolist
APP_TIMEZONE=Asia/Shanghai
CORS_ORIGINS=http://localhost:1420,tauri://localhost
VITE_API_BASE_URL=http://127.0.0.1:8000
```

不得提交真实 `.env`。

## 10. 测试与验收场景

### 10.1 前端自动化测试

- 左栏展开、收起和路由切换。
- 清单新增、编辑、删除确认和失败处理。
- 任务快速新增和自动选中。
- 任务完成、重新打开、删除和恢复。
- 搜索防抖和排序切换。
- 详情自动保存防抖。
- 自动保存失败、重试和切换阻止。
- 日期、提醒和优先级编辑。
- 标签创建与选择。
- 检查项 CRUD 和重排。
- API 离线错误页和恢复重试。
- 快捷键和基础无障碍标签。

### 10.2 集成验收

1. 启动空数据库和 API。
2. 首次打开桌面端，确认自动存在收集箱。
3. 创建自定义清单和多个任务。
4. 设置截止日期、提醒、优先级、标签和检查项。
5. 切换今天、全部和自定义清单，确认查询结果正确。
6. 完成任务，确认它进入已完成视图。
7. 删除任务，确认它进入回收站并可恢复。
8. 删除清单，确认清单和任务按同一批次进入回收站。
9. 恢复清单，确认同批次任务恢复。
10. 永久删除任务，确认无法再次查询。
11. 重启 API、PostgreSQL 和 Tauri，确认数据完整保留。
12. 停止 API，确认客户端进入连接错误状态且不接受伪保存。

### 10.3 最终质量门槛

必须全部通过：

```bash
uv run --project server pytest
uv run --project server ruff check .
uv run --project server ruff format --check .
npm --prefix desktop test -- --run
npm --prefix desktop run build
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

Windows 环境额外执行：

```bash
npm --prefix desktop run tauri build
```

## 11. 分阶段交付顺序

### 里程碑 1：可运行基础设施

- 完成 B1、B2、D1、D2。
- 可以启动数据库、API 和空白 Tauri 应用。
- 客户端能显示服务健康状态。

### 里程碑 2：清单和任务闭环

- 完成 B3、D3、D4。
- 可以创建清单和任务、切换视图、完成和删除任务。
- 暂不要求标签和检查项。

### 里程碑 3：完整任务详情

- 完成 B4、D5。
- 日期、提醒、优先级、标签、描述和检查项全部可编辑。
- 自动保存和失败重试可用。

### 里程碑 4：回收站和质量收尾

- 完成删除批次恢复、永久删除、D6 和全部测试。
- 完成 README、环境样例和 Windows 打包验证。

每个里程碑必须先通过该阶段测试再进入下一阶段，不将数据库迁移、错误处理或测试集中拖到最后补做。

## 12. README 必须说明

- Node.js、Rust、Python、uv、Docker 和 Windows WebView2 前置要求。
- 环境变量复制与修改方式。
- Docker Compose 启动和停止命令。
- Alembic 迁移命令。
- FastAPI 单独运行命令。
- React 浏览器开发命令。
- Tauri 开发和 Windows 打包命令。
- 测试和静态检查命令。
- 常见问题：
  - API 端口占用。
  - PostgreSQL 未健康。
  - Tauri 无法连接 API。
  - WebView2 缺失。
  - 数据库 volume 重建方式。
