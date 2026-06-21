import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject, TouchEvent as ReactTouchEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Inbox,
  Star,
  ListChecks,
  Menu,
  Plus,
  X,
  ArrowLeft,
  CheckCircle2,
  Trash2,
  UserRound,
  SlidersHorizontal,
  RefreshCw,
} from "lucide-react";
import { useTaskWorkspace } from "@/features/tasks/useTaskWorkspace";
import { TaskHeader } from "@/features/tasks/TaskHeader";
import { TaskListPanel } from "@/features/tasks/TaskListPanel";
import { TaskDetail } from "@/features/tasks/TaskDetail";
import { MobileTaskComposer } from "@/features/tasks/MobileTaskComposer";
import { ProfilePage } from "@/features/account/ProfilePage";
import { SettingsPage } from "@/features/account/SettingsPage";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ConnectionError } from "@/components/ConnectionError";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { viewNames } from "@/lib/constants";
import { errorMessage } from "@/lib/error-utils";
import { sortListsByOrder } from "@/lib/list-reorder";
import { useListReorder } from "@/lib/use-list-reorder";
import {
  usePointerListSort,
  type SortDragSource,
} from "@/lib/use-pointer-list-sort";
import { api } from "@/api";
import { queryKeys } from "@/query";
import type { ListGroup, TaskView, TaskList } from "@/types";

const mobileNavItems = [
  { view: "inbox" as TaskView, icon: Inbox, label: "收集箱" },
  { view: "today" as TaskView, icon: Star, label: "今天" },
  { view: "all" as TaskView, icon: ListChecks, label: "全部" },
];

// 抽屉中展示的「更多」视图（不含底部导航已收录的 inbox/today/all）
const moreViews: { view: TaskView; icon: typeof CheckCircle2; label: string }[] = [
  { view: "completed", icon: CheckCircle2, label: viewNames.completed },
  { view: "trash", icon: Trash2, label: viewNames.trash },
];

