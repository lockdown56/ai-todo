# AI 清单 CLI 使用文档

`todo` 是 AI 清单 HTTP API 的命令行客户端，覆盖认证、API Key、清单与分组、任务、标签和检查项。

## 安装与开发

一键安装：

```bash
curl -fsSL https://raw.githubusercontent.com/lockdown56/ai-todo/master/scripts/install.sh | bash
todo health
```

卸载使用 `uv tool uninstall todolist-server`。仓库开发环境可直接运行：

```bash
uv sync --project server
uv run --project server todo --help
```

## 命令结构与全局选项

```text
todo [GLOBAL_OPTIONS] RESOURCE COMMAND [ARGS]...
```

全局选项既可以放在资源命令前，也可以放在最终子命令后：

```bash
todo --output table task ls --view today
todo task ls --view today --output table
```

| 选项 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `--api-url` | `TODOLIST_API_URL` | `http://127.0.0.1:8000` | API 根地址 |
| `--timeout` | `TODOLIST_TIMEOUT` | `8` | 请求超时秒数 |
| `--token` | `TODOLIST_TOKEN` | 已保存令牌 | 临时 Bearer JWT，优先于 API Key |
| `--api-key` | `TODOLIST_API_KEY` | - | 长期 Bearer 凭据 |
| `--output` | `TODOLIST_OUTPUT` | `json` | `json`、`jsonl` 或 `table` |
| `--pretty` | - | 关闭 | 缩进 JSON |
| `--version` / `-v` | - | - | 输出 CLI 版本 |

优先级为命令参数、环境变量、已保存会话、默认值。运行任意层级的 `--help` 可查看该层命令和参数。

## 认证与 API Key

```bash
todo auth login                         # 交互式读取用户名和隐藏密码
todo auth login -u admin --password SECRET
todo auth status
todo auth logout

todo api-key create --name "CI"
todo api-key ls
todo api-key delete API_KEY_UUID --yes
```

登录会话按 API 地址保存在用户配置目录。访问令牌过期时，CLI 会使用轮换式 refresh token
自动续期；`auth logout` 会先在服务端撤销 refresh token，再删除本地会话。自动化环境建议通过
`TODOLIST_API_KEY` 或 `--api-key` 注入 API Key；创建时的明文只返回一次。

## 清单与分组

```bash
todo list ls
todo list ls --trash
todo list ls --archived
todo list get LIST                      # LIST 为 UUID 或名称
todo list create --name "工作" --color "#0984E3" --group "项目"
todo list update "工作" --name "工作清单" --sort-order 100
todo list update "工作" --group "项目"
todo list update "工作" --clear-group
todo list archive "工作"
todo list unarchive "工作"
todo list delete "工作"                 # 软删除
todo list restore "工作"
todo list purge "工作" --yes            # 永久删除

todo group ls
todo group get GROUP
todo group create --name "项目"
todo group update "项目" --name "进行中" --sort-order 100
todo group update "项目" --collapsed
todo group update "项目" --expanded
todo group delete "项目" --yes          # 清单保留并移出分组
```

`list ls --trash` 与 `--archived` 互斥。系统收集箱不能归档或删除，具体约束由服务端返回。

## 任务

### 查询

```bash
todo task ls                            # 默认 inbox
todo task ls --view today
todo task ls --view all
todo task ls --view completed
todo task ls --view trash
todo task ls --list "工作"              # 清单内未完成任务
todo task ls --list "工作" --status completed
todo task ls --query "周会" --sort priority-desc
todo task ls --limit 50 --cursor CURSOR
todo task ls --view all --all           # 自动拉取所有分页
todo task get TASK_UUID
```

- `--view`：`inbox`、`today`、`all`、`completed`、`trash`。
- `--status`：仅和 `--list` 使用，可选 `open`、`completed`，默认 `open`。
- `--sort`：`manual`、`created-asc`、`created-desc`、`due-asc`、`priority-desc`。
- `--view` 与 `--list` 互斥；`--all` 与 `--cursor` 互斥；`--limit` 范围为 1–200。

### 创建与更新

```bash
todo task create --title "准备周会材料" --list "工作" \
  --description "整理本周进展" \
  --due-at "2026-07-15T18:00:00+08:00" \
  --priority high --tag "重要" --item "整理数据"

todo task update TASK_UUID --title "新标题" --priority low
todo task update TASK_UUID --clear-description
todo task update TASK_UUID --clear-due
todo task update TASK_UUID --all-day
todo task update TASK_UUID --timed
todo task update TASK_UUID --clear-reminder
todo task update TASK_UUID --tag "技术" --tag "本周"
todo task update TASK_UUID --clear-tags
```

