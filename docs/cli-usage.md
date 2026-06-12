# AI 清单 CLI 使用文档

## 安装

### 一键安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/user/todolist/master/scripts/install.sh | bash
```

脚本会自动：
1. 检查 Python 3.12+ 是否可用
2. 检查/安装 [uv](https://docs.astral.sh/uv/) 包管理器
3. 全局安装 `todo` 命令

安装完成后执行 `todo health` 验证。

卸载：

```bash
uv tool uninstall todolist-server
```

### 本地开发

```bash
cd server
uv sync
uv run --project server todo health
```

## 全局选项

```
todo [OPTIONS] COMMAND [ARGS]...
```

| 选项 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `--api-url` | `TODOLIST_API_URL` | `http://127.0.0.1:8000` | API 根地址 |
| `--timeout` | `TODOLIST_TIMEOUT` | `8` | 请求超时秒数 |
| `--output` | `TODOLIST_OUTPUT` | `json` | `json`、`jsonl` 或 `table` |
| `--pretty` | - | 关闭 | 缩进 JSON，仅影响 `json` |
| `--version` / `-v` | - | - | 输出 CLI 版本 |

配置优先级：命令参数 > 环境变量 > 默认值。

## 输出格式

### JSON（默认）

```json
{"ok": true, "data": {...}, "meta": {}}
```

### JSONL

每行一个 JSON 对象，用于列表命令：

```json
{"type": "item", "data": {...}}
{"type": "meta", "meta": {"count": 1, "next_cursor": null}}
```

### Table

Rich 表格格式，面向人工查看。

## 错误输出

错误 JSON 写入 stderr，stdout 为空：

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

### 退出码

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `2` | CLI 参数、输入或选择器错误 |
| `3` | 资源不存在 (HTTP 404) |
| `4` | 状态冲突 (HTTP 409) |
| `5` | 服务端校验失败 (HTTP 422) |
| `6` | HTTP 401/403 |
| `7` | 网络、超时或 HTTP 5xx |
| `8` | 其他 API 错误 |

---

## 命令参考

### health - 健康检查

```bash
todo health
```

---

### list - 清单管理

#### 列出清单

```bash
todo list ls
todo list ls --trash    # 列出已删除清单
```

#### 获取清单详情

```bash
todo list get <SELECTOR>
```

`<SELECTOR>` 可以是 UUID 或名称。

```bash
todo list get 8b8bc107-bb48-4667-aa4f-9613c6601d1a
todo list get "收集箱"
```

#### 创建清单

```bash
todo list create --name "工作"
todo list create --name "个人" --color "#FF6B6B"
```

#### 更新清单

```bash
todo list update "工作" --name "工作清单"
todo list update "工作" --color "#00B894"
todo list update "工作" --sort-order 100
```

#### 软删除清单

```bash
todo list delete "工作"
```

#### 恢复清单

```bash
todo list restore "工作"
```

#### 永久删除清单

```bash
todo list purge "工作" --yes
```

---

### task - 任务管理

#### 列出任务

```bash
todo task ls                           # 默认视图: inbox
todo task ls --view today              # 今天的任务
todo task ls --view all                # 所有任务
todo task ls --view completed          # 已完成任务
todo task ls --view trash              # 已删除任务
todo task ls --list "工作"              # 指定清单
todo task ls --query "周会"             # 搜索
todo task ls --sort priority-desc      # 按优先级排序
todo task ls --limit 50                # 限制数量
todo task ls --all                     # 自动拉取全部页面
```

视图选项：`inbox`、`today`、`all`、`completed`、`trash`

排序选项：`manual`、`created-asc`、`created-desc`、`due-asc`、`priority-desc`

`--view` 和 `--list` 互斥。`--all` 和 `--cursor` 互斥。

#### 获取任务详情

```bash
todo task get <TASK_ID>
```

#### 创建任务

```bash
# 基本创建
todo task create --title "准备周会材料"

# 完整创建
todo task create \
  --title "准备周会材料" \
  --list "工作" \
  --description "准备周三的周会演示文稿" \
  --due-at "2026-06-15T18:00:00+08:00" \
  --all-day \
  --priority high \
  --tag "重要" --tag "本周" \
  --item "收集数据" --item "制作幻灯片"
```

参数说明：

| 参数 | 说明 |
|---|---|
| `--title` | 任务标题 |
| `--list` | 清单 UUID 或名称（不提供则放入收集箱） |
| `--description` / `-d` | 任务描述 |
| `--due-at` | 截止时间，RFC3339 格式，必须带时区 |
| `--all-day` | 全天任务 |
| `--reminder-at` | 提醒时间，RFC3339 格式 |
| `--priority` / `-p` | `none`/`low`/`medium`/`high` 或 `0`/`1`/`3`/`5` |
| `--tag` / `-t` | 标签 UUID 或名称（可重复） |
| `--item` / `-i` | 初始检查项标题（可重复） |

