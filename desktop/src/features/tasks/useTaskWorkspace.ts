import { useCallback, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import { queryKeys } from "@/query";
import type { ListGroup, Task, TaskList, TaskSort, TaskView } from "@/types";
import { useDebouncedValue, useWindowWidth } from "@/lib/hooks";
import {
  invalidateTaskData,
  updateTaskListCache,
  insertTaskAfter,
  removeTaskFromCache,
} from "@/lib/query-utils";

interface Scope {
  view?: TaskView;
  listId?: string;
}

interface EditorHandle {
  flush: () => Promise<boolean>;
}

export function useTaskWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const queryClient = useQueryClient();
  const editorRef = useRef<EditorHandle>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const windowWidth = useWindowWidth();
  const compactSidebar = windowWidth < 1280;
  const detailDrawer = windowWidth < 1120;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("todo-sidebar-collapsed") === "true",
  );
  const [sidebarOverlayOpen, setSidebarOverlayOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [sort, setSort] = useState<TaskSort>("manual");
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    action: () => void;
  } | null>(null);
  const [listDialog, setListDialog] = useState<{
    mode: "create" | "rename" | "color";
    list?: TaskList;
    groupId?: string;
  } | null>(null);
  const [groupDialog, setGroupDialog] = useState<{
    mode: "create" | "rename";
    group?: ListGroup;
  } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const scope: Scope =
    params.listId !== undefined
      ? { listId: params.listId }
      : { view: (params.view as TaskView | undefined) || "inbox" };
  const selectedTaskId = new URLSearchParams(location.search).get("task") || undefined;
  const scopeKey = scope.listId ? `list:${scope.listId}` : `view:${scope.view}`;

  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.health,
    retry: false,
    refetchInterval: 30_000,
  });
  const lists = useQuery({ queryKey: queryKeys.lists, queryFn: api.lists });
  const listGroups = useQuery({ queryKey: queryKeys.listGroups, queryFn: api.listGroups });
  const trashLists = useQuery({
    queryKey: queryKeys.trashLists,
    queryFn: api.trashLists,
    enabled: scope.view === "trash",
  });
  const archivedLists = useQuery({
    queryKey: queryKeys.archivedLists,
    queryFn: api.archivedLists,
    enabled: showArchived,
  });
  const tags = useQuery({ queryKey: queryKeys.tags, queryFn: api.tags });
  const tasks = useInfiniteQuery({
    queryKey: queryKeys.tasks(scopeKey, debouncedSearch, sort),
    queryFn: ({ pageParam }) =>
      api.tasks({
        view: scope.view,
        listId: scope.listId,
        query: debouncedSearch,
        sort,
        cursor: pageParam || undefined,
      }),
    initialPageParam: "",
    getNextPageParam: (page) => page.next_cursor || undefined,
    enabled: health.isSuccess,
  });

  const taskItems = useMemo(
    () => tasks.data?.pages.flatMap((page) => page.items) || [],
    [tasks.data],
  );
  const currentList = lists.data?.find((item) => item.id === scope.listId);
  const isSettingsRoute = location.pathname === "/settings";
  const isProfileRoute = location.pathname === "/profile";
  const isUtilityRoute = isSettingsRoute || isProfileRoute;

  const toggleSidebar = () => {
    if (compactSidebar) {
      setSidebarOverlayOpen((value) => !value);
      return;
    }
    setSidebarCollapsed((value) => {
      localStorage.setItem("todo-sidebar-collapsed", String(!value));
      return !value;
    });
  };
  const effectiveSidebarCollapsed = compactSidebar ? !sidebarOverlayOpen : sidebarCollapsed;

  const navigateAfterFlush = useCallback(
    async (target: string) => {
      if (editorRef.current && !(await editorRef.current.flush())) return;
      setSidebarOverlayOpen(false);
      navigate(target);
    },
    [navigate],
  );

  const openTask = useCallback(
    async (taskId: string) => {
      if (selectedTaskId === taskId) return;
      if (editorRef.current && !(await editorRef.current.flush())) return;
      const searchParams = new URLSearchParams(location.search);
      searchParams.set("task", taskId);
      navigate(`${location.pathname}?${searchParams}`);
    },
    [location.pathname, location.search, navigate, selectedTaskId],
  );

  const closeDetail = useCallback(async () => {
    if (editorRef.current && !(await editorRef.current.flush())) return;
    navigate(location.pathname);
  }, [location.pathname, navigate]);

  const createTask = useMutation({
    mutationFn: (input: {
      title: string;
      priority?: 0 | 1 | 3 | 5;
      due_at?: string;
      is_all_day?: boolean;
    }) =>
      api.createTask({
        ...input,
        ...(scope.listId
          ? { list_id: scope.listId }
          : scope.view === "inbox"
            ? { list_id: lists.data?.find((item) => item.system_type === "inbox")?.id }
            : {}),
      }),
    onSuccess: (task) => {
      invalidateTaskData(queryClient, task.id);
      void openTask(task.id);
    },
  });

  const renameTask = useCallback(
    async (task: Task, title: string) => {
      const saved = await api.updateTask(task.id, { title });
      updateTaskListCache(queryClient, task.id, { title: saved.title });
      queryClient.setQueryData(queryKeys.task(task.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      return saved;
    },
    [queryClient],
  );

  const createInlineTask = useCallback(
    async (afterTask: Task, sortOrder: number) => {
      const task = await api.createTask({
        title: "",
        list_id: afterTask.list_id,
        sort_order: sortOrder,
      });
      insertTaskAfter(
        queryClient,
        queryKeys.tasks(scopeKey, debouncedSearch, sort),
        task,
        afterTask.id,
      );
      queryClient.setQueryData(queryKeys.task(task.id), task);
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
      return task;
    },
    [debouncedSearch, queryClient, scopeKey, sort],
  );

  const deleteInlineTask = useCallback(
    async (task: Task) => {
      await api.deleteTask(task.id);
      removeTaskFromCache(queryClient, task.id);
      queryClient.removeQueries({ queryKey: queryKeys.task(task.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
    },
    [queryClient],
  );

  const stateMutation = useMutation({
    mutationFn: ({ task, action }: { task: Task; action: "complete" | "reopen" }) =>
      action === "complete" ? api.completeTask(task.id) : api.reopenTask(task.id),
    onSuccess: (task) => invalidateTaskData(queryClient, task.id),
  });

  const applyTaskShortcut = useCallback(
    async (task: Task, patch: Partial<Task>) => {
      if (editorRef.current && !(await editorRef.current.flush())) return;
      const saved = await api.updateTask(task.id, patch);
      updateTaskListCache(queryClient, task.id, saved);
      queryClient.setQueryData(queryKeys.task(task.id), saved);
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    [queryClient],
  );

  const deleteTaskMutation = useMutation({
    mutationFn: api.deleteTask,
    onSuccess: (_, id) => {
      navigate(location.pathname);
      invalidateTaskData(queryClient, id);
    },
  });
  const restoreTaskMutation = useMutation({
    mutationFn: api.restoreTask,
    onSuccess: (task) => {
      navigate(location.pathname);
      invalidateTaskData(queryClient, task.id);
    },
  });
  const permanentTaskMutation = useMutation({
    mutationFn: api.permanentDeleteTask,
    onSuccess: (_, id) => {
      navigate(location.pathname);
      invalidateTaskData(queryClient, id);
    },
  });

  return {
    // State
    scope,
    selectedTaskId,
    scopeKey,
    search,
    setSearch,
    sort,
    setSort,
    confirm,
    setConfirm,
    listDialog,
    setListDialog,
    groupDialog,
    setGroupDialog,
    showArchived,
    setShowArchived,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarOverlayOpen,
    setSidebarOverlayOpen,
    compactSidebar,
    detailDrawer,
    effectiveSidebarCollapsed,
    
    // Queries
    health,
    lists,
    listGroups,
    trashLists,
    archivedLists,
    tags,
    tasks,
    taskItems,
    currentList,
    isSettingsRoute,
    isProfileRoute,
    isUtilityRoute,
    
    // Refs
    editorRef,
    quickAddRef,
    
    // Actions
    toggleSidebar,
    navigateAfterFlush,
    openTask,
    closeDetail,
    createTask,
    renameTask,
    createInlineTask,
    deleteInlineTask,
    stateMutation,
    applyTaskShortcut,
    deleteTaskMutation,
    restoreTaskMutation,
    permanentTaskMutation,
    
    // Navigation
    navigate,
    location,
  };
}