import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/query";
import type { TaskPage, Task, TaskSort } from "@/types";

export function invalidateTaskData(queryClient: ReturnType<typeof useQueryClient>, taskId?: string) {
  void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
  if (taskId) void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
}

export function updateTaskListCache(
  queryClient: ReturnType<typeof useQueryClient>,
  taskId: string,
  patch: Partial<Task>,
) {
  queryClient.setQueriesData<InfiniteData<TaskPage>>(
    { queryKey: ["tasks"] },
    (data) => {
      if (!data) return data;
      let changed = false;
      const pages = data.pages.map((page) => {
        let pageChanged = false;
        const items = page.items.map((task) => {
          if (task.id !== taskId) return task;
          changed = true;
          pageChanged = true;
          return { ...task, ...patch };
        });
        return pageChanged ? { ...page, items } : page;
      });
      return changed ? { ...data, pages } : data;
    },
  );
}

export function insertTaskAfter(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: ReturnType<typeof queryKeys.tasks>,
  task: Task,
  afterTaskId: string,
) {
  queryClient.setQueryData<InfiniteData<TaskPage>>(queryKey, (data) => {
    if (!data) return data;
    let inserted = false;
    const pages = data.pages.map((page) => {
      if (inserted) return page;
      const index = page.items.findIndex((item) => item.id === afterTaskId);
      if (index < 0) return page;
      inserted = true;
      const items = [...page.items];
      items.splice(index + 1, 0, task);
      return { ...page, items };
    });
    return inserted ? { ...data, pages } : data;
  });
}

function compareTaskIds(left: Task, right: Task, descending = false) {
  return descending ? right.id.localeCompare(left.id) : left.id.localeCompare(right.id);
}

function compareTaskDates(left: string | null, right: string | null, nullsLast = false) {
  if (!left && !right) return 0;
  if (!left) return nullsLast ? 1 : -1;
  if (!right) return nullsLast ? -1 : 1;
  return Date.parse(left) - Date.parse(right);
}

function compareTasks(left: Task, right: Task, sort: TaskSort) {
  if (sort === "created_asc") {
    return compareTaskDates(left.created_at, right.created_at) || compareTaskIds(left, right);
  }
  if (sort === "created_desc") {
    return compareTaskDates(right.created_at, left.created_at) || compareTaskIds(left, right, true);
  }
  if (sort === "due_asc") {
    return compareTaskDates(left.due_at, right.due_at, true) || compareTaskIds(left, right);
  }
  if (sort === "priority_desc") {
    return right.priority - left.priority || compareTaskIds(left, right);
  }
  return left.sort_order - right.sort_order || compareTaskIds(left, right);
}

export function insertTaskIntoListCache(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: ReturnType<typeof queryKeys.tasks>,
  task: Task,
  sort: TaskSort,
) {
  queryClient.setQueryData<InfiniteData<TaskPage>>(queryKey, (data) => {
    if (!data || data.pages.length === 0) return data;
    const pages = data.pages.map((page, index) => {
      const items = page.items.filter((item) => item.id !== task.id);
      if (index !== 0) {
        return items.length === page.items.length ? page : { ...page, items };
      }
      return {
        ...page,
        items: [...items, task].sort((left, right) => compareTasks(left, right, sort)),
      };
    });
    return { ...data, pages };
  });
}

export function removeTaskFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
  taskId: string,
) {
  queryClient.setQueriesData<InfiniteData<TaskPage>>(
    { queryKey: ["tasks"] },
    (data) => {
      if (!data) return data;
      let changed = false;
      const pages = data.pages.map((page) => {
        const items = page.items.filter((task) => task.id !== taskId);
        if (items.length === page.items.length) return page;
        changed = true;
        return { ...page, items };
      });
      return changed ? { ...data, pages } : data;
    },
  );
}
