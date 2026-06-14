import { useEffect, useRef } from "react";
import type { RefObject, TouchEvent as ReactTouchEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Inbox, Star, ListChecks, MoreHorizontal, ArrowLeft } from "lucide-react";
import { useTaskWorkspace } from "@/features/tasks/useTaskWorkspace";
import { TaskHeader } from "@/features/tasks/TaskHeader";
import { TaskListPanel } from "@/features/tasks/TaskListPanel";
import { TaskDetail } from "@/features/tasks/TaskDetail";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ConnectionError } from "@/components/ConnectionError";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { viewNames } from "@/lib/constants";
import { errorMessage } from "@/lib/error-utils";
import { api } from "@/api";
import { queryKeys } from "@/query";
import type { TaskView, TaskList } from "@/types";

const mobileNavItems = [
  { view: "inbox" as TaskView, icon: Inbox, label: "收集箱" },
  { view: "today" as TaskView, icon: Star, label: "今天" },
  { view: "all" as TaskView, icon: ListChecks, label: "全部" },
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
    
    health,
    lists,
    tasks,
    taskItems,
    currentList,
    
    editorRef,
    quickAddRef,
    
    openTask,
    closeDetail,
    createTask,
    renameTask,
    createInlineTask,
    deleteInlineTask,
    stateMutation,
    deleteTaskMutation,
    restoreTaskMutation,
    permanentTaskMutation,
  } = useTaskWorkspace();

  const currentTitle = scope.listId
    ? currentList?.name || "清单"
    : viewNames[scope.view || "inbox"];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void closeDetail();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDetail]);

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

  const isMorePage = location.pathname === "/more";

  return (
    <div className="mobile-shell">
      {isMorePage ? (
        <div className="mobile-more-page">
          <header className="mobile-more-header">
            <h1>更多</h1>
          </header>
          <div className="mobile-more-content">
            <Button
              variant="ghost"
              className="mobile-more-item"
              onClick={() => navigate("/view/completed")}
            >
              已完成
            </Button>
            <Button
              variant="ghost"
              className="mobile-more-item"
              onClick={() => navigate("/view/trash")}
            >
              回收站
            </Button>
            <div className="mobile-more-divider" />
            <div className="mobile-more-section">
              <span className="mobile-more-section-title">清单</span>
              {lists.data
                ?.filter((list) => !list.system_type)
                .map((list) => (
                  <Button
                    key={list.id}
                    variant="ghost"
                    className="mobile-more-item"
                    onClick={() => navigate(`/list/${list.id}`)}
                  >
                    <span className="list-dot" style={{ backgroundColor: list.color }} />
                    {list.name}
                  </Button>
                ))}
            </div>
            <div className="mobile-more-divider" />
            <Button
              variant="ghost"
              className="mobile-more-item"
              onClick={() => navigate("/profile")}
            >
              个人中心
            </Button>
            <Button
              variant="ghost"
              className="mobile-more-item"
              onClick={() => navigate("/settings")}
            >
              设置
            </Button>
          </div>
        </div>
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
            onSearch={setSearch}
            onSort={setSort}
            onCreate={(title) => createTask.mutate(title)}
          />
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
        <Button
          variant="ghost"
          className={`mobile-nav-item ${isMorePage ? "active" : ""}`}
          onClick={() => navigate("/more")}
        >
          <MoreHorizontal />
          <span>更多</span>
        </Button>
      </nav>

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
  // 下拉手势起始 Y 坐标，null 表示未在拖拽中
  const dragStartY = useRef<number | null>(null);

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
        className="mobile-detail-sheet"
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
          onClose={onClose}
          onDataChanged={onDataChanged}
        />
      </div>
    </>
  );
}