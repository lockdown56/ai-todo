# Tauri Todo List 实现方案

## 总体方案

- 桌面端：Tauri 2 + React + TypeScript + Vite。
- 服务端：FastAPI + SQLAlchemy + PostgreSQL。
- 部署：Docker Compose 本机启动 API 与数据库。
- 首版单用户、无登录、无离线数据库，客户端通过 `localhost` API 读写数据。
- 不接入滴答 API，仅参考其任务模型和三栏交互。
- 明确排除评论、专注、习惯、倒计时等功能。

## 核心实现

### 界面

- 左栏可折叠，包含：收集箱、今天、全部、已完成、回收站、自定义清单。
- 中栏展示任务列表，支持新增、搜索、排序、完成和按清单筛选。
- 右栏编辑任务标题、描述、日期、提醒时间、优先级、标签和检查项。
- 详情自动保存；请求失败时回滚并显示错误。
- Windows 优先适配，提醒时间仅保存，首版不发送系统通知。

### 数据模型

- `lists`：名称、颜色、排序、系统类型、删除时间。
- `tasks`：清单、标题、描述、截止时间、全天标记、提醒时间、优先级、状态、完成时间、排序及软删除时间。
- `checklist_items`：一级检查项、完成状态和排序。
- `tags`、`task_tags`：标签及任务关联。
- 主键使用 UUID；时间以 PostgreSQL `timestamptz` 存储。
- 优先级沿用 `0/1/3/5`；任务状态使用待办和已完成。
- 收集箱为初始化时创建的系统清单；今天、全部等属于虚拟查询视图。
- 删除进入回收站；支持恢复和永久删除。

### API

- `GET /health`
- `GET/POST/PATCH/DELETE /api/v1/lists`
- `GET/POST/PATCH/DELETE /api/v1/tasks`
- `POST /api/v1/tasks/{id}/complete`
- `POST /api/v1/tasks/{id}/reopen`
- `POST /api/v1/tasks/{id}/restore`
- `DELETE /api/v1/tasks/{id}/permanent`
- 检查项和标签采用对应的嵌套 CRUD 接口。
- 任务查询支持 `view`、`list_id`、`query`、`status` 和排序参数。
- API 不启用身份认证，但内部保留默认用户字段，方便后续增加邮箱登录。

## 工程与交互

- 前端使用 TanStack Query 管理服务端状态，普通 React 状态管理当前视图和面板。
- 任务详情修改采用短延迟自动保存，新增任务提交后立即打开详情。
- 后端使用 Alembic 管理数据库迁移，Pydantic 定义请求和响应模型。
- Docker Compose 包含 `api` 与 `postgres`；Tauri 在宿主机运行并连接固定 API 地址。
- API 不可用时显示连接错误页，不提供伪离线编辑。
- 支持键盘操作：快速新增、搜索、完成任务、关闭详情。
- README 提供数据库启动、迁移、前端开发和 Windows 打包命令。

## 测试与验收

- 后端测试覆盖清单和任务 CRUD、智能清单过滤、完成/恢复、软删除、检查项和标签。
- 前端测试覆盖三栏切换、左栏折叠、任务编辑、搜索及请求失败回滚。
- 验证刷新应用后数据仍从 PostgreSQL 正确恢复。
- 验证今天视图只包含当天未删除任务，已完成和回收站互不混入。
- 验证删除清单时其任务进入回收站或按接口规则一并软删除。
- 执行前端类型检查与构建、FastAPI 测试、Rust `cargo check` 和 Tauri Windows 构建检查。

## 默认约定

- 首版仅支持一级检查项，不支持无限嵌套。
- 不实现重复任务、附件、协作、日历视图和拖拽跨清单。
- 默认语言为简体中文，主题为接近参考图的浅色界面。
- 后续增加登录时，由 FastAPI 提供邮箱密码与 JWT，并为现有数据绑定默认用户，无需改动客户端业务模型。
