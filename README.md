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

Windows 打包：

```bash
npm --prefix desktop run tauri build
```

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
