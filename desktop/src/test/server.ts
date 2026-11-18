import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { AgentRun, AgentRunLane, ApiKeyScope, Tag, Task, TaskList } from "../types";

const now = "2026-06-11T08:00:00Z";

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export const inbox: TaskList = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "收集箱",
  color: "#4F6FAE",
  system_type: "inbox",
  group_id: null,
  sort_order: 1024,
  task_count: 1,
  archived_at: null,
  deleted_at: null,
  deletion_batch_id: null,
  created_at: now,
  updated_at: now,
};

export const workList: TaskList = {
  ...inbox,
  id: "00000000-0000-4000-8000-000000000011",
  name: "工作",
  system_type: null,
  task_count: 0,
  sort_order: 2048,
};

export const baseTag: Tag = {
  id: "00000000-0000-4000-8000-000000000020",
  name: "技术",
  color: "#4F8EF7",
  created_at: now,
  updated_at: now,
};

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-4000-8000-000000000100",
    list_id: inbox.id,
    title: "编写测试",
    description: "",
    due_at: null,
    is_all_day: false,
    reminder_at: null,
    priority: 3,
    status: 0,
    completed_at: null,
    sort_order: 1024,
    deleted_at: null,
    deletion_batch_id: null,
    tags: [baseTag],
    checklist_items: [],
    created_at: now,
    updated_at: now,
    recurrence_type: null,
    recurrence_start_date: null,
    recurrence_end_date: null,
    recurrence_weekday: null,
    recurrence_monthday: null,
    reminder_offset_minutes: null,
    source_task_id: null,
    occurrence_date: null,
    is_recurring_occurrence: false,
    ...overrides,
  };
}

export const inboxCompletedTask = makeTask({
  id: "00000000-0000-4000-8000-000000000103",
  title: "收集箱已完成",
  status: 2,
  completed_at: now,
  tags: [],
});

export const workListTask = makeTask({
  id: "00000000-0000-4000-8000-000000000201",
  list_id: workList.id,
  title: "工作清单任务",
  tags: [],
});

export const workListCompletedTask = makeTask({
  id: "00000000-0000-4000-8000-000000000202",
  list_id: workList.id,
  title: "已完成工作",
  status: 2,
  completed_at: now,
  tags: [],
});

let tasks = [makeTask(), inboxCompletedTask, workListTask, workListCompletedTask];
let nextTaskNumber = 203;
let currentRefreshToken = "test-refresh-token";
let nextRefreshNumber = 1;

export function makeAgentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "00000000-0000-4000-8000-000000000500",
    source: "Codex · 工作电脑",
    title: "等待确认迁移方案",
    summary: "请回原会话确认是否运行数据库迁移",
    status: "waiting_user",
    version: 3,
    session_ref: "db-migration-review",
    session_url: "https://chatgpt.com/c/example-session",
    workspace_label: "ai-todo",
    task_id: null,
    created_at: now,
    updated_at: minutesAgo(3),
    status_changed_at: minutesAgo(3),
    ...overrides,
  };
}

function defaultAgentRuns(): AgentRun[] {
  return [
    makeAgentRun(),
    makeAgentRun({
      id: "00000000-0000-4000-8000-000000000501",
      source: "Claude Code",
      title: "排查支付回调异常",
      summary: "已定位重复回调，正在补充回归用例",
      status: "running",
      version: 2,
      session_ref: "pay-callback",
      session_url: null,
      workspace_label: "payment-service",
      updated_at: minutesAgo(1),
      status_changed_at: minutesAgo(20),
    }),
    makeAgentRun({
      id: "00000000-0000-4000-8000-000000000502",
      title: "回归验证完成",
      summary: "全部用例通过",
      status: "succeeded",
      version: 5,
      session_ref: null,
      session_url: null,
      updated_at: minutesAgo(10),
      status_changed_at: minutesAgo(10),
    }),
  ];
}

let agentRuns = defaultAgentRuns();

export const agentRunRequestLog: string[] = [];
export const agentRunEventLog: Array<{
  runId: string;
  body: unknown;
  idempotencyKey: string | null;
}> = [];

const laneStatuses: Record<AgentRunLane, string[]> = {
  attention: ["waiting_user"],
  active: ["running"],
  history: ["succeeded", "failed", "cancelled", "dismissed"],
};

export function listAgentRuns(search: URLSearchParams) {
  const lane = (search.get("lane") || "attention") as AgentRunLane;
  const source = (search.get("source") || "").trim();
  const items = agentRuns.filter(
    (run) =>
      laneStatuses[lane].includes(run.status) && (!source || run.source === source),
  );
  return { items, next_cursor: null as string | null };
}

