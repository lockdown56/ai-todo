import type {
  ApiErrorPayload,
  ChecklistItem,
  Health,
  Tag,
  Task,
  TaskList,
  TaskPage,
  TaskPatch,
  TaskSort,
  TaskView,
} from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  let signal: AbortSignal | undefined;
  try {
    new Request(`${API_BASE_URL}${path}`, { signal: controller.signal });
    signal = controller.signal;
  } catch {
    // Some test DOMs provide an AbortSignal from a different JavaScript realm.
  }
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      let payload: ApiErrorPayload | null = null;
      try {
        payload = (await response.json()) as ApiErrorPayload;
      } catch {
        // The fallback below keeps transport and proxy errors understandable.
      }
      throw new ApiError(
        response.status,
        payload?.error.code || "HTTP_ERROR",
        payload?.error.message || `请求失败 (${response.status})`,
        payload?.error.fields,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "请求超时"
        : "无法连接到服务";
    throw new ApiError(0, "NETWORK_ERROR", message);
  } finally {
    window.clearTimeout(timeout);
  }
}

function json(method: string, body?: unknown): RequestInit {
  return { method, body: body === undefined ? undefined : JSON.stringify(body) };
}

export const api = {
  health: () => request<Health>("/health"),

  lists: () => request<TaskList[]>("/api/v1/lists"),
  trashLists: () => request<TaskList[]>("/api/v1/lists/trash"),
  createList: (body: { name: string; color: string }) =>
    request<TaskList>("/api/v1/lists", json("POST", body)),
  updateList: (id: string, body: Partial<Pick<TaskList, "name" | "color" | "sort_order">>) =>
    request<TaskList>(`/api/v1/lists/${id}`, json("PATCH", body)),
  deleteList: (id: string) => request<void>(`/api/v1/lists/${id}`, json("DELETE")),
  restoreList: (id: string) =>
    request<TaskList>(`/api/v1/lists/${id}/restore`, json("POST")),
  permanentDeleteList: (id: string) =>
    request<void>(`/api/v1/lists/${id}/permanent`, json("DELETE")),

  tasks: (params: {
    view?: TaskView;
    listId?: string;
    query?: string;
    sort: TaskSort;
    cursor?: string;
  }) => {
    const search = new URLSearchParams({ sort: params.sort, limit: "100" });
    if (params.view) search.set("view", params.view);
    if (params.listId) search.set("list_id", params.listId);
    if (params.query) search.set("query", params.query);
    if (params.cursor) search.set("cursor", params.cursor);
    return request<TaskPage>(`/api/v1/tasks?${search}`);
  },
  task: (id: string) => request<Task>(`/api/v1/tasks/${id}`),
  createTask: (body: { title: string; list_id?: string }) =>
    request<Task>("/api/v1/tasks", json("POST", body)),
  updateTask: (id: string, body: TaskPatch) =>
    request<Task>(`/api/v1/tasks/${id}`, json("PATCH", body)),
  deleteTask: (id: string) => request<void>(`/api/v1/tasks/${id}`, json("DELETE")),
  completeTask: (id: string) =>
    request<Task>(`/api/v1/tasks/${id}/complete`, json("POST")),
  reopenTask: (id: string) =>
    request<Task>(`/api/v1/tasks/${id}/reopen`, json("POST")),
  restoreTask: (id: string) =>
    request<Task>(`/api/v1/tasks/${id}/restore`, json("POST")),
  permanentDeleteTask: (id: string) =>
    request<void>(`/api/v1/tasks/${id}/permanent`, json("DELETE")),

  tags: () => request<Tag[]>("/api/v1/tags"),
  createTag: (body: { name: string; color: string }) =>
    request<Tag>("/api/v1/tags", json("POST", body)),

  createItem: (taskId: string, title: string) =>
    request<ChecklistItem>(
      `/api/v1/tasks/${taskId}/items`,
      json("POST", { title }),
    ),
  updateItem: (
    taskId: string,
    itemId: string,
    body: Partial<Pick<ChecklistItem, "title" | "is_completed">>,
  ) =>
    request<ChecklistItem>(
      `/api/v1/tasks/${taskId}/items/${itemId}`,
      json("PATCH", body),
    ),
  deleteItem: (taskId: string, itemId: string) =>
    request<void>(`/api/v1/tasks/${taskId}/items/${itemId}`, json("DELETE")),
  reorderItems: (taskId: string, itemIds: string[]) =>
    request<ChecklistItem[]>(
      `/api/v1/tasks/${taskId}/items/reorder`,
      json("POST", { item_ids: itemIds }),
    ),
};
