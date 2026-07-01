import { useRef, useState, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Archive, CircleAlert, LoaderCircle, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { errorMessage } from "@/lib/error-utils";
import { formatDue, dueDateTone } from "@/lib/date-utils";
import type { Task, TaskList, TaskView } from "@/types";

function PanelState({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return <div className="panel-state"><div>{icon}</div><strong>{title}</strong>{description && <span>{description}</span>}</div>;
}

export function TaskListPanel({
  tasks,
  completedTasks,
  activeTaskId,
  view,
  lists,
  loading,
  completedLoading,
  error,
  hasNext,
  completedHasNext,
  fetchingNext,
  completedFetchingNext,
  onLoadMore,
  onLoadMoreCompleted,
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
  completedTasks?: Task[];
  activeTaskId?: string;
  view?: TaskView;
  lists?: TaskList[];
  loading: boolean;
  completedLoading?: boolean;
  error: unknown;
  hasNext: boolean;
  completedHasNext?: boolean;
  fetchingNext: boolean;
  completedFetchingNext?: boolean;
  onLoadMore: () => void;
  onLoadMoreCompleted?: () => void;
  onSelect: (id: string) => Promise<void>;
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
    const focusInput = () => {
      const input = editInputRef.current;
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    };
    focusInput();
    const frame = window.requestAnimationFrame(focusInput);
    return () => window.cancelAnimationFrame(frame);
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
        await onSelect(created.id);
        setEditingTaskId(created.id);
        setEditTitle("");
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
        await onSelect(previousTask.id);
        setEditingTaskId(previousTask.id);
        setEditTitle(previousTask.title);
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

  const showCompletedSection = completedTasks !== undefined;
  const hasActiveTasks = tasks.length > 0;
  const hasCompletedTasks = (completedTasks?.length || 0) > 0;

  if (!hasActiveTasks && !hasCompletedTasks) {
    if (showCompletedSection && completedLoading) {
      return <PanelState icon={<LoaderCircle className="spin" />} title="正在加载任务" />;
    }
    const messages: Record<TaskView | "list", [string, string]> = {
      inbox: ["收集箱为空", "快速添加一个任务开始吧"],
      today: ["今天没有任务", "享受轻松的一天"],
      all: ["还没有任务", "添加一个任务开始吧"],
      completed: ["还没有已完成的任务", "完成一个任务试试"],
      trash: ["回收站为空", "删除的任务会出现在这里"],
      list: ["清单为空", "快速添加一个任务开始吧"],
    };
    const [title, description] = messages[showCompletedSection ? "list" : (view || "all")];
    return <PanelState icon={<Archive />} title={title} description={description} />;
  }

  const renderTaskRow = (task: Task) => {
    const editing = editingTaskId === task.id;
    const owningList =
      view === "all" ? lists?.find((list) => list.id === task.list_id) : undefined;
    const showListTag = view === "all" && Boolean(owningList);
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
            tabIndex={editing ? undefined : 0}
            aria-label={editing ? undefined : `编辑任务 ${task.title}`}
            className={`task-row ${editing ? "editing" : ""} ${activeTaskId === task.id ? "active" : ""} ${task.status === 2 ? "completed" : ""}`}
            style={editing ? undefined : { cursor: "default" }}
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
                style={{ cursor: "pointer" }}
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
            {(task.due_at || (!editing && task.tags.length > 0) || showListTag) && (
              <span className="task-meta">
                {showListTag && owningList && (
                  <span className="list-tag-mini">
                    <span className="list-dot" style={{ backgroundColor: owningList.color }} />
                    <span className="list-tag-name">{owningList.name}</span>
                  </span>
                )}
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
  };

  return (
    <div
      className="task-list"
      onScroll={(event) => {
        const node = event.currentTarget;
        if (node.scrollHeight - node.scrollTop - node.clientHeight >= 80) return;
        if (hasNext) {
          onLoadMore();
          return;
        }
        if (completedHasNext && onLoadMoreCompleted) onLoadMoreCompleted();
      }}
    >
      {tasks.map(renderTaskRow)}
      {showCompletedSection && (hasCompletedTasks || completedLoading) && (
        <div className="task-section">
          <div className="task-section-label">已完成</div>
          {completedTasks?.map(renderTaskRow)}
          {completedLoading && !hasCompletedTasks && (
            <div className="next-page"><LoaderCircle className="spin" /> 加载已完成任务</div>
          )}
        </div>
      )}
      {inlineError && <div className="inline-error task-list-error">{inlineError}</div>}
      {fetchingNext && <div className="next-page"><LoaderCircle className="spin" /> 加载更多</div>}
      {completedFetchingNext && (
        <div className="next-page"><LoaderCircle className="spin" /> 加载更多已完成</div>
      )}
    </div>
  );
}
