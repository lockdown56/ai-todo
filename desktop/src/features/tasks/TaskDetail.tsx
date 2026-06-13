import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Badge } from "@/components/ui/badge";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarDays,
  Check,
  CircleAlert,
  List,
  LoaderCircle,
  Plus,
  Star,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { api } from "@/api";
import { queryKeys } from "@/query";
import { errorMessage } from "@/lib/error-utils";
import { updateTaskListCache } from "@/lib/query-utils";
import { priorityLabels, tagColors } from "@/lib/constants";
import { DateTimePicker } from "./DateTimePicker";
import type { ChecklistItem, Tag, Task, TaskList, TaskPatch } from "@/types";

interface EditorHandle {
  flush: () => Promise<boolean>;
}

export const TaskDetail = forwardRef<EditorHandle, {
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

function PanelState({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return <div className="panel-state"><div>{icon}</div><strong>{title}</strong>{description && <span>{description}</span>}</div>;
}