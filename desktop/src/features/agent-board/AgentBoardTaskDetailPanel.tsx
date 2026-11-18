import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { ApiError, api } from "@/api";
import { Button } from "@/components/ui/button";
import { TaskDetail } from "@/features/tasks/TaskDetail";
import { queryKeys } from "@/query";
import { errorMessage } from "@/lib/error-utils";
import type { Tag, TaskList } from "@/types";

/**
 * 看板内的待办详情面板：复用现有 TaskDetail，并显式检查软删除状态。
 * 运行关联的待办可能已被删除，这时与 404 一样展示「待办不可用」。
 */
export function AgentBoardTaskDetailPanel({
  taskId,
  lists,
  tags,
  onClose,
}: {
  taskId: string;
  lists: TaskList[];
  tags: Tag[];
  onClose: () => void;
}) {
  const taskQuery = useQuery({
    queryKey: queryKeys.task(taskId),
    queryFn: () => api.task(taskId),
    retry: false,
  });
  const unavailable = taskQuery.isError
    ? taskQuery.error instanceof ApiError && taskQuery.error.status === 404
    : Boolean(taskQuery.data?.deleted_at);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        className="agent-board-detail-backdrop"
        aria-label="关闭待办面板"
        onClick={onClose}
      />
      <aside className="agent-board-detail" aria-label="待办详情">
        <header className="agent-board-detail-header">
          <span>待办详情</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭待办详情"
          >
            <X />
          </Button>
        </header>
        {taskQuery.isPending && (
          <div className="agent-board-detail-state">
            <LoaderCircle className="spin" />
            <span>正在加载待办</span>
          </div>
        )}
        {unavailable && (
          <div className="agent-board-detail-state" role="alert">
            <CircleAlert />
            <strong>待办不可用</strong>
            <span>关联的待办已删除或不存在。</span>
          </div>
        )}
        {taskQuery.isError && !unavailable && (
          <div className="agent-board-detail-state" role="alert">
            <CircleAlert />
            <strong>待办加载失败</strong>
            <span>{errorMessage(taskQuery.error)}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void taskQuery.refetch()}
            >
              重试
            </Button>
          </div>
        )}
        {taskQuery.isSuccess && !unavailable && (
          <TaskDetail
            taskId={taskId}
            lists={lists}
            tags={tags}
            hideToolbar
            onClose={onClose}
            onDataChanged={() => void taskQuery.refetch()}
          />
        )}
      </aside>
    </>
  );
}