export function resetMockData() {
  tasks = [makeTask(), inboxCompletedTask, workListTask, workListCompletedTask];
  nextTaskNumber = 203;
  currentRefreshToken = "test-refresh-token";
  nextRefreshNumber = 1;
  agentRuns = defaultAgentRuns();
  agentRunRequestLog.length = 0;
  agentRunEventLog.length = 0;
}

export const handlers = [
  http.post("http://127.0.0.1:8000/api/v1/auth/login", async ({ request }) => {
    const body = (await request.json()) as { username: string; password: string };
    if (body.username !== "admin" || body.password !== "change-me") {
      return HttpResponse.json(
        {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "用户名或密码错误",
            fields: null,
          },
        },
        { status: 401 },
      );
    }
    return HttpResponse.json({
      access_token: "test-access-token",
      token_type: "bearer",
      expires_in: 604800,
      expires_at: "2099-06-18T08:00:00Z",
      refresh_token: "test-refresh-token",
      refresh_expires_at: "2099-07-18T08:00:00Z",
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        username: "admin",
        display_name: "默认用户",
      },
    });
  }),
  http.post("http://127.0.0.1:8000/api/v1/auth/refresh", async ({ request }) => {
    const body = (await request.json()) as { refresh_token: string };
    if (body.refresh_token !== currentRefreshToken) {
      return HttpResponse.json(
        {
          error: {
            code: "REFRESH_TOKEN_INVALID",
            message: "刷新凭据无效或已失效",
            fields: null,
          },
        },
        { status: 401 },
      );
    }
    nextRefreshNumber += 1;
    currentRefreshToken = `test-refresh-token-${nextRefreshNumber}`;
    return HttpResponse.json({
      access_token: `test-access-token-${nextRefreshNumber}`,
      token_type: "bearer",
      expires_in: 604800,
      expires_at: "2099-06-18T08:00:00Z",
      refresh_token: currentRefreshToken,
      refresh_expires_at: "2099-07-18T08:00:00Z",
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        username: "admin",
        display_name: "默认用户",
      },
    });
  }),
  http.post("http://127.0.0.1:8000/api/v1/auth/logout", () => {
    currentRefreshToken = "revoked-refresh-token";
    return new HttpResponse(null, { status: 204 });
  }),
  http.get("http://127.0.0.1:8000/api/v1/auth/me", () =>
    HttpResponse.json({
      id: "00000000-0000-4000-8000-000000000001",
      username: "admin",
      display_name: "默认用户",
    }),
  ),
  http.get("http://127.0.0.1:8000/health", () =>
    HttpResponse.json({ status: "ok", database: "ok" }),
  ),
  http.get("http://127.0.0.1:8000/api/v1/lists", () =>
    HttpResponse.json([inbox, workList]),
  ),
  http.get("http://127.0.0.1:8000/api/v1/lists/trash", () =>
    HttpResponse.json([]),
  ),
  http.get("http://127.0.0.1:8000/api/v1/lists/archived", () =>
    HttpResponse.json([]),
  ),
  http.get("http://127.0.0.1:8000/api/v1/smart-lists", () => HttpResponse.json([])),
  http.get("http://127.0.0.1:8000/api/v1/list-groups", () =>
    HttpResponse.json([]),
  ),
  http.get("http://127.0.0.1:8000/api/v1/tags", () =>
    HttpResponse.json([baseTag]),
  ),
  http.get("http://127.0.0.1:8000/api/v1/tasks", ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.toLowerCase();
    const listId = url.searchParams.get("list_id");
    const status = url.searchParams.get("status");
    const view = url.searchParams.get("view");
    const dateSection = url.searchParams.get("date_section");
    let items = tasks;

    if (listId) {
      items = items.filter((task) => task.list_id === listId && task.deleted_at === null);
      if (status === "2") {
        items = items.filter((task) => task.status === 2);
      } else {
        items = items.filter((task) => task.status === 0);
      }
    } else if (view === "trash") {
      items = items.filter((task) => task.deleted_at !== null);
    } else if (view === "completed") {
      items = items.filter((task) => task.deleted_at === null && task.status === 2);
    } else {
      items = items.filter((task) => task.deleted_at === null && task.status === 0);
      if (view === "inbox") {
        items = items.filter((task) => task.list_id === inbox.id);
      } else if (view === "today") {
        const current = new Date();
        const start = new Date(current.getFullYear(), current.getMonth(), current.getDate());
        const end = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
        items = items.filter((task) => {
          if (!task.due_at) return false;
          const due = new Date(task.due_at);
          return dateSection === "overdue" ? due < start : due >= start && due < end;
        });
      }
    }

    if (query) {
      items = items.filter((task) => task.title.toLowerCase().includes(query));
    }
    return HttpResponse.json({ items, next_cursor: null });
  }),
  http.get("http://127.0.0.1:8000/api/v1/tasks/:taskId", ({ params }) => {
    const task = tasks.find((item) => item.id === params.taskId);
    return task
      ? HttpResponse.json(task)
      : HttpResponse.json(
          { error: { code: "TASK_NOT_FOUND", message: "任务不存在", fields: null } },
          { status: 404 },
        );
  }),
  http.post("http://127.0.0.1:8000/api/v1/tasks", async ({ request }) => {
    const body = (await request.json()) as {
      title: string;
      list_id?: string;
      sort_order?: number;
      priority?: 0 | 1 | 3 | 5;
      due_at?: string | null;
      is_all_day?: boolean;
    };
    const task = makeTask({
      id: `00000000-0000-4000-8000-${String(nextTaskNumber++).padStart(12, "0")}`,
      title: body.title,
      list_id: body.list_id || inbox.id,
      sort_order: body.sort_order ?? 2048,
      priority: body.priority ?? 0,
      due_at: body.due_at ?? null,
      is_all_day: body.is_all_day ?? false,
      tags: [],
    });
    tasks.push(task);
    return HttpResponse.json(task, { status: 201 });
  }),
  http.patch(
    "http://127.0.0.1:8000/api/v1/tasks/:taskId",
    async ({ params, request }) => {
      const patch = (await request.json()) as Partial<Task>;
      const index = tasks.findIndex((item) => item.id === params.taskId);
      tasks[index] = { ...tasks[index], ...patch, updated_at: now };
      return HttpResponse.json(tasks[index]);
    },
  ),
  http.delete("http://127.0.0.1:8000/api/v1/tasks/:taskId", ({ params }) => {
    tasks = tasks.filter((item) => item.id !== params.taskId);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(
    "http://127.0.0.1:8000/api/v1/tasks/:taskId/complete",
    ({ params }) => {
      const task = tasks.find((item) => item.id === params.taskId)!;
      task.status = 2;
      task.completed_at = now;
      return HttpResponse.json(task);
    },
  ),
  http.get("http://127.0.0.1:8000/api/v1/api-keys", () =>
    HttpResponse.json([]),
  ),
  http.post("http://127.0.0.1:8000/api/v1/api-keys", async ({ request }) => {
    const body = (await request.json()) as { name: string; scope?: ApiKeyScope };
    return HttpResponse.json(
      {
        id: "00000000-0000-4000-8000-000000000030",
        name: body.name,
        key_prefix: "tdl_testpre01",
        scope: body.scope || "todo_full",
        last_used_at: null,
        expires_at: null,
        created_at: now,
        api_key: "tdl_mocksecretvalue123",
      },
      { status: 201 },
    );
  }),
  http.delete("http://127.0.0.1:8000/api/v1/api-keys/:keyId", () =>
    new HttpResponse(null, { status: 204 }),
  ),
  http.get("http://127.0.0.1:8000/api/v1/agent-runs", ({ request }) => {
    const url = new URL(request.url);
    agentRunRequestLog.push(url.search);
    return HttpResponse.json(listAgentRuns(url.searchParams));
  }),
  http.post(
    "http://127.0.0.1:8000/api/v1/agent-runs/:runId/events",
    async ({ request, params }) => {
      const body = (await request.json()) as {
        type: string;
        expected_version: number;
      };
      agentRunEventLog.push({
        runId: String(params.runId),
        body,
        idempotencyKey: request.headers.get("Idempotency-Key"),
      });
      const run = agentRuns.find((item) => item.id === params.runId);
      if (!run) {
        return HttpResponse.json(
          {
            error: {
              code: "AGENT_RUN_NOT_FOUND",
              message: "运行不存在",
              fields: null,
            },
          },
          { status: 404 },
        );
      }
      if (body.expected_version !== run.version) {
        return HttpResponse.json(
          {
            error: {
              code: "AGENT_VERSION_CONFLICT",
              message: "版本已过期，请刷新后重试",
              fields: null,
            },
          },
          { status: 409 },
        );
      }
      if (body.type === "dismiss") {
        run.status = "dismissed";
        run.status_changed_at = new Date().toISOString();
        run.version += 1;
      }
      return HttpResponse.json({ run_id: run.id, version: run.version });
    },
  ),
];

export const server = setupServer(...handlers);
