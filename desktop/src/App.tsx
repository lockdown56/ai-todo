import {
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
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "./api";
import { queryKeys } from "./query";
import type {
  ChecklistItem,
  Tag,
  Task,
  TaskList,
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
const tagColors = ["#6C5CE7", "#4F8EF7", "#F0C45A", "#E67E3A", "#44A06B", "#D95550"];
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

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function invalidateTaskData(queryClient: ReturnType<typeof useQueryClient>, taskId?: string) {
  void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
  if (taskId) void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
}

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const queryClient = useQueryClient();
  const editorRef = useRef<EditorHandle>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("todo-sidebar-collapsed") === "true",
  );
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [sort, setSort] = useState<TaskSort>("manual");
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    action: () => void;
  } | null>(null);
  const [newListOpen, setNewListOpen] = useState(false);

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

  const setCollapsed = () => {
    setSidebarCollapsed((value) => {
      localStorage.setItem("todo-sidebar-collapsed", String(!value));
      return !value;
    });
  };

  const navigateAfterFlush = useCallback(
    async (target: string) => {
      if (editorRef.current && !(await editorRef.current.flush())) return;
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
      if (event.ctrlKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        quickAddRef.current?.focus();
      }
      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        void closeDetail();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDetail]);

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

  const stateMutation = useMutation({
    mutationFn: ({ task, action }: { task: Task; action: "complete" | "reopen" }) =>
      action === "complete" ? api.completeTask(task.id) : api.reopenTask(task.id),
    onSuccess: (task) => invalidateTaskData(queryClient, task.id),
  });

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
    const onCompleteShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey && event.key === "Enter") || !selectedTaskId) return;
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
          sidebarCollapsed ? "sidebar-collapsed" : "",
          selectedTaskId ? "" : "detail-hidden",
        ].join(" ")}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          lists={lists.data || []}
          scope={scope}
          onToggle={setCollapsed}
          onNavigate={navigateAfterFlush}
          onAdd={() => setNewListOpen(true)}
          onEdit={(list) => {
            const name = window.prompt("清单名称", list.name)?.trim();
            if (!name) return;
            void api
              .updateList(list.id, { name })
              .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.lists }));
          }}
          onColor={(list) => {
            const color = window.prompt("清单颜色（#RRGGBB）", list.color)?.trim();
            if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return;
            void api
              .updateList(list.id, { color })
              .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.lists }));
          }}
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
        <main className="middle-panel">
          <TaskHeader
            title={currentTitle}
            count={taskItems.length}
            search={search}
            sort={sort}
            searchRef={searchRef}
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
            onToggle={(task) =>
              stateMutation.mutate({
                task,
                action: task.status === 2 ? "reopen" : "complete",
              })
            }
          />
        </main>
        <aside className="detail-panel">
          {selectedTaskId ? (
            <TaskDetail
              ref={editorRef}
              taskId={selectedTaskId}
              lists={lists.data || []}
              tags={tags.data || []}
              onClose={closeDetail}
              onDataChanged={() => invalidateTaskData(queryClient, selectedTaskId)}
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
          ) : (
            <div className="detail-empty">
              <ListChecks size={42} />
              <span>选择一个任务查看详情</span>
            </div>
          )}
        </aside>
      </div>
      {newListOpen && (
        <NewListDialog
          onClose={() => setNewListOpen(false)}
          onSubmit={(name, color) =>
            void api.createList({ name, color }).then(() => {
              setNewListOpen(false);
              void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
            })
          }
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
  const [menuId, setMenuId] = useState<string>();
  return (
    <nav className="sidebar" aria-label="任务导航">
      <div className="sidebar-header">
        <div className="logo">T</div>
        {!collapsed && <strong>Todo List</strong>}
        <button className="icon-button sidebar-toggle" onClick={onToggle} aria-label={collapsed ? "展开侧栏" : "收起侧栏"}>
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>
      </div>
      <div className="nav-section">
        {(Object.keys(viewNames) as TaskView[]).map((view) => {
          const Icon = viewIcons[view];
          return (
            <button
              key={view}
              className={`nav-item ${scope.view === view ? "active" : ""}`}
              onClick={() => void onNavigate(`/view/${view}`)}
              title={viewNames[view]}
            >
              <Icon />
              {!collapsed && <span>{viewNames[view]}</span>}
            </button>
          );
        })}
      </div>
      <div className="sidebar-divider" />
      {!collapsed && (
        <div className="lists-heading">
          <span>清单</span>
          <button className="icon-button" onClick={onAdd} aria-label="新建清单">
            <Plus />
          </button>
        </div>
      )}
      <div className="nav-section custom-lists">
        {lists
          .filter((item) => !item.system_type)
          .map((list) => (
            <div className="custom-list-wrap" key={list.id}>
              <button
                className={`nav-item ${scope.listId === list.id ? "active" : ""}`}
                onClick={() => void onNavigate(`/list/${list.id}`)}
                title={list.name}
              >
                <span className="list-dot" style={{ backgroundColor: list.color }} />
                {!collapsed && (
                  <>
                    <span className="nav-label">{list.name}</span>
                    <span className="nav-count">{list.task_count}</span>
                  </>
                )}
              </button>
              {!collapsed && (
                <button
                  className="icon-button list-menu-button"
                  aria-label={`管理清单 ${list.name}`}
                  onClick={() => setMenuId(menuId === list.id ? undefined : list.id)}
                >
                  <MoreHorizontal />
                </button>
              )}
              {menuId === list.id && (
                <div className="popover list-popover">
                  <button onClick={() => { setMenuId(undefined); onEdit(list); }}>重命名</button>
                  <button onClick={() => { setMenuId(undefined); onColor(list); }}>更改颜色</button>
                  <button className="danger-text" onClick={() => { setMenuId(undefined); onDelete(list); }}>删除</button>
                </div>
              )}
            </div>
          ))}
      </div>
    </nav>
  );
}

function TaskHeader({
  title,
  count,
  search,
  sort,
  searchRef,
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
  searchRef: React.RefObject<HTMLInputElement | null>;
  quickAddRef: React.RefObject<HTMLInputElement | null>;
  createPending: boolean;
  createError: string | null;
  onSearch: (value: string) => void;
  onSort: (sort: TaskSort) => void;
  onCreate: (title: string) => void;
}) {
  const [titleInput, setTitleInput] = useState("");
  return (
    <header className="middle-header">
      <div className="title-row">
        <h1>{title}</h1>
        <span>{count} 个任务</span>
      </div>
      <label className="search-field">
        <Search />
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="搜索任务..."
          aria-label="搜索任务"
        />
      </label>
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
        <input
          ref={quickAddRef}
          value={titleInput}
          onChange={(event) => setTitleInput(event.target.value)}
          placeholder="快速添加任务，回车提交"
          aria-label="快速添加任务"
        />
      </form>
      {createError && <div className="inline-error">{createError}</div>}
      <div className="sort-bar" aria-label="任务排序">
        <span>排序:</span>
        {[
          ["manual", "手动"],
          ["created_desc", "最新"],
          ["created_asc", "最早"],
          ["due_asc", "截止"],
          ["priority_desc", "优先级"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={sort === value ? "active" : ""}
            onClick={() => onSort(value as TaskSort)}
          >
            {label}
          </button>
        ))}
      </div>
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
  onToggle: (task: Task) => void;
}) {
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
      {tasks.map((task) => (
        <button
          key={task.id}
          className={`task-row ${activeTaskId === task.id ? "active" : ""} ${task.status === 2 ? "completed" : ""}`}
          onClick={() => void onSelect(task.id)}
        >
          {view !== "trash" && (
            <span
              role="checkbox"
              aria-checked={task.status === 2}
              aria-label={task.status === 2 ? "重新打开任务" : "完成任务"}
              tabIndex={0}
              className={`checkbox ${task.status === 2 ? "checked" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(task);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggle(task);
                }
              }}
            >
              {task.status === 2 && <Check />}
            </span>
          )}
          <span className="task-title">{task.title}</span>
          <span className="task-meta">
            {task.due_at && <span className="task-date">{formatDue(task)}</span>}
            {task.priority > 0 && <span className={`priority priority-${task.priority}`} />}
            {task.tags.slice(0, 2).map((tag) => <span className="tag-mini" key={tag.id}>{tag.name}</span>)}
          </span>
        </button>
      ))}
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
  onDelete: (task: Task) => void;
  onRestore: (task: Task) => void;
  onPermanentDelete: (task: Task) => void;
  onToggle: (task: Task) => void;
}>(function TaskDetail(
  { taskId, lists, tags, onClose, onDataChanged, onDelete, onRestore, onPermanentDelete, onToggle },
  ref,
) {
  const queryClient = useQueryClient();
  const taskQuery = useQuery({ queryKey: queryKeys.task(taskId), queryFn: () => api.task(taskId) });
  const [draft, setDraft] = useState<Task | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const [tagMenu, setTagMenu] = useState(false);
  const pendingRef = useRef<TaskPatch>({});
  const timerRef = useRef<number | undefined>(undefined);
  const taskIdRef = useRef(taskId);

  useEffect(() => {
    taskIdRef.current = taskId;
    if (taskQuery.data) {
      setDraft(taskQuery.data);
      pendingRef.current = {};
      setSaveState("saved");
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
        <button className="icon-button" onClick={() => void onClose()} aria-label="关闭任务详情"><X /></button>
      </div>
      <input
        className="detail-title-input"
        value={draft.title}
        disabled={readOnly}
        onChange={(event) => schedule("title", event.target.value)}
        aria-label="任务标题"
      />
      <DetailField label="截止日期" icon={<CalendarDays />}>
        <div className="date-row">
          <DateTimePicker
            label="截止日期"
            value={draft.due_at}
            allDay={draft.is_all_day}
            disabled={readOnly}
            onChange={(value) => schedule("due_at", value)}
          />
          <label className="all-day-toggle">
            <input
              type="checkbox"
              checked={draft.is_all_day}
              disabled={readOnly}
              onChange={(event) => schedule("is_all_day", event.target.checked)}
            />
            全天
          </label>
          {draft.due_at && !readOnly && (
            <button className="icon-button" onClick={() => { schedule("due_at", null); schedule("reminder_at", null); }} aria-label="清除截止日期"><X /></button>
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
            <button className="icon-button" onClick={() => schedule("reminder_at", null)} aria-label="清除提醒时间"><X /></button>
          )}
        </div>
      </DetailField>
      <DetailField label="优先级" icon={<Star />}>
        <select
          value={draft.priority}
          disabled={readOnly}
          onChange={(event) => schedule("priority", Number(event.target.value) as 0 | 1 | 3 | 5)}
          aria-label="优先级"
        >
          {[0, 1, 3, 5].map((value) => <option key={value} value={value}>{priorityLabels[value as 0 | 1 | 3 | 5]}</option>)}
        </select>
      </DetailField>
      <DetailField label="所属清单" icon={<List />}>
        <select
          value={draft.list_id}
          disabled={readOnly}
          onChange={(event) => schedule("list_id", event.target.value)}
          aria-label="所属清单"
        >
          {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>
      </DetailField>
      <DetailField label="标签" icon={<TagIcon />}>
        <div className="tags-row">
          {draft.tags.map((tag) => (
            <span className="tag-pill" key={tag.id}>
              <span className="tag-dot" style={{ backgroundColor: tag.color }} />
              {tag.name}
              {!readOnly && (
                <button
                  onClick={() => schedule("tag_ids", draft.tags.filter((item) => item.id !== tag.id).map((item) => item.id))}
                  aria-label={`移除标签 ${tag.name}`}
                ><X /></button>
              )}
            </span>
          ))}
          {!readOnly && <button className="add-tag-button" onClick={() => setTagMenu(!tagMenu)}>+ 添加</button>}
          {tagMenu && (
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
          )}
        </div>
      </DetailField>
      <label className="detail-block">
        <span className="field-label">描述</span>
        <textarea
          value={draft.description}
          disabled={readOnly}
          onChange={(event) => schedule("description", event.target.value)}
          placeholder="添加描述..."
          aria-label="任务描述"
        />
      </label>
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
      <div className="detail-actions">
        {readOnly ? (
          <>
            <button className="primary-button" onClick={() => onRestore(draft)}><RotateCcw /> 恢复</button>
            <button className="danger-button" onClick={() => onPermanentDelete(draft)}><Trash2 /> 永久删除</button>
          </>
        ) : (
          <>
            <button className="primary-button" onClick={() => onToggle(draft)}>
              {draft.status === 2 ? <RotateCcw /> : <Check />}
              {draft.status === 2 ? "重新打开" : "完成"}
            </button>
            <button className="danger-button" onClick={() => onDelete(draft)}><Trash2 /> 删除</button>
          </>
        )}
      </div>
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
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(pickerBaseDate(value, max)));
  const [time, setTime] = useState(() => formatTimeInput(pickerBaseDate(value, max)));

  const openPicker = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const baseDate = pickerBaseDate(value, max);
    setVisibleMonth(monthStart(baseDate));
    setTime(formatTimeInput(baseDate));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

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
    triggerRef.current?.focus();
  };

  return (
    <div className="date-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`date-trigger ${value ? "" : "placeholder"}`}
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={openPicker}
      >
        {formatPickerValue(value, allDay)}
      </button>
      {open && (
        <div className="date-picker-popover" role="dialog" aria-label={`${label}选择器`}>
          <div className="date-picker-header">
            <button
              type="button"
              className="icon-button"
              onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
              aria-label="上个月"
            >
              <ChevronLeft />
            </button>
            <strong>{visibleMonth.getFullYear()}年{visibleMonth.getMonth() + 1}月</strong>
            <button
              type="button"
              className="icon-button"
              onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
              aria-label="下个月"
            >
              <ChevronRight />
            </button>
          </div>
          {!allDay && (
            <label className="date-picker-time">
              时间
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                aria-label={`${label}时间`}
              />
            </label>
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
                <button
                  type="button"
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
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="detail-block">
      <span className="field-label">{label}</span>
      <div className="field-control"><span className="field-icon">{icon}</span>{children}</div>
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
          <button
            className={`checkbox ${item.is_completed ? "checked" : ""}`}
            aria-label={item.is_completed ? "取消完成检查项" : "完成检查项"}
            onClick={() => mutation.mutate(() => api.updateItem(taskId, item.id, { is_completed: !item.is_completed }))}
          >{item.is_completed && <Check />}</button>
          <input
            defaultValue={item.title}
            aria-label="检查项标题"
            onBlur={(event) => {
              const title = event.target.value.trim();
              if (title && title !== item.title) mutation.mutate(() => api.updateItem(taskId, item.id, { title }));
            }}
          />
          <button className="icon-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="上移检查项"><ArrowUp /></button>
          <button className="icon-button" disabled={index === ordered.length - 1} onClick={() => move(index, 1)} aria-label="下移检查项"><ArrowDown /></button>
          <button className="icon-button danger-text" onClick={() => mutation.mutate(() => api.deleteItem(taskId, item.id))} aria-label="删除检查项"><X /></button>
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
        <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="添加检查项" aria-label="添加检查项" />
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
    <div className="popover tag-popover">
      {tags.map((tag) => (
        <label key={tag.id}>
          <input type="checkbox" checked={selected.has(tag.id)} onChange={() => onToggle(tag.id)} />
          <span className="tag-dot" style={{ backgroundColor: tag.color }} />
          {tag.name}
        </label>
      ))}
      <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate(); }}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="新标签名称" maxLength={50} />
        <button className="icon-button" aria-label="创建标签"><Plus /></button>
      </form>
      {create.isError && <div className="inline-error">{errorMessage(create.error)}</div>}
    </div>
  );
}

function SaveStatus({ state, error, onRetry }: { state: string; error: string; onRetry: () => void }) {
  if (state === "saved") return <div className="save-status saved"><Check /> 已保存</div>;
  if (state === "saving") return <div className="save-status saving"><LoaderCircle className="spin" /> 保存中</div>;
  if (state === "dirty") return <div className="save-status dirty"><span /> 已修改</div>;
  return <div className="save-status error"><CircleAlert /> {error}<button onClick={onRetry}>重试</button></div>;
}

function DeletedLists({ lists, onRestore, onDelete }: { lists: TaskList[]; onRestore: (id: string) => void; onDelete: (list: TaskList) => void }) {
  return (
    <section className="deleted-lists">
      <span className="field-label">已删除清单</span>
      {lists.map((list) => (
        <div key={list.id}>
          <span className="list-dot" style={{ backgroundColor: list.color }} />
          <span>{list.name}</span>
          <button onClick={() => onRestore(list.id)}><RotateCcw /> 恢复</button>
          <button className="danger-text" onClick={() => onDelete(list)}><Trash2 /> 永久删除</button>
        </div>
      ))}
    </section>
  );
}

function NewListDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string, color: string) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(tagColors[0]);
  return (
    <div className="dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <form className="dialog new-list-dialog" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(name.trim(), color); }}>
        <h2>新建清单</h2>
        <label>名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={100} /></label>
        <label>颜色<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={!name.trim()}>创建</button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog({ title, message, onCancel, onConfirm }: { title: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="dialog-overlay" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="dialog">
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-button" onClick={onConfirm}>确认</button>
        </div>
      </div>
    </div>
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
      <button className="primary-button" onClick={onRetry} disabled={pending}>{pending ? <LoaderCircle className="spin" /> : <RefreshCw />} 重试连接</button>
    </div>
  );
}

function formatDue(task: Task): string {
  if (!task.due_at) return "";
  const date = new Date(task.due_at);
  return new Intl.DateTimeFormat("zh-CN", task.is_all_day
    ? { month: "numeric", day: "numeric" }
    : { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
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
