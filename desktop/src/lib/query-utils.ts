import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/query";
import type { TaskPage, Task } from "@/types";

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