export function MobileShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const {
    scope,
    selectedTaskId,
    search,
    setSearch,
    sort,
    setSort,
    confirm,
    setConfirm,
    isRefreshing,
    isProfileRoute,
    isSettingsRoute,

    health,
    lists,
    listGroups,
    tasks,
    taskItems,
    completedTasksQuery,
    completedTaskItems,
    listScopeId,
    currentList,

    editorRef,
    quickAddRef,

    openTask,
    closeDetail,
    refreshWorkspaceData,
    createTask,
    renameTask,
    createInlineTask,
    deleteInlineTask,
    stateMutation,
    deleteTaskMutation,
    restoreTaskMutation,
    permanentTaskMutation,
  } = useTaskWorkspace();

  // 左上角「更多」抽屉的开关状态
  const [moreOpen, setMoreOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const refreshAreaRef = useRef<HTMLDivElement>(null);
  const pullStartY = useRef<number | null>(null);
  const pullStartX = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const pullReadyRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullReady, setPullReady] = useState(false);

  const currentTitle = scope.listId
    ? currentList?.name || "清单"
    : viewNames[scope.view || "inbox"];
  const pullRefreshDisabled =
    isProfileRoute || isSettingsRoute || moreOpen || composerOpen || Boolean(selectedTaskId) || isRefreshing;

  const resetPullRefresh = useCallback(() => {
    pullDistanceRef.current = 0;
    pullReadyRef.current = false;
    setPullDistance(0);
    setPullReady(false);
  }, []);

  const setPullRefreshDistance = useCallback((distance: number) => {
    const nextDistance = Math.max(0, Math.min(distance, 88));
    const ready = nextDistance >= 58;
    pullDistanceRef.current = nextDistance;
    pullReadyRef.current = ready;
    setPullDistance(nextDistance);
    setPullReady(ready);
  }, []);

  const getRefreshScroller = useCallback(
    () => refreshAreaRef.current?.querySelector<HTMLElement>(".task-list") ?? refreshAreaRef.current,
    [],
  );

  const isTextEditingTarget = (target: EventTarget | Element | null) =>
    target instanceof HTMLElement &&
    target.matches("input, textarea, select, [contenteditable='true']");

  const onPullTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (pullRefreshDisabled || event.touches.length !== 1) return;
    if (isTextEditingTarget(event.target)) return;
    if (isTextEditingTarget(document.activeElement)) return;

    const scroller = getRefreshScroller();
    if (!scroller || scroller.scrollTop > 0) return;
    pullStartY.current = event.touches[0].clientY;
    pullStartX.current = event.touches[0].clientX;
  };

  const onPullTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (pullStartY.current === null || pullStartX.current === null) return;
    const deltaY = event.touches[0].clientY - pullStartY.current;
    const deltaX = Math.abs(event.touches[0].clientX - pullStartX.current);
    if (deltaX > Math.max(24, deltaY)) {
      resetPullRefresh();
      pullStartY.current = null;
      pullStartX.current = null;
      return;
    }
    if (deltaY <= 0) {
      setPullRefreshDistance(0);
      return;
    }
    const scroller = getRefreshScroller();
    if (scroller && scroller.scrollTop > 0) {
      resetPullRefresh();
      pullStartY.current = null;
      pullStartX.current = null;
      return;
    }
    if (event.cancelable) event.preventDefault();
    setPullRefreshDistance(deltaY * 0.48);
  };

  const onPullTouchEnd = () => {
    if (pullStartY.current === null) return;
    pullStartY.current = null;
    pullStartX.current = null;
    if (!pullReadyRef.current) {
      resetPullRefresh();
      return;
    }
    setPullRefreshDistance(58);
    void refreshWorkspaceData().finally(resetPullRefresh);
  };

  const visiblePullDistance = isRefreshing ? Math.max(pullDistance, 58) : pullDistance;
  const pullRefreshStyle = {
    "--pull-distance": `${visiblePullDistance}px`,
  } as CSSProperties;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (composerOpen) {
          event.preventDefault();
          setComposerOpen(false);
          return;
        }
        if (moreOpen) {
          event.preventDefault();
          setMoreOpen(false);
          return;
        }
        event.preventDefault();
        void closeDetail();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDetail, composerOpen, moreOpen]);

  // 抽屉内选择某项后跳转并关闭
  const navigateFromDrawer = (path: string) => {
    setMoreOpen(false);
    navigate(path);
  };

  if (health.isPending) {
    return <LoadingScreen />;
  }
  if (health.isError) {
    return (
      <ConnectionError
        message={errorMessage(health.error)}
        onRetry={() => void health.refetch()}
        onOpenSettings={() => navigate("/settings")}
        pending={health.isFetching}
      />
    );
  }

  return (
    <div className="mobile-shell">
      {isProfileRoute || isSettingsRoute ? (
        <MobileSubPage
          title={isProfileRoute ? "个人中心" : "设置"}
          onBack={() => navigate("/view/inbox")}
        >
          {isProfileRoute ? <ProfilePage /> : <SettingsPage />}
        </MobileSubPage>
      ) : (
        <>
          <TaskHeader
            title={currentTitle}
            count={taskItems.length}
            search={search}
            sort={sort}
            quickAddRef={quickAddRef}
            createPending={createTask.isPending}
            createError={createTask.error ? errorMessage(createTask.error) : null}
            showQuickAdd={false}
            leading={
              <Button
                variant="ghost"
                size="icon-sm"
                className="mobile-more-trigger"
                onClick={() => setMoreOpen(true)}
                aria-label="打开更多"
                aria-expanded={moreOpen}
              >
                <Menu />
              </Button>
            }
            onSearch={setSearch}
            onSort={setSort}
            onCreate={(payload) => createTask.mutate(payload)}
          />
          <div
            ref={refreshAreaRef}
            className={`mobile-refresh-area ${
              visiblePullDistance > 0 || isRefreshing ? "is-pulling" : ""
            } ${pullReady ? "is-ready" : ""} ${isRefreshing ? "is-refreshing" : ""}`}
            style={pullRefreshStyle}
            onTouchStart={onPullTouchStart}
            onTouchMove={onPullTouchMove}
            onTouchEnd={onPullTouchEnd}
            onTouchCancel={resetPullRefresh}
          >
            <div
              className="mobile-pull-refresh-indicator"
              role="status"
              aria-label={isRefreshing ? "正在刷新" : "下拉刷新"}
            >
              <RefreshCw className={isRefreshing ? "spin" : undefined} />
            </div>
            <TaskListPanel
              tasks={taskItems}
              completedTasks={listScopeId ? completedTaskItems : undefined}
              activeTaskId={selectedTaskId}
              view={scope.view}
              loading={tasks.isPending}
              completedLoading={listScopeId ? completedTasksQuery.isPending : undefined}
              error={tasks.error}
              hasNext={tasks.hasNextPage}
              completedHasNext={listScopeId ? completedTasksQuery.hasNextPage : undefined}
              fetchingNext={tasks.isFetchingNextPage}
              completedFetchingNext={
                listScopeId ? completedTasksQuery.isFetchingNextPage : undefined
              }
              onLoadMore={() => void tasks.fetchNextPage()}
              onLoadMoreCompleted={
                listScopeId ? () => void completedTasksQuery.fetchNextPage() : undefined
              }
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
          </div>
        </>
      )}

      {selectedTaskId && (
        <MobileDetailSheet
          taskId={selectedTaskId}
          editorRef={editorRef}
          lists={lists.data || []}
          onClose={closeDetail}
          onDataChanged={() =>
            void queryClient.invalidateQueries({ queryKey: queryKeys.task(selectedTaskId) })
          }
        />
      )}

      <nav className="mobile-bottom-nav">
        {mobileNavItems.map(({ view, icon: Icon, label }) => (
          <Button
            key={view}
            variant="ghost"
            className={`mobile-nav-item ${scope.view === view ? "active" : ""}`}
            onClick={() => navigate(`/view/${view}`)}
          >
            <Icon />
            <span>{label}</span>
          </Button>
        ))}
      </nav>

      {!isProfileRoute && !isSettingsRoute && (
        <Button
          type="button"
          size="icon"
          className="mobile-add-fab"
          onClick={() => setComposerOpen(true)}
          aria-label="新建任务"
          aria-expanded={composerOpen}
        >
          <Plus />
        </Button>
      )}

      {composerOpen && (
        <MobileTaskComposer
          lists={lists.data || []}
          defaultListId={
            scope.listId
              || lists.data?.find((list) => list.system_type === "inbox")?.id
          }
          pending={createTask.isPending}
          error={createTask.error ? errorMessage(createTask.error) : null}
          onClose={() => setComposerOpen(false)}
          onCreate={(payload) =>
            createTask.mutate(payload, {
              onSuccess: () => setComposerOpen(false),
            })
          }
        />
      )}

      {moreOpen && (
        <MobileMoreDrawer
          lists={lists.data || []}
          groups={listGroups.data || []}
          currentPath={location.pathname}
          onNavigate={navigateFromDrawer}
          onClose={() => setMoreOpen(false)}
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
    </div>
  );
}

type EditorHandle = { flush: () => Promise<boolean> };

function MobileSubPage({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mobile-more-page">
      <header className="mobile-more-header mobile-subpage-header">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="返回">
          <ArrowLeft />
        </Button>
        <h1>{title}</h1>
      </header>
      <div className="mobile-more-content mobile-subpage-content">{children}</div>
    </div>
  );
}

function MobileDropLine() {
  return <div className="mobile-sort-drop-line" aria-hidden="true" />;
}

function MobileMoreDrawer({
  lists,
  groups,
  currentPath,
  onNavigate,
  onClose,
}: {
  lists: TaskList[];
  groups: ListGroup[];
  currentPath: string;
  onNavigate: (path: string) => void;
  onClose: () => void;
}) {
  const customLists = lists.filter((list) => !list.system_type);
  const ungrouped = sortListsByOrder(customLists.filter((list) => !list.group_id));
  const { reorderLists } = useListReorder(lists, groups);

  const canDropOnList = useCallback(
    (source: SortDragSource, groupId: string | null, listId: string) => {
      if (source.type !== "list" || source.id === listId) return false;
      return source.groupId === groupId;
    },
    [],
  );

  const pointerSort = usePointerListSort({
    canDropOnList,
    canDropOnGroup: () => false,
    onReorderLists: reorderLists,
    onReorderTopLevel: () => {},
    longPressMs: 400,
  });

  const renderList = (list: TaskList, groupId: string | null) => {
    const showBefore =
      pointerSort.dropIndicator?.targetId === list.id &&
      pointerSort.dropIndicator.position === "before";
    const showAfter =
      pointerSort.dropIndicator?.targetId === list.id &&
      pointerSort.dropIndicator.position === "after";
    const dragging = pointerSort.draggingId === list.id;

    return (
      <div
        key={list.id}
        className="mobile-sort-slot"
        data-sort-id={list.id}
        data-sort-kind="list"
        data-sort-group={groupId ?? ""}
      >
        {showBefore && <MobileDropLine />}
        <Button
          variant="ghost"
          className={`mobile-more-item sortable-list-item ${currentPath === `/list/${list.id}` ? "active" : ""} ${dragging ? "is-list-dragging" : ""}`}
          onPointerDown={(event) =>
            pointerSort.onSortPointerDown(event, { type: "list", id: list.id, groupId })
          }
          onClick={() => {
            if (pointerSort.consumeClick()) return;
            onNavigate(`/list/${list.id}`);
          }}
        >
          <span className="list-dot" style={{ backgroundColor: list.color }} />
          <span>{list.name}</span>
        </Button>
        {showAfter && <MobileDropLine />}
      </div>
    );
  };

  return (
    <>
      <button
        type="button"
        aria-label="关闭更多"
        className="mobile-more-backdrop"
        onClick={onClose}
      />
      <aside className="mobile-more-drawer" aria-label="更多">
        <header className="mobile-more-drawer-header">
          <span>更多</span>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭">
            <X />
          </Button>
        </header>
        <div className="mobile-more-drawer-body">
          <nav className="mobile-more-section" aria-label="视图">
            {moreViews.map(({ view, icon: Icon, label }) => (
              <Button
                key={view}
                variant="ghost"
                className="mobile-more-item"
                onClick={() => onNavigate(`/view/${view}`)}
              >
                <Icon />
                <span>{label}</span>
              </Button>
            ))}
          </nav>
          {customLists.length > 0 && (
            <>
              <div className="mobile-more-divider" />
              <div className="mobile-more-section">
                <span className="mobile-more-section-title">清单</span>
                {ungrouped.map((list) => renderList(list, null))}
              </div>
              {groups.map((group) => {
                const groupLists = sortListsByOrder(
                  customLists.filter((list) => list.group_id === group.id),
                );
                if (groupLists.length === 0) return null;
                return (
                  <div className="mobile-more-section" key={group.id}>
                    <span className="mobile-more-section-title">{group.name}</span>
                    {groupLists.map((list) => renderList(list, group.id))}
                  </div>
                );
              })}
            </>
          )}
          <div className="mobile-more-divider" />
          <div className="mobile-more-section">
            <Button
              variant="ghost"
              className={`mobile-more-item ${currentPath === "/profile" ? "active" : ""}`}
              onClick={() => onNavigate("/profile")}
            >
              <UserRound />
              <span>个人中心</span>
            </Button>
            <Button
              variant="ghost"
              className={`mobile-more-item ${currentPath === "/settings" ? "active" : ""}`}
              onClick={() => onNavigate("/settings")}
            >
              <SlidersHorizontal />
              <span>设置</span>
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

function MobileDetailSheet({
  taskId,
  editorRef,
  lists,
  onClose,
  onDataChanged,
}: {
  taskId: string;
  editorRef: RefObject<EditorHandle | null>;
  lists: TaskList[];
  onClose: () => void | Promise<void>;
  onDataChanged: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  // 下拉手势起始 Y 坐标，null 表示未在拖拽中
  const dragStartY = useRef<number | null>(null);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const isEditable = (element: Element | null): element is HTMLElement =>
      element instanceof HTMLElement &&
      element.matches("input, textarea, [contenteditable='true']");

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!isEditable(target)) return;
      setKeyboardOpen(true);
      window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    };

    const onFocusOut = () => {
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!sheet.contains(active) || !isEditable(active)) {
          setKeyboardOpen(false);
        }
      });
    };

    sheet.addEventListener("focusin", onFocusIn);
    sheet.addEventListener("focusout", onFocusOut);
    return () => {
      sheet.removeEventListener("focusin", onFocusIn);
      sheet.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const onDragTouchStart = (event: ReactTouchEvent) => {
    // 只在内容滚动到顶部时才允许下拉关闭，避免与详情内滚动冲突
    const scroller = sheetRef.current?.querySelector<HTMLElement>(".detail-content");
    if (scroller && scroller.scrollTop > 0) return;
    dragStartY.current = event.touches[0].clientY;
  };

  const onDragTouchMove = (event: ReactTouchEvent) => {
    if (dragStartY.current === null) return;
    const delta = event.touches[0].clientY - dragStartY.current;
    if (delta <= 0) return; // 上拉忽略
    // 实时跟随手指位移
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${delta}px)`;
      sheetRef.current.style.transition = "none";
    }
  };

  const onDragTouchEnd = (event: ReactTouchEvent) => {
    if (dragStartY.current === null) return;
    const delta = event.changedTouches[0].clientY - dragStartY.current;
    dragStartY.current = null;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "";
      sheetRef.current.style.transform = "";
    }
    if (delta > 80) {
      void onClose();
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="关闭任务详情"
        className="mobile-detail-backdrop"
        onClick={() => void onClose()}
      />
      <div
        ref={sheetRef}
        className={`mobile-detail-sheet${keyboardOpen ? " keyboard-open" : ""}`}
        onTouchStart={onDragTouchStart}
        onTouchMove={onDragTouchMove}
        onTouchEnd={onDragTouchEnd}
      >
        <div className="mobile-detail-grabber" />
        <div className="mobile-detail-header">
          <Button variant="ghost" size="icon-sm" onClick={() => void onClose()} aria-label="返回">
            <ArrowLeft />
          </Button>
          <span>任务详情</span>
        </div>
        <TaskDetail
          ref={editorRef}
          taskId={taskId}
          lists={lists}
          tags={[]}
          hideToolbar
          onClose={onClose}
          onDataChanged={onDataChanged}
        />
      </div>
    </>
  );
}
