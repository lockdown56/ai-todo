# AI 清单

Windows 优先的单用户桌面 AI 清单。桌面端使用 Tauri 2、React、TypeScript、Tailwind CSS 4 和 shadcn/ui，服务端使用 FastAPI、SQLAlchemy 2 与 PostgreSQL。

## 前置要求

- Node.js 20 或更高版本及 npm
- Rust stable 与 Cargo
- Python 3.12 与 [uv](https://docs.astral.sh/uv/)
- Docker Desktop 或 Docker Engine + Compose
- Windows 打包需要 Microsoft WebView2 和 Visual Studio C++ Build Tools

## 启动

复制环境变量并启动 PostgreSQL 与 API：

```bash
cp .env.example .env
docker compose up --build -d
curl http://127.0.0.1:8000/health
```

默认仅允许本机访问 API。需要让其他设备连接时，在服务端 `.env` 中设置
`API_BIND_ADDRESS=0.0.0.0`，并仅向可信来源开放服务器的 TCP 8000 端口。

开发环境默认登录账号为 `admin` / `change-me`。部署前必须在 `.env` 中修改
`AUTH_PASSWORD` 和 `AUTH_JWT_SECRET`；生产环境的 JWT 密钥至少需要 32 个字符。
登录会话使用 access token + refresh token，`AUTH_TOKEN_TTL_SECONDS` 控制 access token
有效期，`AUTH_REFRESH_TOKEN_TTL_SECONDS` 控制 refresh token 有效期（默认 30 天）。

浏览器开发模式：

```bash
npm install --prefix desktop
npm --prefix desktop run dev
```

Tauri 开发模式：

```bash
npm --prefix desktop run tauri dev
```

停止服务：

```bash
docker compose down
```

## 后端本地开发

本机运行 API 时，将 `DATABASE_URL` 中的主机改为 `127.0.0.1`：

```bash
uv sync --project server
uv run --project server alembic upgrade head
uv run --project server uvicorn app.main:app --app-dir server --reload
```

迁移回退和重新升级：

```bash
uv run --project server alembic downgrade base
uv run --project server alembic upgrade head
```

## 测试与检查

```bash
uv run --project server pytest
uv run --project server ruff check .
uv run --project server ruff format --check .
npm --prefix desktop test -- --run
npm --prefix desktop run build
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

## 命令行客户端

安装并查看完整命令树：

```bash
curl -fsSL https://raw.githubusercontent.com/lockdown56/ai-todo/master/scripts/install.sh | bash
todo --help
todo auth login
todo auth login --api-key tdl_xxx
todo auth status
```

CLI 自动化或长期运行场景建议使用桌面端个人中心创建的 API Key。可通过
`todo auth login --api-key tdl_xxx` 按 API 地址保存，也可用 `TODOLIST_API_KEY` 或一次性
`--api-key` 传入。全局参数可放在资源命令前或最终子命令后，例如
`todo --output table task ls` 与 `todo task ls --output table` 等价。
交互登录保存的会话会使用 refresh token 自动续期，`todo auth logout` 会撤销该会话。

CLI 覆盖清单分组与归档、清单内已完成任务、周期任务、标签和检查项。完整参数、周期规则、
JSON 输入及输出契约见 [`docs/cli-usage.md`](docs/cli-usage.md)。

Windows 打包：

```bash
npm --prefix desktop run desktop:release
```

Android 打包：

```bash
npm --prefix desktop run android:release  # 已签名 APK
npm --prefix desktop run android:aab      # AAB
```

最终安装包统一输出到 `desktop/release/`，文件名包含应用版本、平台和架构。Tauri、
Cargo 与 Gradle 的原始构建目录仍保留用于增量构建。

安装包只包含桌面客户端，不包含 FastAPI、PostgreSQL 或 Docker。运行安装后的应用前，
目标 Windows 机器仍需启动 API，并确保 `http://127.0.0.1:8000/health` 可访问。
如果 API 部署在其他机器，可在桌面端“设置”中修改 API 基址。

## 常见问题

- `8000` 端口占用：停止占用该端口的进程，再重启 `api` 服务。
- PostgreSQL 未健康：运行 `docker compose logs postgres` 检查密码、端口和磁盘空间。
- Tauri 无法连接 API：先在运行桌面应用的同一台机器上访问 `http://127.0.0.1:8000/health`；再检查 API 服务、后端 CORS 配置和桌面端“设置”里的 API 基址。`.env` 中的 `VITE_API_BASE_URL` 是构建期默认值，不会启动或打包后端。
- WebView2 缺失：安装 Microsoft Edge WebView2 Runtime。
- WSLg 下无法切换中文输入法：Windows 输入法不会传入 Linux GUI。安装 `fcitx5`、`fcitx5-chinese-addons` 和 `fcitx5-frontend-gtk3`；应用会在 WSL 中自动配置并启动 Fcitx5。
- 需要清空数据库：执行 `docker compose down -v`，随后重新 `docker compose up --build -d`。该操作会永久删除全部业务数据。