#### JSON 输入

```bash
# 从文件
todo task create --input task.json

# 从 stdin
echo '{"title":"准备发布","priority":5}' | todo task create --input -

# 更新时使用
todo task update TASK_ID --input -
```

JSON 字段使用 API snake_case 名称。`list_id` 和 `tag_ids` 必须是 UUID。

#### 更新任务

```bash
# 更新标题和优先级
todo task update TASK_ID --title "新标题" --priority low

# 修改截止时间
todo task update TASK_ID --due-at "2026-06-20T10:00:00+08:00"

# 清除截止时间（同时清除提醒）
todo task update TASK_ID --clear-due

# 清除描述
todo task update TASK_ID --clear-description

# 设置为全天/定时
todo task update TASK_ID --all-day
todo task update TASK_ID --timed

# 替换标签（完整替换，非追加）
todo task update TASK_ID --tag "技术" --tag "本周"

# 清除所有标签
todo task update TASK_ID --clear-tags

# 移动到其他清单
todo task update TASK_ID --list "个人"
```

互斥参数：
- `--description` / `--clear-description`
- `--due-at` / `--clear-due`
- `--reminder-at` / `--clear-reminder`
- `--all-day` / `--timed`
- `--tag` / `--clear-tags`

#### 完成/重开任务

```bash
todo task complete TASK_ID
todo task reopen TASK_ID
```

#### 删除/恢复任务

```bash
todo task delete TASK_ID           # 软删除
todo task restore TASK_ID          # 恢复
todo task purge TASK_ID --yes      # 永久删除
```

---

### tag - 标签管理

#### 列出标签

```bash
todo tag ls
```

#### 获取标签详情

```bash
todo tag get "技术"
todo tag get TAG_UUID
```

#### 创建标签

```bash
todo tag create --name "技术"
todo tag create --name "紧急" --color "#FF0000"
```

#### 更新标签

```bash
todo tag update "技术" --name "技术债务"
todo tag update "技术" --color "#00B894"
```

#### 删除标签

```bash
todo tag delete "技术" --yes
```

标签删除是永久操作，会解除所有任务关联，必须提供 `--yes`。

---

### item - 检查项管理

#### 列出检查项

```bash
todo item ls TASK_ID
```

#### 获取检查项详情

```bash
todo item get TASK_ID ITEM_ID
```

#### 创建检查项

```bash
todo item create TASK_ID --title "子任务标题"
```

#### 更新检查项

```bash
todo item update TASK_ID ITEM_ID --title "新标题"
```

#### 完成/重开检查项

```bash
todo item complete TASK_ID ITEM_ID
todo item reopen TASK_ID ITEM_ID
```

#### 删除检查项

```bash
todo item delete TASK_ID ITEM_ID --yes
```

检查项删除不可恢复，必须提供 `--yes`。

#### 重排检查项

```bash
todo item reorder TASK_ID ITEM_ID1 ITEM_ID2 ITEM_ID3
```

必须提交该任务的全部检查项 UUID，顺序即目标顺序。

---

## 使用示例

### 完整工作流

```bash
# 创建清单
todo list create --name "工作" --color "#0984E3"

# 创建标签
todo tag create --name "紧急" --color "#FF0000"
todo tag create --name "本周" --color "#00B894"

# 创建任务
todo task create \
  --title "准备周会材料" \
  --list "工作" \
  --priority high \
  --due-at "2026-06-15T18:00:00+08:00" \
  --tag "紧急" --tag "本周" \
  --item "收集数据" --item "制作幻灯片"

# 查看今天的任务
todo task ls --view today --sort priority-desc

# 完成检查项
todo item complete TASK_ID ITEM_ID

# 完成任务
todo task complete TASK_ID

# 查看已完成任务
todo task ls --view completed
```

### 脚本使用

```bash
# 获取所有任务的 JSON
todo task ls --view all --all | jq '.data | length'

# 批量创建
for title in "任务1" "任务2" "任务3"; do
  todo task create --title "$title"
done

# 获取特定清单的任务数
todo task ls --list "工作" --all | jq '.meta.count'
```

### Agent 调用

```bash
# 使用 JSON 输出（默认）
todo task create --title "AI 创建的任务"

# 使用 JSONL 输出处理列表
todo task ls --view all --output jsonl | while IFS= read -r line; do
  echo "$line" | jq -r '.data.title // empty'
done
```

---

## 资源选择器

- 任务和检查项始终使用 UUID
- 清单和标签接受 UUID 或名称
- 名称按去除首尾空格后的大小写不敏感精确匹配
- 多个同名清单返回 `AMBIGUOUS_SELECTOR` 错误
- CLI 输出始终包含 UUID，后续操作应优先使用 UUID

## 时间格式

所有时间参数必须是带时区偏移的 RFC 3339 格式：

```
2026-06-12T18:00:00+08:00
2026-06-12T10:00:00Z
```

不接受无时区时间。
