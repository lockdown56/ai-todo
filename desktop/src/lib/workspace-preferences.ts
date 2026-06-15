import type { TaskSort, TaskView } from "@/types";

const LAST_ROUTE_KEY = "todo-last-workspace-route";
const TASK_SORTS_KEY = "todo-task-sorts";
const SELECTED_TASKS_KEY = "todo-selected-tasks";

const VALID_SORTS = new Set<TaskSort>([
  "manual",
  "created_asc",
  "created_desc",
  "due_asc",
  "priority_desc",
]);

const VALID_VIEWS = new Set<TaskView>([
  "inbox",
  "today",
  "all",
  "completed",
  "trash",
]);

function readJsonRecord(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonRecord(key: string, value: Record<string, string>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function isWorkspaceRoute(path: string): boolean {
  const [pathname] = path.split("?");
  if (pathname.startsWith("/view/")) {
    const view = pathname.slice("/view/".length);
    return VALID_VIEWS.has(view as TaskView);
  }
  if (pathname.startsWith("/list/")) {
    const listId = pathname.slice("/list/".length);
    return listId.length > 0;
  }
  return false;
}

export function getLastWorkspaceRoute(): string | null {
  if (typeof window === "undefined") return null;
  const route = window.localStorage.getItem(LAST_ROUTE_KEY);
  if (!route || !isWorkspaceRoute(route)) return null;
  return route;
}

export function setLastWorkspaceRoute(pathname: string, search = ""): void {
  if (typeof window === "undefined") return;
  const route = `${pathname}${search}`;
  if (!isWorkspaceRoute(route)) return;
  window.localStorage.setItem(LAST_ROUTE_KEY, route);
}

export function getTaskSort(scopeKey: string): TaskSort {
  const sorts = readJsonRecord(TASK_SORTS_KEY);
  const sort = sorts[scopeKey];
  return sort && VALID_SORTS.has(sort as TaskSort) ? (sort as TaskSort) : "manual";
}

export function setTaskSort(scopeKey: string, sort: TaskSort): void {
  const sorts = readJsonRecord(TASK_SORTS_KEY);
  sorts[scopeKey] = sort;
  writeJsonRecord(TASK_SORTS_KEY, sorts);
}

export function getSelectedTaskId(scopeKey: string): string | null {
  const tasks = readJsonRecord(SELECTED_TASKS_KEY);
  return tasks[scopeKey] || null;
}

export function setSelectedTaskId(scopeKey: string, taskId: string | null): void {
  const tasks = readJsonRecord(SELECTED_TASKS_KEY);
  if (taskId) {
    tasks[scopeKey] = taskId;
  } else {
    delete tasks[scopeKey];
  }
  writeJsonRecord(SELECTED_TASKS_KEY, tasks);
}

export function getDefaultWorkspaceRoute(): string {
  return getLastWorkspaceRoute() || "/view/inbox";
}
