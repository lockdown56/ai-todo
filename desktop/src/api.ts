import type {
  ApiErrorPayload,
  ApiKey,
  ApiKeyCreated,
  AuthToken,
  AuthUser,
  ChecklistItem,
  CreateTaskInput,
  Health,
  ListGroup,
  SmartList,
  SmartListInput,
  Tag,
  Task,
  TaskList,
  TaskPage,
  TaskPatch,
  TaskSort,
  TaskView,
} from "./types";
import {
  expireAuthSession,
  getAccessToken,
  getRefreshToken,
  replaceAuthSession,
  shouldRefreshAccessToken,
} from "./auth";
import { getApiBaseUrl, normalizeApiBaseUrl } from "./config";

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

let refreshPromise: Promise<string | null> | null = null;

function requestHeaders(init: RequestInit, token: string | null): HeadersInit {
  return {
    Accept: "application/json",
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init.headers,
  };
}

async function fetchWithTimeout(
  path: string,
  init: RequestInit = {},
  token: string | null = null,
): Promise<Response> {
  const apiBaseUrl = getApiBaseUrl();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  let signal: AbortSignal | undefined;
  try {
    new Request(`${apiBaseUrl}${path}`, { signal: controller.signal });
    signal = controller.signal;
  } catch {
    // Some test DOMs provide an AbortSignal from a different JavaScript realm.
  }
  try {
    return await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal,
      headers: requestHeaders(init, token),
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function responseError(response: Response): Promise<ApiError> {
  let payload: ApiErrorPayload | null = null;
  try {
    payload = (await response.json()) as ApiErrorPayload;
  } catch {
    // The fallback below keeps transport and proxy errors understandable.
  }
  return new ApiError(
    response.status,
    payload?.error.code || "HTTP_ERROR",
    payload?.error.message || `请求失败 (${response.status})`,
    payload?.error.fields,
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function refreshAuthSession(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    try {
      const response = await fetchWithTimeout(
        "/api/v1/auth/refresh",
        json("POST", { refresh_token: refreshToken }),
      );
      if (!response.ok) {
        const error = await responseError(response);
        if ((response.status === 401 || response.status === 403) && getRefreshToken() === refreshToken) {
          expireAuthSession();
        }
        throw error;
      }
      const session = await parseResponse<AuthToken>(response);
      replaceAuthSession(session);
      return session.access_token;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "请求超时"
          : "无法连接到服务";
      throw new ApiError(0, "NETWORK_ERROR", message);
    }
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { authenticated?: boolean; expireOnUnauthorized?: boolean } = {},
): Promise<T> {
  const authenticated = options.authenticated !== false;
  let token = authenticated ? getAccessToken() : null;
  if (authenticated && shouldRefreshAccessToken()) {
    const fallbackToken = token;
    try {
      token = (await refreshAuthSession()) || getAccessToken() || token;
    } catch (error) {
      if (!getAccessToken()) throw error;
      token = fallbackToken;
    }
  }
  try {
    let response = await fetchWithTimeout(path, init, token);
    if (response.status === 401 && authenticated && options.expireOnUnauthorized !== false) {
      const firstError = await responseError(response);
      try {
        const refreshedToken = await refreshAuthSession();
        if (refreshedToken) {
          response = await fetchWithTimeout(path, init, refreshedToken);
          if (response.ok) return parseResponse<T>(response);
          const retriedError = await responseError(response);
          if (response.status === 401) expireAuthSession();
          throw retriedError;
        }
      } catch (refreshError) {
        expireAuthSession();
        if (refreshError instanceof ApiError && refreshError.status === 401) throw refreshError;
      }
      expireAuthSession();
      throw firstError;
    }
    if (!response.ok) {
      const error = await responseError(response);
      if (response.status === 401 && options.expireOnUnauthorized !== false) {
        expireAuthSession();
      }
      throw error;
    }
    return parseResponse<T>(response);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "请求超时"
        : "无法连接到服务";
    throw new ApiError(0, "NETWORK_ERROR", message);
  }
}

async function requestFromBase<T>(baseUrl: string, path: string): Promise<T> {
  const apiBaseUrl = normalizeApiBaseUrl(baseUrl);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new ApiError(response.status, "HTTP_ERROR", `请求失败 (${response.status})`);
    }
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
  health: () => request<Health>("/health", {}, { authenticated: false }),
  login: (username: string, password: string) =>
    request<AuthToken>(
      "/api/v1/auth/login",
      json("POST", { username, password }),
      { authenticated: false, expireOnUnauthorized: false },
    ),
  logout: () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return Promise.resolve();
    return request<void>(
      "/api/v1/auth/logout",
      json("POST", { refresh_token: refreshToken }),
      { authenticated: false, expireOnUnauthorized: false },
    );
  },
  me: () => request<AuthUser>("/api/v1/auth/me"),

  lists: () => request<TaskList[]>("/api/v1/lists"),
  trashLists: () => request<TaskList[]>("/api/v1/lists/trash"),
  archivedLists: () => request<TaskList[]>("/api/v1/lists/archived"),
  createList: (body: { name: string; color: string; group_id?: string | null }) =>
    request<TaskList>("/api/v1/lists", json("POST", body)),
  updateList: (
    id: string,
    body: Partial<Pick<TaskList, "name" | "color" | "sort_order" | "group_id">>,
  ) => request<TaskList>(`/api/v1/lists/${id}`, json("PATCH", body)),
  deleteList: (id: string) => request<void>(`/api/v1/lists/${id}`, json("DELETE")),
  restoreList: (id: string) => request<TaskList>(`/api/v1/lists/${id}/restore`, json("POST")),
  permanentDeleteList: (id: string) =>
    request<void>(`/api/v1/lists/${id}/permanent`, json("DELETE")),
  archiveList: (id: string) => request<TaskList>(`/api/v1/lists/${id}/archive`, json("POST")),
  unarchiveList: (id: string) => request<TaskList>(`/api/v1/lists/${id}/unarchive`, json("POST")),

  listGroups: () => request<ListGroup[]>("/api/v1/list-groups"),
  createGroup: (body: { name: string }) =>
    request<ListGroup>("/api/v1/list-groups", json("POST", body)),
  updateGroup: (id: string, body: Partial<Pick<ListGroup, "name" | "sort_order" | "is_collapsed">>) =>
    request<ListGroup>(`/api/v1/list-groups/${id}`, json("PATCH", body)),
  deleteGroup: (id: string) => request<void>(`/api/v1/list-groups/${id}`, json("DELETE")),

  smartLists: () => request<SmartList[]>("/api/v1/smart-lists"),
  createSmartList: (body: SmartListInput) =>
    request<SmartList>("/api/v1/smart-lists", json("POST", body)),
  updateSmartList: (id: string, body: Partial<SmartListInput & { sort_order: number }>) =>
    request<SmartList>(`/api/v1/smart-lists/${id}`, json("PATCH", body)),
  deleteSmartList: (id: string) =>
    request<void>(`/api/v1/smart-lists/${id}`, json("DELETE")),

  tasks: (params: {
    view?: TaskView;
    listId?: string;
    smartListId?: string;
    dateSection?: "today" | "overdue";
    status?: 0 | 2;
    query?: string;
    sort: TaskSort;
    cursor?: string;
  }) => {
    const search = new URLSearchParams({ sort: params.sort, limit: "100" });
    if (params.view) search.set("view", params.view);
    if (params.listId) search.set("list_id", params.listId);
    if (params.smartListId) search.set("smart_list_id", params.smartListId);
    if (params.dateSection) search.set("date_section", params.dateSection);
    if (params.status !== undefined) search.set("status", String(params.status));
    if (params.query) search.set("query", params.query);
    if (params.cursor) search.set("cursor", params.cursor);
    return request<TaskPage>(`/api/v1/tasks?${search}`);
  },
  task: (id: string) => request<Task>(`/api/v1/tasks/${id}`),
  createTask: (body: CreateTaskInput & { sort_order?: number }) =>
    request<Task>("/api/v1/tasks", json("POST", body)),
  updateTask: (id: string, body: TaskPatch) => request<Task>(`/api/v1/tasks/${id}`, json("PATCH", body)),
  deleteTask: (id: string) => request<void>(`/api/v1/tasks/${id}`, json("DELETE")),
  completeTask: (id: string) => request<Task>(`/api/v1/tasks/${id}/complete`, json("POST")),
  reopenTask: (id: string) => request<Task>(`/api/v1/tasks/${id}/reopen`, json("POST")),
  restoreTask: (id: string) => request<Task>(`/api/v1/tasks/${id}/restore`, json("POST")),
  permanentDeleteTask: (id: string) => request<void>(`/api/v1/tasks/${id}/permanent`, json("DELETE")),

  tags: () => request<Tag[]>("/api/v1/tags"),
  createTag: (body: { name: string; color: string }) =>
    request<Tag>("/api/v1/tags", json("POST", body)),

  createItem: (taskId: string, title: string) =>
    request<ChecklistItem>(`/api/v1/tasks/${taskId}/items`, json("POST", { title })),
  updateItem: (
    taskId: string,
    itemId: string,
    body: Partial<Pick<ChecklistItem, "title" | "is_completed">>,
  ) => request<ChecklistItem>(`/api/v1/tasks/${taskId}/items/${itemId}`, json("PATCH", body)),
  deleteItem: (taskId: string, itemId: string) =>
    request<void>(`/api/v1/tasks/${taskId}/items/${itemId}`, json("DELETE")),
  reorderItems: (taskId: string, itemIds: string[]) =>
    request<ChecklistItem[]>(`/api/v1/tasks/${taskId}/items/reorder`, json("POST", { item_ids: itemIds })),

  apiKeys: () => request<ApiKey[]>("/api/v1/api-keys"),
  createApiKey: (name: string) =>
    request<ApiKeyCreated>("/api/v1/api-keys", json("POST", { name })),
  deleteApiKey: (id: string) => request<void>(`/api/v1/api-keys/${id}`, json("DELETE")),
};

export async function testApiBaseUrl(baseUrl: string): Promise<Health> {
  return requestFromBase<Health>(baseUrl, "/health");
}
