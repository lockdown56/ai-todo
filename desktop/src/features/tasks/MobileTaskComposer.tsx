import { useEffect, useRef, useState } from "react";
import { ArrowUp, CalendarDays, Flag, List, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { priorityLabels } from "@/lib/constants";
import { isImeComposing } from "@/lib/keyboard-utils";
import type { CreateTaskInput, TaskList } from "@/types";
import { DateTimePicker } from "./DateTimePicker";

export function MobileTaskComposer({
  lists,
  defaultListId,
  pending,
  error,
  onClose,
  onCreate,
}: {
  lists: TaskList[];
  defaultListId?: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (payload: CreateTaskInput) => void;
}) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [priority, setPriority] = useState<0 | 1 | 3 | 5>(0);
  const [listId, setListId] = useState(
    defaultListId || lists.find((list) => list.system_type === "inbox")?.id || "",
  );
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const submit = () => {
    const cleaned = title.trim();
    if (!cleaned || pending) return;
    onCreate({
      title: cleaned,
      priority,
      ...(listId ? { list_id: listId } : {}),
      ...(dueAt ? { due_at: dueAt, is_all_day: true } : {}),
    });
  };

  return (
    <>
      <button
        type="button"
        className="mobile-composer-backdrop"
        aria-label="关闭新建任务"
        onClick={onClose}
      />
      <section
        className="mobile-task-composer"
        role="dialog"
        aria-modal="true"
        aria-label="新建任务"
      >
        <div className="mobile-composer-grabber" aria-hidden="true" />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="mobile-composer-input-row">
            <Textarea
              ref={titleRef}
              value={title}
              rows={2}
              placeholder="准备做什么？"
              aria-label="新任务标题"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter"
                  && !event.shiftKey
                  && !isImeComposing(event.nativeEvent)
                ) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mobile-composer-close"
              onClick={onClose}
              aria-label="关闭"
            >
              <X />
            </Button>
          </div>

          <div className="mobile-composer-options">
            <div className="mobile-composer-option">
              <CalendarDays />
              <DateTimePicker label="日期" value={dueAt} allDay onChange={setDueAt} />
              {dueAt && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDueAt(null)}
                  aria-label="清除日期"
                >
                  <X />
                </Button>
              )}
            </div>

            <div className="mobile-composer-option">
              <Flag />
              <Select
                value={String(priority)}
                onValueChange={(value) => setPriority(Number(value) as 0 | 1 | 3 | 5)}
              >
                <SelectTrigger aria-label="优先级">
                  <SelectValue>
                    {priority === 0 ? "优先级" : priorityLabels[priority]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 3, 5].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {priorityLabels[value as 0 | 1 | 3 | 5]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mobile-composer-option mobile-composer-list-option">
              <List />
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger aria-label="清单">
                  <SelectValue placeholder="选择清单" />
                </SelectTrigger>
                <SelectContent>
                  {lists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="submit"
              size="icon"
              className="mobile-composer-submit"
              disabled={!title.trim() || pending}
              aria-label="创建任务"
            >
              {pending ? <LoaderCircle className="spin" /> : <ArrowUp />}
            </Button>
          </div>
          {error && <div className="inline-error mobile-composer-error">{error}</div>}
        </form>
      </section>
    </>
  );
}
