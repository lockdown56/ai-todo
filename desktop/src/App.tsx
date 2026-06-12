import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Inbox,
  List,
  ListChecks,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  Tag as TagIcon,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { queryKeys } from "./query";
import type {
  ChecklistItem,
  Tag,
  Task,
  TaskList,
  TaskPage,
  TaskPatch,
  TaskSort,
  TaskView,
} from "./types";

const viewNames: Record<TaskView, string> = {
  inbox: "收集箱",
  today: "今天",
  all: "全部",
  completed: "已完成",
  trash: "回收站",
};

const viewIcons = {
  inbox: Inbox,
  today: Star,
  all: ListChecks,
  completed: CheckCircle2,
  trash: Trash2,
};

const priorityLabels = { 0: "无", 1: "低", 3: "中", 5: "高" };
const priorityShortcutValues = [0, 1, 3, 5] as const;
const tagColors = ["#4F6FAE", "#5F7FB6", "#C08A32", "#C96F43", "#4F8A68", "#B65B62"];
const weekDayLabels = ["一", "二", "三", "四", "五", "六", "日"];

interface Scope {
  view?: TaskView;
  listId?: string;
}

interface EditorHandle {
  flush: () => Promise<boolean>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    Boolean(target.closest("input, textarea, select")) ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.key === "Process" || event.keyCode === 229;
}

function shouldIgnoreAppShortcut(event: KeyboardEvent): boolean {
  return isImeComposing(event) || isEditableTarget(event.target);
}

function isCtrlShortcut(event: KeyboardEvent, key: string): boolean {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === key
  );
}

function dueAtForShortcut(key: "1" | "2" | "3"): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  if (key === "2") {
    date.setDate(date.getDate() + 1);
  } else if (key === "3") {
    const daysUntilNextMonday = ((8 - date.getDay()) % 7) || 7;
    date.setDate(date.getDate() + daysUntilNextMonday);
  }
  return date.toISOString();
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth || 1440);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

function invalidateTaskData(queryClient: ReturnType<typeof useQueryClient>, taskId?: string) {
  void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
  if (taskId) void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
}

