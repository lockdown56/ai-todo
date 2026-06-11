import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { Tag, Task, TaskList } from "../types";

const now = "2026-06-11T08:00:00Z";

export const inbox: TaskList = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "收集箱",
  color: "#6C5CE7",
  system_type: "inbox",
  sort_order: 1024,
  task_count: 1,
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

let tasks = [makeTask()];

export function resetMockData() {
  tasks = [makeTask()];
}

export const handlers = [
  http.get("http://127.0.0.1:8000/health", () =>
    HttpResponse.json({ status: "ok", database: "ok" }),
  ),
  http.get("http://127.0.0.1:8000/api/v1/lists", () =>
    HttpResponse.json([inbox, workList]),
  ),
  http.get("http://127.0.0.1:8000/api/v1/lists/trash", () =>
    HttpResponse.json([]),
  ),
  http.get("http://127.0.0.1:8000/api/v1/tags", () =>
    HttpResponse.json([baseTag]),
  ),
  http.get("http://127.0.0.1:8000/api/v1/tasks", ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.toLowerCase();
    const items = query
      ? tasks.filter((task) => task.title.toLowerCase().includes(query))
      : tasks;
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
    const body = (await request.json()) as { title: string; list_id?: string };
    const task = makeTask({
      id: "00000000-0000-4000-8000-000000000101",
      title: body.title,
      list_id: body.list_id || inbox.id,
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