优先级接受 `none|low|medium|high` 或对应数值 `0|1|3|5`。时间必须是带时区的 RFC 3339；`--clear-due` 会由服务端同时清除提醒。

### 周期任务

```bash
# 每天
todo task create --title "每日复盘" \
  --recurrence daily --recurrence-start 2026-07-13

# 每周一，年底结束，到期前 30 分钟提醒
todo task create --title "提交周报" --due-at "2026-07-13T18:00:00+08:00" \
  --recurrence weekly --recurrence-start 2026-07-13 \
  --recurrence-end 2026-12-31 --recurrence-weekday mon \
  --reminder-offset-minutes 30

# 每月 15 日
todo task create --title "月度结算" \
  --recurrence monthly --recurrence-start 2026-07-15 --recurrence-monthday 15

todo task update TASK_UUID --recurrence weekdays --recurrence-start 2026-07-13
todo task update TASK_UUID --clear-recurrence-end
todo task update TASK_UUID --clear-reminder-offset
todo task update TASK_UUID --clear-recurrence
```

- `--recurrence`：`daily`、`weekdays`、`weekly`、`monthly`。
- 周期任务必须给出 `--recurrence-start`；weekly 还需要 `--recurrence-weekday`，monthly 还需要 `--recurrence-monthday`。
- 星期值为 `mon`、`tue`、`wed`、`thu`、`fri`、`sat`、`sun`。
- 开始、结束日期使用 `YYYY-MM-DD`；结束日期不能早于开始日期。
- 修改周期类型时同时给出完整的新规则。`--clear-recurrence` 会清除规则及循环提醒偏移。
- 每次完成周期任务会生成独立 occurrence；已完成视图会返回这些记录，`reopen` occurrence 会撤销对应完成记录。

### JSON 输入与状态操作

```bash
todo task create --input task.json
printf '%s' '{"title":"发布","recurrence_type":"daily","recurrence_start_date":"2026-07-13"}' \
  | todo task create --input -
todo task update TASK_UUID --input update.json

todo task complete TASK_UUID
todo task reopen TASK_OR_OCCURRENCE_UUID
todo task delete TASK_UUID
todo task restore TASK_UUID
todo task purge TASK_UUID --yes
```

`--input` 不能和其他业务字段混用。JSON 使用 API snake_case 字段；`list_id` 和 `tag_ids` 必须使用 UUID，周期星期使用周一为 0、周日为 6 的 API 值。

## 标签与检查项

```bash
todo tag ls
todo tag get "技术"
todo tag create --name "紧急" --color "#FF0000"
todo tag update "技术" --name "技术债务" --color "#00B894"
todo tag delete "技术" --yes

todo item ls TASK_UUID
todo item get TASK_UUID ITEM_UUID
todo item create TASK_UUID --title "收集数据"
todo item update TASK_UUID ITEM_UUID --title "整理数据"
todo item complete TASK_UUID ITEM_UUID
todo item reopen TASK_UUID ITEM_UUID
todo item delete TASK_UUID ITEM_UUID --yes
todo item reorder TASK_UUID ITEM_UUID_1 ITEM_UUID_2 ITEM_UUID_3
```

## 输出、选择器与错误

默认 JSON 输出：

```json
{"ok":true,"data":{},"meta":{}}
```

JSONL 对列表中的每项输出一行，并以 meta 行结束；table 面向人工查看，不承诺列格式稳定：

```bash
todo task ls --view all --all --output jsonl
todo list ls --output table
```

任务和检查项仅接受 UUID。清单、分组和标签接受 UUID 或名称；名称去除首尾空格后执行大小写不敏感的精确匹配，多项同名会返回 `AMBIGUOUS_SELECTOR`。

错误 JSON 写入 stderr，stdout 为空：

```json
{"ok":false,"error":{"code":"TASK_NOT_FOUND","message":"任务不存在","fields":null,"http_status":404}}
```

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `2` | CLI 参数、输入或选择器错误 |
| `3` | 资源不存在 |
| `4` | 状态冲突 |
| `5` | 服务端校验失败 |
| `6` | 未认证或无权限 |
| `7` | 网络、超时或服务端错误 |
| `8` | 其他 API 错误 |