function updateTaskListCache(
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

function insertTaskAfter(
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

function removeTaskFromCache(
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

function Shell() {
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
  } | null>(null);

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
  const trashLists = useQuery({
    queryKey: queryKeys.trashLists,
    queryFn: api.trashLists,
    enabled: scope.view === "trash",
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
  const currentTitle = scope.listId ? currentList?.name || "清单" : viewNames[scope.view || "inbox"];

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

  useEffect(() => {
    if (!compactSidebar) setSidebarOverlayOpen(false);
  }, [compactSidebar]);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!shouldIgnoreAppShortcut(event) && isCtrlShortcut(event, "n")) {
        event.preventDefault();
        quickAddRef.current?.focus();
      }
      if (isImeComposing(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (sidebarOverlayOpen) {
          setSidebarOverlayOpen(false);
          return;
        }
        void closeDetail();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDetail, sidebarOverlayOpen]);

  const createTask = useMutation({
    mutationFn: (title: string) =>
      api.createTask({
        title,
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
    async (task: Task, patch: TaskPatch) => {
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

  useEffect(() => {
    const onTaskPropertyShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        isImeComposing(event) ||
        event.metaKey ||
        event.shiftKey ||
        !selectedTaskId ||
        !/^[0-3]$/.test(event.key)
      ) {
        return;
      }
      const task = taskItems.find((item) => item.id === selectedTaskId);
      if (!task || task.deleted_at) return;

      let patch: TaskPatch | undefined;
      if (event.altKey && !event.ctrlKey) {
        patch = {
          priority: priorityShortcutValues[
            Number(event.key)
          ] as Task["priority"],
        };
      } else if (event.ctrlKey && !event.altKey) {
        patch = event.key === "0"
          ? { due_at: null, reminder_at: null }
          : {
              due_at: dueAtForShortcut(event.key as "1" | "2" | "3"),
              is_all_day: true,
              reminder_at: null,
            };
      }
      if (!patch) return;

      event.preventDefault();
      void applyTaskShortcut(task, patch);
    };
    document.addEventListener("keydown", onTaskPropertyShortcut);
    return () => document.removeEventListener("keydown", onTaskPropertyShortcut);
  }, [applyTaskShortcut, selectedTaskId, taskItems]);

  useEffect(() => {
    const onCompleteShortcut = (event: KeyboardEvent) => {
      if (
        shouldIgnoreAppShortcut(event) ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key !== "Enter" ||
        !selectedTaskId
      ) {
        return;
      }
      const task = taskItems.find((item) => item.id === selectedTaskId);
      if (!task || task.deleted_at) return;
      event.preventDefault();
      stateMutation.mutate({
        task,
        action: task.status === 2 ? "reopen" : "complete",
      });
    };
    document.addEventListener("keydown", onCompleteShortcut);
    return () => document.removeEventListener("keydown", onCompleteShortcut);
  }, [selectedTaskId, stateMutation, taskItems]);

  if (health.isPending) {
    return <LoadingScreen />;
  }
  if (health.isError) {
    return (
      <ConnectionError
        message={errorMessage(health.error)}
        onRetry={() => void health.refetch()}
        pending={health.isFetching}
      />
    );
  }

  return (
    <>
      <div
        className={[
          "app-shell",
          effectiveSidebarCollapsed ? "sidebar-collapsed" : "",
          compactSidebar ? "compact-sidebar" : "",
          sidebarOverlayOpen ? "sidebar-overlay-open" : "",
          detailDrawer ? "detail-drawer" : "",
          detailDrawer && !selectedTaskId ? "detail-hidden" : "",
        ].join(" ")}
      >
        <Sidebar
          collapsed={effectiveSidebarCollapsed}
          lists={lists.data || []}
          scope={scope}
          onToggle={toggleSidebar}
          onNavigate={navigateAfterFlush}
          onAdd={() => setListDialog({ mode: "create" })}
          onEdit={(list) => setListDialog({ mode: "rename", list })}
          onColor={(list) => setListDialog({ mode: "color", list })}
          onDelete={(list) =>
            setConfirm({
              title: "删除清单",
              message: `“${list.name}”及其中的任务将进入回收站。`,
              action: () => {
                void api.deleteList(list.id).then(() => {
                  setConfirm(null);
                  invalidateTaskData(queryClient);
                  navigate("/view/inbox");
                });
              },
            })
          }
        />
        {compactSidebar && sidebarOverlayOpen && (
          <button
            className="sidebar-backdrop"
            onClick={() => setSidebarOverlayOpen(false)}
            aria-label="关闭侧栏"
          />
        )}
        <main className="middle-panel">
          <TaskHeader
            title={currentTitle}
            count={taskItems.length}
            search={search}
            sort={sort}
            quickAddRef={quickAddRef}
            createPending={createTask.isPending}
            createError={createTask.error ? errorMessage(createTask.error) : null}
            onSearch={setSearch}
            onSort={setSort}
            onCreate={(title) => createTask.mutate(title)}
          />
          {scope.view === "trash" && (trashLists.data?.length || 0) > 0 && (
            <DeletedLists
              lists={trashLists.data || []}
              onRestore={(id) =>
                void api.restoreList(id).then(() => {
                  void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
                })
              }
              onDelete={(list) =>
                setConfirm({
                  title: "永久删除清单",
                  message: `“${list.name}”及其中仍在回收站的任务将被永久删除，此操作不可撤销。`,
                  action: () => {
                    void api.permanentDeleteList(list.id).then(() => {
                      setConfirm(null);
                      void queryClient.invalidateQueries({ queryKey: queryKeys.trashLists });
                      invalidateTaskData(queryClient);
                    });
                  },
                })
              }
            />
          )}
          <TaskListPanel
            tasks={taskItems}
            activeTaskId={selectedTaskId}
            view={scope.view}
            loading={tasks.isPending}
            error={tasks.error}
            hasNext={tasks.hasNextPage}
            fetchingNext={tasks.isFetchingNextPage}
            onLoadMore={() => void tasks.fetchNextPage()}
            onSelect={openTask}
            onRename={renameTask}
            onCreateNext={createInlineTask}
            onDeleteEmpty={deleteInlineTask}
            onClearSelection={closeDetail}
            onDelete={(task) =>
              setConfirm({
                title: "删除任务",
                message: "任务将进入回收站，你可以稍后恢复。",
                action: () => {
                  setConfirm(null);
                  deleteTaskMutation.mutate(task.id);
                },
              })
            }
            onRestore={(task) => restoreTaskMutation.mutate(task.id)}
            onPermanentDelete={(task) =>
              setConfirm({
                title: "永久删除任务",
                message: "任务、检查项和标签关联将被永久删除，此操作不可撤销。",
                action: () => {
                  setConfirm(null);
                  permanentTaskMutation.mutate(task.id);
                },
              })
            }
            onToggle={(task) =>
              stateMutation.mutate({
                task,
                action: task.status === 2 ? "reopen" : "complete",
              })
            }
          />
        </main>
        {detailDrawer && selectedTaskId && (
          <button
            className="detail-backdrop"
            onClick={() => void closeDetail()}
            aria-label="关闭详情抽屉"
          />
        )}
        <aside className="detail-panel">
          {selectedTaskId ? (
            <TaskDetail
              ref={editorRef}
              taskId={selectedTaskId}
              lists={lists.data || []}
              tags={tags.data || []}
              onClose={closeDetail}
              onDataChanged={() => invalidateTaskData(queryClient, selectedTaskId)}
            />
          ) : (
            <div className="detail-empty">
              <ListChecks size={42} />
              <span>选择一个任务查看详情</span>
            </div>
          )}
        </aside>
      </div>
      {listDialog && (
        <ListDialog
          key={`${listDialog.mode}:${listDialog.list?.id || "new"}`}
          mode={listDialog.mode}
          list={listDialog.list}
          onClose={() => setListDialog(null)}
          onSubmit={async ({ name, color }) => {
            if (listDialog.mode === "create") {
              await api.createList({ name, color });
            } else if (listDialog.list && listDialog.mode === "rename") {
              await api.updateList(listDialog.list.id, { name });
            } else if (listDialog.list) {
              await api.updateList(listDialog.list.id, { color });
            }
            setListDialog(null);
            await queryClient.invalidateQueries({ queryKey: queryKeys.lists });
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.action}
        />
      )}
    </>
  );
}

function Sidebar({
  collapsed,
  lists,
  scope,
  onToggle,
  onNavigate,
  onAdd,
  onEdit,
  onColor,
  onDelete,
}: {
  collapsed: boolean;
  lists: TaskList[];
  scope: Scope;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  onAdd: () => void;
  onEdit: (list: TaskList) => void;
  onColor: (list: TaskList) => void;
  onDelete: (list: TaskList) => void;
}) {
  return (
    <nav className="sidebar" aria-label="任务导航">
      <div className="sidebar-header">
        {!collapsed && (
          <>
            <div className="logo">AI</div>
            <strong>AI 清单</strong>
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="icon-button sidebar-toggle"
          onClick={onToggle}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </Button>
      </div>
      <div className="nav-section">
        {(Object.keys(viewNames) as TaskView[]).map((view) => {
          const Icon = viewIcons[view];
          return (
            <Button
              key={view}
              variant="ghost"
              className={`nav-item ${scope.view === view ? "active" : ""}`}
              onClick={() => void onNavigate(`/view/${view}`)}
              title={viewNames[view]}
            >
              <Icon />
              {!collapsed && <span>{viewNames[view]}</span>}
            </Button>
          );
        })}
      </div>
      <div className="sidebar-divider" />
      {!collapsed && (
        <div className="lists-heading">
          <span>清单</span>
          <Button variant="ghost" size="icon-sm" className="icon-button" onClick={onAdd} aria-label="新建清单">
            <Plus />
          </Button>
        </div>
      )}
      <TooltipProvider delayDuration={80} skipDelayDuration={100}>
        <div className="nav-section custom-lists">
          {lists
            .filter((item) => !item.system_type)
            .map((list) => (
              <div className="custom-list-wrap" key={list.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      className={`nav-item ${scope.listId === list.id ? "active" : ""}`}
                      onClick={() => void onNavigate(`/list/${list.id}`)}
                      title={collapsed ? undefined : list.name}
                      aria-label={collapsed ? `${list.name}，${list.task_count} 个任务` : undefined}
                    >
                      {collapsed ? (
                        <span
                          className="collapsed-list-mark"
                          style={{ "--list-color": list.color } as React.CSSProperties}
                          aria-hidden="true"
                        >
                          {Array.from(list.name.trim())[0]?.toUpperCase() || "·"}
                        </span>
                      ) : (
                        <>
                          <span className="list-dot" style={{ backgroundColor: list.color }} />
                          <span className="nav-label">{list.name}</span>
                          <span className="nav-count">{list.task_count}</span>
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right" align="center" className="list-tooltip">
                      <strong>{list.name}</strong>
                      <span>{list.task_count} 个任务</span>
                    </TooltipContent>
                  )}
                </Tooltip>
                {!collapsed && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="icon-button list-menu-button"
                        aria-label={`管理清单 ${list.name}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      aria-label={`清单 ${list.name} 操作`}
                    >
                      <DropdownMenuItem onSelect={() => onEdit(list)}>重命名</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onColor(list)}>更改颜色</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => onDelete(list)}>
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
        </div>
      </TooltipProvider>
    </nav>
  );
}

function TaskHeader({
  title,
  count,
  search,
  sort,
  quickAddRef,
  createPending,
  createError,
  onSearch,
  onSort,
  onCreate,
}: {
  title: string;
  count: number;
  search: string;
  sort: TaskSort;
  quickAddRef: React.RefObject<HTMLInputElement | null>;
  createPending: boolean;
  createError: string | null;
  onSearch: (value: string) => void;
  onSort: (sort: TaskSort) => void;
  onCreate: (title: string) => void;
}) {
  const [titleInput, setTitleInput] = useState("");
  const [searchOpen, setSearchOpen] = useState(Boolean(search));
  const searchRef = useRef<HTMLInputElement>(null);
  const sortOptions: [TaskSort, string][] = [
    ["manual", "手动"],
    ["created_desc", "最新"],
    ["created_asc", "最早"],
    ["due_asc", "截止"],
    ["priority_desc", "优先级"],
  ];
  const currentSortLabel = sortOptions.find(([value]) => value === sort)?.[1] || "手动";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldIgnoreAppShortcut(event) && isCtrlShortcut(event, "f")) {
        event.preventDefault();
        setSearchOpen(true);
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (isImeComposing(event)) return;
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        event.stopPropagation();
        if (!search) setSearchOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [search, searchOpen]);

  useEffect(() => {
    if (searchOpen) window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchOpen]);

  return (
    <header className="middle-header">
      <div className="title-row">
        <div>
          <h1>{title}</h1>
          <span>{count} 个任务</span>
        </div>
        <div className="header-tools">
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("icon-button", searchOpen && "active")}
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="展开搜索"
            aria-expanded={searchOpen}
          >
            <Search />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="sort-trigger"
                type="button"
                aria-label="选择排序方式"
              >
                <SlidersHorizontal />
                <span>{currentSortLabel}</span>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label="任务排序">
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) => onSort(value as TaskSort)}
              >
                {sortOptions.map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <form
        className="quick-add"
        onSubmit={(event) => {
          event.preventDefault();
          const cleaned = titleInput.trim();
          if (!cleaned) return;
          onCreate(cleaned);
          setTitleInput("");
        }}
      >
        {createPending ? <LoaderCircle className="spin" /> : <Plus />}
        <Input
          ref={quickAddRef}
          className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
          value={titleInput}
          onChange={(event) => setTitleInput(event.target.value)}
          placeholder="快速添加任务，回车提交"
          aria-label="快速添加任务"
        />
      </form>
      {createError && <div className="inline-error">{createError}</div>}
      {searchOpen && (
        <div className="search-field">
          <Search />
          <Input
            ref={searchRef}
            className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="搜索任务..."
            aria-label="搜索任务"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="icon-button"
            type="button"
            onClick={() => {
              if (search) {
                onSearch("");
                searchRef.current?.focus();
              } else {
                setSearchOpen(false);
              }
            }}
            aria-label={search ? "清除搜索" : "关闭搜索"}
          >
            <X />
          </Button>
        </div>
      )}
    </header>
  );
}

function TaskListPanel({
  tasks,
  activeTaskId,
  view,
  loading,
  error,
  hasNext,
  fetchingNext,
  onLoadMore,
  onSelect,
  onRename,
  onCreateNext,
  onDeleteEmpty,
  onClearSelection,
  onDelete,
  onRestore,
  onPermanentDelete,
  onToggle,
}: {
  tasks: Task[];
  activeTaskId?: string;
  view?: TaskView;
  loading: boolean;
  error: unknown;
  hasNext: boolean;
  fetchingNext: boolean;
  onLoadMore: () => void;
  onSelect: (id: string) => void;
  onRename: (task: Task, title: string) => Promise<Task>;
  onCreateNext: (afterTask: Task, sortOrder: number) => Promise<Task>;
  onDeleteEmpty: (task: Task) => Promise<void>;
  onClearSelection: () => void;
  onDelete: (task: Task) => void;
  onRestore: (task: Task) => void;
  onPermanentDelete: (task: Task) => void;
  onToggle: (task: Task) => void;
}) {
  const [editingTaskId, setEditingTaskId] = useState<string>();
  const [editTitle, setEditTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!editingTaskId) return;
    const input = editInputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [activeTaskId, editingTaskId]);

  const beginEditing = (task: Task) => {
    if (view === "trash") return;
    setInlineError("");
    setEditingTaskId(task.id);
    setEditTitle(task.title);
  };

  const finishEditing = async (task: Task, createNext: boolean) => {
    if (saving) return;
    const cleaned = editTitle.trim();
    setInlineError("");
    setSaving(true);
    try {
      if (cleaned !== task.title) await onRename(task, cleaned);
      if (createNext) {
        const taskIndex = tasks.findIndex((item) => item.id === task.id);
        const nextTask = tasks
          .slice(taskIndex + 1)
          .find((item) => item.list_id === task.list_id);
        const sortOrder = nextTask
          ? Math.floor((task.sort_order + nextTask.sort_order) / 2)
          : task.sort_order + 1024;
        const created = await onCreateNext(
          cleaned === task.title ? task : { ...task, title: cleaned },
          sortOrder,
        );
        setEditingTaskId(created.id);
        setEditTitle("");
        void onSelect(created.id);
      } else {
        setEditingTaskId(undefined);
      }
    } catch (saveError) {
      setInlineError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const deleteEmptyTask = async (task: Task) => {
    if (saving) return;
    const taskIndex = tasks.findIndex((item) => item.id === task.id);
    const previousTask = tasks[taskIndex - 1];
    setInlineError("");
    setSaving(true);
    try {
      await onDeleteEmpty(task);
      if (previousTask) {
        setEditingTaskId(previousTask.id);
        setEditTitle(previousTask.title);
        void onSelect(previousTask.id);
      } else {
        setEditingTaskId(undefined);
        setEditTitle("");
        void onClearSelection();
      }
    } catch (deleteError) {
      setInlineError(errorMessage(deleteError));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PanelState icon={<LoaderCircle className="spin" />} title="正在加载任务" />;
  if (error) return <PanelState icon={<CircleAlert />} title="任务加载失败" description={errorMessage(error)} />;
  if (!tasks.length) {
    const messages: Record<TaskView, [string, string]> = {
      inbox: ["收集箱为空", "快速添加一个任务开始吧"],
      today: ["今天没有任务", "享受轻松的一天"],
      all: ["还没有任务", "点击上方快速添加"],
      completed: ["还没有已完成的任务", "完成一个任务试试"],
      trash: ["回收站为空", "删除的任务会出现在这里"],
    };
    const [title, description] = messages[view || "all"];
    return <PanelState icon={<Archive />} title={title} description={description} />;
  }
  return (
    <div
      className="task-list"
      onScroll={(event) => {
        const node = event.currentTarget;
        if (hasNext && node.scrollHeight - node.scrollTop - node.clientHeight < 80) onLoadMore();
      }}
    >
      {tasks.map((task) => {
        const editing = editingTaskId === task.id;
        const actionItems = view === "trash"
          ? (
              <>
                <ContextMenuItem onSelect={() => onRestore(task)}>
                  <RotateCcw /> 恢复
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => onPermanentDelete(task)}
                >
                  <Trash2 /> 永久删除
                </ContextMenuItem>
              </>
            )
          : (
              <ContextMenuItem variant="destructive" onSelect={() => onDelete(task)}>
                <Trash2 /> 删除
              </ContextMenuItem>
            );
        return (
          <ContextMenu key={task.id}>
            <ContextMenuTrigger asChild>
              <div
                role={editing ? undefined : "button"}
                tabIndex={editing ? undefined : 0}
                aria-label={editing ? undefined : `编辑任务 ${task.title}`}
                className={`task-row ${editing ? "editing" : ""} ${activeTaskId === task.id ? "active" : ""} ${task.status === 2 ? "completed" : ""}`}
                onClick={() => {
                  if (!editing) {
                    beginEditing(task);
                    void onSelect(task.id);
                  }
                }}
                onKeyDown={(event) => {
                  if (!editing && event.key === "Enter") {
                    event.preventDefault();
                    beginEditing(task);
                    void onSelect(task.id);
                  }
                }}
              >
                {view !== "trash" && (
                  <Checkbox
                    checked={task.status === 2}
                    aria-label={task.status === 2 ? "重新打开任务" : "完成任务"}
                    className={`checkbox task-checkbox ${
                      task.priority > 0 ? `has-priority priority-${task.priority}` : ""
                    } ${task.status === 2 ? "checked" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                    onCheckedChange={() => onToggle(task)}
                  />
                )}
                {editing ? (
                  <Input
                    ref={editInputRef}
                    className="task-title-input"
                    value={editTitle}
                    aria-label="编辑任务标题"
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setEditTitle(event.target.value)}
                    onBlur={() => void finishEditing(task, false)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void finishEditing(task, true);
                      }
                      if (
                        (event.key === "Backspace" || event.key === "Delete") &&
                        !event.nativeEvent.isComposing &&
                        editTitle.length === 0
                      ) {
                        event.preventDefault();
                        void deleteEmptyTask(task);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingTaskId(undefined);
                        setEditTitle(task.title);
                        setInlineError("");
                      }
                    }}
                  />
                ) : (
                  <span className="task-title">{task.title}</span>
                )}
                {(task.due_at || (!editing && task.tags.length > 0)) && (
                  <span className="task-meta">
                    {task.due_at && (
                      <span className={`task-date ${dueDateTone(task)}`}>{formatDue(task)}</span>
                    )}
                    {!editing && task.tags.slice(0, 2).map((tag) => (
                      <span className="tag-mini" key={tag.id}>{tag.name}</span>
                    ))}
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="task-more-button"
                      aria-label={`更多操作 ${task.title || "未命名任务"}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {view === "trash" ? (
                      <>
                        <DropdownMenuItem onSelect={() => onRestore(task)}>
                          <RotateCcw /> 恢复
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onPermanentDelete(task)}
                        >
                          <Trash2 /> 永久删除
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => onDelete(task)}
                      >
                        <Trash2 /> 删除
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {actionItems}
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      {inlineError && <div className="inline-error task-list-error">{inlineError}</div>}
      {fetchingNext && <div className="next-page"><LoaderCircle className="spin" /> 加载更多</div>}
    </div>
  );
}

const TaskDetail = forwardRef<EditorHandle, {
  taskId: string;
  lists: TaskList[];
  tags: Tag[];
  onClose: () => void;
  onDataChanged: () => void;
}>(function TaskDetail(
  { taskId, lists, tags, onClose, onDataChanged },
  ref,
) {
  const queryClient = useQueryClient();
  const taskQuery = useQuery({ queryKey: queryKeys.task(taskId), queryFn: () => api.task(taskId) });
  const [draft, setDraft] = useState<Task | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "dirty" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [tagMenu, setTagMenu] = useState(false);
  const pendingRef = useRef<TaskPatch>({});
  const timerRef = useRef<number | undefined>(undefined);
  const taskIdRef = useRef(taskId);
  const loadedTaskIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    taskIdRef.current = taskId;
    if (taskQuery.data) {
      const isNewTask = loadedTaskIdRef.current !== taskId;
      loadedTaskIdRef.current = taskId;
      setDraft(taskQuery.data);
      pendingRef.current = {};
      if (isNewTask) setSaveState("idle");
    }
  }, [taskId, taskQuery.data]);

  const savePending = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timerRef.current);
    const patch = pendingRef.current;
    if (!Object.keys(patch).length) return true;
    pendingRef.current = {};
    const savingTaskId = taskIdRef.current;
    setSaveState("saving");
    try {
      const saved = await api.updateTask(savingTaskId, patch);
      if (taskIdRef.current === savingTaskId) {
        setDraft(saved);
        queryClient.setQueryData(queryKeys.task(saved.id), saved);
        setSaveState("saved");
        onDataChanged();
      }
      return true;
    } catch (error) {
      pendingRef.current = { ...patch, ...pendingRef.current };
      if (taskIdRef.current === savingTaskId) {
        setSaveError(errorMessage(error));
        setSaveState("error");
      }
      return false;
    }
  }, [onDataChanged, queryClient]);

  useImperativeHandle(ref, () => ({ flush: savePending }), [savePending]);

  const schedule = <K extends keyof TaskPatch>(key: K, value: TaskPatch[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } as Task : current);
    if (key === "priority") {
      updateTaskListCache(queryClient, taskIdRef.current, {
        priority: value as Task["priority"],
      });
    }
    pendingRef.current = { ...pendingRef.current, [key]: value };
    setSaveState("dirty");
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void savePending(), 500);
  };

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const refreshDetail = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
    onDataChanged();
  };

  const checklistMutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: refreshDetail,
  });

  if (taskQuery.isPending || !draft) {
    return <PanelState icon={<LoaderCircle className="spin" />} title="正在加载详情" />;
  }
  if (taskQuery.isError) {
    return <PanelState icon={<CircleAlert />} title="详情加载失败" description={errorMessage(taskQuery.error)} />;
  }

  const readOnly = Boolean(draft.deleted_at);
  const selectedTagIds = new Set(draft.tags.map((tag) => tag.id));

  return (
    <div className="detail-content">
      <div className="detail-toolbar">
        <span>任务详情</span>
        <Button variant="ghost" size="icon-sm" className="icon-button" onClick={() => void onClose()} aria-label="关闭任务详情"><X /></Button>
      </div>
      <Input
        className="detail-title-input"
        value={draft.title}
        disabled={readOnly}
        onChange={(event) => schedule("title", event.target.value)}
        aria-label="任务标题"
      />
      <div className="detail-properties">
        <DetailField label="截止日期" icon={<CalendarDays />}>
          <div className="date-row">
            <DateTimePicker
              label="截止日期"
              value={draft.due_at}
              allDay={draft.is_all_day}
              disabled={readOnly}
              onChange={(value) => schedule("due_at", value)}
            />
            <Label className="all-day-toggle">
              <Checkbox
                checked={draft.is_all_day}
                disabled={readOnly}
                onCheckedChange={(checked) => schedule("is_all_day", checked === true)}
                aria-label="全天"
              />
              全天
            </Label>
            {draft.due_at && !readOnly && (
              <Button variant="ghost" size="icon-sm" className="icon-button" onClick={() => { schedule("due_at", null); schedule("reminder_at", null); }} aria-label="清除截止日期"><X /></Button>
            )}
          </div>
        </DetailField>
        <DetailField label="提醒时间" icon={<Bell />}>
          <div className="date-row">
            <DateTimePicker
              label="提醒时间"
              value={draft.reminder_at}
              disabled={readOnly || !draft.due_at}
              max={draft.due_at}
              onChange={(value) => schedule("reminder_at", value)}
            />
            {draft.reminder_at && !readOnly && (
              <Button variant="ghost" size="icon-sm" className="icon-button" onClick={() => schedule("reminder_at", null)} aria-label="清除提醒时间"><X /></Button>
            )}
          </div>
        </DetailField>
        <DetailField label="优先级" icon={<Star />}>
          <Select
            value={String(draft.priority)}
            disabled={readOnly}
            onValueChange={(value) => schedule("priority", Number(value) as 0 | 1 | 3 | 5)}
          >
            <SelectTrigger className="detail-select" size="sm" aria-label="优先级">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 3, 5].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {priorityLabels[value as 0 | 1 | 3 | 5]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DetailField>
        <DetailField label="所属清单" icon={<List />}>
          <Select
            value={draft.list_id}
            disabled={readOnly}
            onValueChange={(value) => schedule("list_id", value)}
          >
            <SelectTrigger className="detail-select" size="sm" aria-label="所属清单">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lists.map((list) => <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </DetailField>
        <DetailField label="标签" icon={<TagIcon />}>
          <div className="tags-row">
            {draft.tags.map((tag) => (
              <Badge variant="secondary" className="tag-pill" key={tag.id}>
                <span className="tag-dot" style={{ backgroundColor: tag.color }} />
                {tag.name}
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => schedule("tag_ids", draft.tags.filter((item) => item.id !== tag.id).map((item) => item.id))}
                    aria-label={`移除标签 ${tag.name}`}
                  ><X /></Button>
                )}
              </Badge>
            ))}
            {!readOnly && (
              <Popover open={tagMenu} onOpenChange={setTagMenu}>
                <PopoverTrigger asChild>
                  <Button variant="secondary" size="sm" className="add-tag-button">
                    <Plus /> 添加
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="tag-popover">
                  <TagMenu
                    tags={tags}
                    selected={selectedTagIds}
                    onToggle={(tagId) => {
                      const next = new Set(selectedTagIds);
                      if (next.has(tagId)) next.delete(tagId); else next.add(tagId);
                      schedule("tag_ids", [...next]);
                      setDraft((current) => current ? { ...current, tags: tags.filter((tag) => next.has(tag.id)) } : current);
                    }}
                    onCreated={(tag) => {
                      queryClient.setQueryData<Tag[]>(queryKeys.tags, (old) => [...(old || []), tag]);
                      schedule("tag_ids", [...selectedTagIds, tag.id]);
                      setDraft((current) => current ? { ...current, tags: [...current.tags, tag] } : current);
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>
        </DetailField>
      </div>
      <Label className="detail-block">
        <span className="field-label">描述</span>
        <Textarea
          value={draft.description}
          disabled={readOnly}
          onChange={(event) => schedule("description", event.target.value)}
          placeholder="添加描述..."
          aria-label="任务描述"
        />
      </Label>
      {!readOnly && (
        <ChecklistEditor
          taskId={draft.id}
          items={draft.checklist_items}
          mutation={checklistMutation}
        />
      )}
      {!readOnly && (
        <SaveStatus
          state={saveState}
          error={saveError}
          onRetry={() => void savePending()}
        />
      )}
    </div>
  );
});

function DateTimePicker({
  label,
  value,
  allDay = false,
  disabled = false,
  max = null,
  onChange,
}: {
  label: string;
  value: string | null;
  allDay?: boolean;
  disabled?: boolean;
  max?: string | null;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(pickerBaseDate(value, max)));
  const [time, setTime] = useState(() => formatTimeInput(pickerBaseDate(value, max)));

  const setPickerOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      const baseDate = pickerBaseDate(value, max);
      setVisibleMonth(monthStart(baseDate));
      setTime(formatTimeInput(baseDate));
    }
    setOpen(nextOpen);
  };

  const days = calendarDays(visibleMonth);
  const selectedDate = value ? new Date(value) : null;
  const maxDate = max ? new Date(max) : null;

  const selectDate = (day: Date) => {
    const [hours, minutes] = allDay ? [0, 0] : parseTimeInput(time);
    let selected = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      hours,
      minutes,
    );
    if (maxDate && selected > maxDate) selected = maxDate;
    onChange(selected.toISOString());
    setOpen(false);
  };

  return (
    <div className="date-picker">
      <Popover open={open} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={cn("date-trigger", !value && "placeholder")}
            disabled={disabled}
            aria-label={label}
          >
            {formatPickerValue(value, allDay)}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="date-picker-popover"
          align="start"
          role="dialog"
          aria-label={`${label}选择器`}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <div className="date-picker-header">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="icon-button"
              onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
              aria-label="上个月"
            >
              <ChevronLeft />
            </Button>
            <strong>{visibleMonth.getFullYear()}年{visibleMonth.getMonth() + 1}月</strong>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="icon-button"
              onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
              aria-label="下个月"
            >
              <ChevronRight />
            </Button>
          </div>
          {!allDay && (
            <Label className="date-picker-time">
              时间
              <Input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                aria-label={`${label}时间`}
              />
            </Label>
          )}
          <div className="date-picker-weekdays" aria-hidden="true">
            {weekDayLabels.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="date-picker-grid">
            {days.map((day) => {
              const outsideMonth = day.getMonth() !== visibleMonth.getMonth();
              const selected = selectedDate ? isSameLocalDay(day, selectedDate) : false;
              const unavailable = maxDate ? isLocalDayAfter(day, maxDate) : false;
              return (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={[
                    "date-picker-day",
                    outsideMonth ? "outside-month" : "",
                    selected ? "selected" : "",
                  ].filter(Boolean).join(" ")}
                  key={day.toISOString()}
                  disabled={unavailable}
                  aria-label={formatDayLabel(day)}
                  aria-pressed={selected}
                  onClick={() => selectDate(day)}
                >
                  {day.getDate()}
                </Button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function DetailField({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="detail-field">
      <span className="field-icon">{icon}</span>
      <span className="detail-field-label">{label}</span>
      <div className="detail-field-value">{children}</div>
    </div>
  );
}

function ChecklistEditor({
  taskId,
  items,
  mutation,
}: {
  taskId: string;
  items: ChecklistItem[];
  mutation: ReturnType<typeof useMutation<unknown, Error, () => Promise<unknown>>>;
}) {
  const [newTitle, setNewTitle] = useState("");
  const ordered = [...items].sort((a, b) => a.sort_order - b.sort_order);
  const move = (index: number, direction: -1 | 1) => {
    const next = [...ordered];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    mutation.mutate(() => api.reorderItems(taskId, next.map((item) => item.id)));
  };
  return (
    <section className="checklist-section">
      <div className="field-label">检查项 ({items.filter((item) => item.is_completed).length}/{items.length})</div>
      {ordered.map((item, index) => (
        <div className={`checklist-item ${item.is_completed ? "completed" : ""}`} key={item.id}>
          <Checkbox
            checked={item.is_completed}
            className={`checkbox ${item.is_completed ? "checked" : ""}`}
            aria-label={item.is_completed ? "取消完成检查项" : "完成检查项"}
            onCheckedChange={() => mutation.mutate(() => api.updateItem(taskId, item.id, { is_completed: !item.is_completed }))}
          />
          <Input
            defaultValue={item.title}
            className="checklist-title-input"
            aria-label="检查项标题"
            onBlur={(event) => {
              const title = event.target.value.trim();
              if (title && title !== item.title) mutation.mutate(() => api.updateItem(taskId, item.id, { title }));
            }}
          />
          <Button variant="ghost" size="icon-sm" className="icon-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="上移检查项"><ArrowUp /></Button>
          <Button variant="ghost" size="icon-sm" className="icon-button" disabled={index === ordered.length - 1} onClick={() => move(index, 1)} aria-label="下移检查项"><ArrowDown /></Button>
          <Button variant="ghost" size="icon-sm" className="icon-button danger-text" onClick={() => mutation.mutate(() => api.deleteItem(taskId, item.id))} aria-label="删除检查项"><X /></Button>
        </div>
      ))}
      <form
        className="add-checklist"
        onSubmit={(event) => {
          event.preventDefault();
          const title = newTitle.trim();
          if (!title) return;
          mutation.mutate(() => api.createItem(taskId, title));
          setNewTitle("");
        }}
      >
        <Plus />
        <Input
          className="add-checklist-input"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder="添加检查项"
          aria-label="添加检查项"
        />
      </form>
      {mutation.isError && <div className="inline-error">{errorMessage(mutation.error)}</div>}
    </section>
  );
}

function TagMenu({
  tags,
  selected,
  onToggle,
  onCreated,
}: {
  tags: Tag[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onCreated: (tag: Tag) => void;
}) {
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.createTag({ name: name.trim(), color: tagColors[tags.length % tagColors.length] }),
    onSuccess: (tag) => { setName(""); onCreated(tag); },
  });
  return (
    <div className="tag-menu">
      {tags.map((tag) => (
        <Label key={tag.id} className="tag-menu-item">
          <Checkbox checked={selected.has(tag.id)} onCheckedChange={() => onToggle(tag.id)} />
          <span className="tag-dot" style={{ backgroundColor: tag.color }} />
          {tag.name}
        </Label>
      ))}
      <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate(); }}>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="新标签名称" maxLength={50} />
        <Button variant="ghost" size="icon-sm" className="icon-button" aria-label="创建标签"><Plus /></Button>
      </form>
      {create.isError && <div className="inline-error">{errorMessage(create.error)}</div>}
    </div>
  );
}

function SaveStatus({ state, error, onRetry }: { state: string; error: string; onRetry: () => void }) {
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (state !== "saved") {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const timer = window.setTimeout(() => setShowSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (state === "idle" || (state === "saved" && !showSaved)) return null;
  if (state === "saved") return <div className="save-status saved"><Check /> 已保存</div>;
  if (state === "saving") return <div className="save-status saving"><LoaderCircle className="spin" /> 保存中</div>;
  if (state === "dirty") return <div className="save-status dirty"><span /> 已修改</div>;
  return <div className="save-status error"><CircleAlert /> {error}<Button variant="link" size="sm" onClick={onRetry}>重试</Button></div>;
}

function DeletedLists({ lists, onRestore, onDelete }: { lists: TaskList[]; onRestore: (id: string) => void; onDelete: (list: TaskList) => void }) {
  return (
    <section className="deleted-lists">
      <span className="field-label">已删除清单</span>
      {lists.map((list) => (
        <div key={list.id}>
          <span className="list-dot" style={{ backgroundColor: list.color }} />
          <span>{list.name}</span>
          <Button variant="ghost" size="sm" onClick={() => onRestore(list.id)}><RotateCcw /> 恢复</Button>
          <Button variant="ghost" size="sm" className="danger-text" onClick={() => onDelete(list)}><Trash2 /> 永久删除</Button>
        </div>
      ))}
    </section>
  );
}

function ListDialog({
  mode,
  list,
  onClose,
  onSubmit,
}: {
  mode: "create" | "rename" | "color";
  list?: TaskList;
  onClose: () => void;
  onSubmit: (values: { name: string; color: string }) => Promise<void>;
}) {
  const [name, setName] = useState(list?.name || "");
  const [color, setColor] = useState(list?.color || tagColors[0]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const title =
    mode === "create" ? "新建清单" : mode === "rename" ? "重命名清单" : "更改清单颜色";
  const description =
    mode === "create"
      ? "创建一个清单来组织相关任务。"
      : mode === "rename"
        ? "输入新的清单名称。"
        : "选择一个便于识别的清单颜色。";

  const submit = async () => {
    const cleaned = name.trim();
    if (!cleaned || !/^#[0-9a-f]{6}$/i.test(color)) return;
    setPending(true);
    setError("");
    try {
      await onSubmit({ name: cleaned, color });
    } catch (submitError) {
      setPending(false);
      setError(errorMessage(submitError));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="list-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {mode !== "color" && (
            <div className="form-field">
              <Label htmlFor="list-name">名称</Label>
              <Input
                id="list-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                placeholder="例如：工作、购物、学习"
              />
            </div>
          )}
          {mode !== "rename" && (
            <div className="form-field">
              <Label>颜色</Label>
              <div className="color-options">
                {tagColors.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={cn("color-option", color === option && "selected")}
                    style={{ backgroundColor: option }}
                    onClick={() => setColor(option)}
                    aria-label={`选择颜色 ${option}`}
                    aria-pressed={color === option}
                  />
                ))}
                <Input
                  type="color"
                  className="color-input"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  aria-label="自定义清单颜色"
                />
              </div>
            </div>
          )}
          {error && <div className="inline-error">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              取消
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending && <LoaderCircle className="spin" />}
              {mode === "create" ? "创建" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({ title, message, onCancel, onConfirm }: { title: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>确认</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PanelState({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return <div className="panel-state"><div>{icon}</div><strong>{title}</strong>{description && <span>{description}</span>}</div>;
}

function LoadingScreen() {
  return <div className="full-screen-state"><LoaderCircle className="spin" /><span>正在连接服务</span></div>;
}

function ConnectionError({ message, onRetry, pending }: { message: string; onRetry: () => void; pending: boolean }) {
  return (
    <div className="full-screen-state connection-error">
      <WifiOff />
      <h1>无法连接到服务</h1>
      <p>{message}</p>
      <p>请确认 API 服务已启动并运行在 http://127.0.0.1:8000</p>
      <Button className="primary-button" onClick={onRetry} disabled={pending}>{pending ? <LoaderCircle className="spin" /> : <RefreshCw />} 重试连接</Button>
    </div>
  );
}

function formatDue(task: Task): string {
  if (!task.due_at) return "";
  const date = new Date(task.due_at);
  const today = new Date();
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const tomorrowDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  ).getTime();
  if (dateDay === todayDay) return "今天";
  if (dateDay === tomorrowDay) return "明天";
  return new Intl.DateTimeFormat("zh-CN", task.is_all_day
    ? { month: "numeric", day: "numeric" }
    : { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function dueDateTone(task: Task): string {
  if (!task.due_at || task.status === 2) return "";
  const due = new Date(task.due_at);
  const today = new Date();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (dueDay < todayDay) return "overdue";
  if (dueDay === todayDay) return "due-today";
  return "";
}

function pickerBaseDate(value: string | null, max: string | null): Date {
  return new Date(value || max || Date.now());
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function calendarDays(month: Date): Date[] {
  const firstDay = monthStart(month);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  return Array.from(
    { length: 42 },
    (_, index) => new Date(
      firstDay.getFullYear(),
      firstDay.getMonth(),
      index - mondayOffset + 1,
    ),
  );
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isLocalDayAfter(day: Date, max: Date): boolean {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() >
    new Date(max.getFullYear(), max.getMonth(), max.getDate()).getTime();
}

function formatTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseTimeInput(value: string): [number, number] {
  const [hours = "0", minutes = "0"] = value.split(":");
  return [Number(hours), Number(minutes)];
}

function formatPickerValue(value: string | null, allDay: boolean): string {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat(
    "zh-CN",
    allDay
      ? { year: "numeric", month: "numeric", day: "numeric" }
      : {
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        },
  ).format(new Date(value));
}

function formatDayLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export default function App() {
  return (
    <Routes>
      <Route path="/view/:view" element={<Shell />} />
      <Route path="/list/:listId" element={<Shell />} />
      <Route path="*" element={<Navigate to="/view/inbox" replace />} />
    </Routes>
  );
}
