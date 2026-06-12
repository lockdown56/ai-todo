---
name: todolist-cli
description: >
  AI 清单 CLI 操作技能。使用 `todo` 命令管理任务、清单、标签和检查项。
  当用户需要创建/查询/更新/删除任务、管理清单、标签、检查项、
  或任何待办事项相关操作时使用此技能。
  触发词：任务、清单、待办、todo、task、标签、tag、检查项、item。
---

# AI 清单 CLI

## 前置条件

确保 API 服务运行中：

```bash
todo health
```

如未安装 CLI，在项目目录执行：

```bash
bash scripts/install.sh
```

开发环境使用 `uv run --project server todo <command>`。

## 命令结构

```
todo [全局选项] <资源> <命令> [参数]
```

全局选项：`--api-url`、`--timeout`、`--output json|jsonl|table`、`--pretty`

## 核心命令速查

### 任务 (task)

```bash
todo task ls [--view inbox|today|all|completed|trash] [--list LIST] [-q 搜索] [--sort manual|created-asc|created-desc|due-asc|priority-desc] [--all]
todo task get TASK_ID
todo task create --title TITLE [--list LIST] [-d 描述] [--due-at RFC3339] [--all-day] [-p none|low|medium|high] [-t 标签...] [-i 检查项...]
todo task update TASK_ID [--title ...] [--list ...] [-d ... | --clear-description] [--due-at ... | --clear-due] [-p ...] [-t 标签... | --clear-tags]
todo task complete TASK_ID
todo task reopen TASK_ID
todo task delete TASK_ID
todo task restore TASK_ID
todo task purge TASK_ID --yes
```

### 清单 (list)

```bash
todo list ls [--trash]
todo list get SELECTOR          # UUID 或名称
todo list create --name NAME [--color HEX]
todo list update SELECTOR [--name ...] [--color ...] [--sort-order N]
todo list delete SELECTOR
todo list restore SELECTOR
todo list purge SELECTOR --yes
```

### 标签 (tag)

```bash
todo tag ls
todo tag get SELECTOR
todo tag create --name NAME [--color HEX]
todo tag update SELECTOR [--name ...] [--color ...]
todo tag delete SELECTOR --yes
```

### 检查项 (item)

```bash
todo item ls TASK_ID
todo item get TASK_ID ITEM_ID
todo item create TASK_ID --title TITLE
todo item update TASK_ID ITEM_ID [--title ...]
todo item complete TASK_ID ITEM_ID
todo item reopen TASK_ID ITEM_ID
todo item delete TASK_ID ITEM_ID --yes
todo item reorder TASK_ID ITEM_ID1 ITEM_ID2 ...
```

## 选择器规则

- **任务/检查项**：仅 UUID
- **清单/标签**：UUID 或名称（大小写不敏感精确匹配）
- 输出始终包含 UUID，后续操作优先使用 UUID

## JSON 输入

`create` 和 `update` 支持 `--input FILE` 或 `--input -`（stdin）：

```bash
echo '{"title":"任务","priority":5}' | todo task create --input -
todo task update TASK_ID --input data.json
```

JSON 使用 API snake_case 字段名。`list_id`/`tag_ids` 必须是 UUID。

## 输出格式

- `--output json`（默认）：标准 JSON envelope `{"ok":true,"data":...,"meta":...}`
- `--output jsonl`：每行一个 JSON 对象，适合流处理
- `--output table`：Rich 表格，人工查看
- `--pretty`：缩进 JSON

## 错误处理

错误写入 stderr，格式：

```json
{"ok":false,"error":{"code":"TASK_NOT_FOUND","message":"...","fields":null,"http_status":404}}
```

退出码：0=成功，2=参数错误，3=404，4=409，5=422，7=网络错误

## 时间格式

必须是带时区的 RFC3339：`2026-06-12T18:00:00+08:00`

## 项目结构

```
server/
  app/cli/           # CLI 源码
    main.py          # Typer 命令定义
    client.py        # httpx 客户端
    output.py        # 输出渲染
    selectors.py     # 名称选择器
    inputs.py        # 输入校验
  app/routers/       # API 路由
  app/schemas.py     # 数据模型
docs/cli-usage.md    # 完整使用文档
```

详细 API 映射见 [references/api-mapping.md](references/api-mapping.md)。
