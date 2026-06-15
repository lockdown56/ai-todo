import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { Tag, Task, TaskList } from "../types";

const now = "2026-06-11T08:00:00Z";

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

export function resetMockData() {
  tasks = [makeTask(), inboxCompletedTask, workListTask, workListCompletedTask];
  nextTaskNumber = 203;
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
      expires_at: "2026-06-18T08:00:00Z",
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        username: "admin",
        display_name: "默认用户",
      },
    });
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
    };
    const task = makeTask({
      id: `00000000-0000-4000-8000-${String(nextTaskNumber++).padStart(12, "0")}`,
      title: body.title,
      list_id: body.list_id || inbox.id,
      sort_order: body.sort_order ?? 2048,
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
];

export const server = setupServer(...handlers);
