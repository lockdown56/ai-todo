import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { ArrowUp, CalendarDays, Flag, List, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { priorityLabels } from "@/lib/constants";
import { isImeComposing } from "@/lib/keyboard-utils";
import type { CreateTaskInput, TaskList } from "@/types";
import { DateTimePicker } from "./DateTimePicker";

function MobileComposerSelect({
  label,
  value,
  valueLabel,
  options,
  preserveFocusRef,
  onValueChange,
}: {
  label: string;
  value: string;
  valueLabel: ReactNode;
  options: Array<{ value: string; label: ReactNode }>;
  preserveFocusRef: RefObject<HTMLElement | null>;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const preservingFocus = useRef(false);

  const keepTitleFocused = (event: React.PointerEvent) => {
    const input = preserveFocusRef.current;
    if (!input || document.activeElement !== input) return;
    preservingFocus.current = true;
    event.preventDefault();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="mobile-composer-select-trigger"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          onPointerDown={keepTitleFocused}
        >
          <span>{valueLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="mobile-composer-select-popover"
        align="start"
        role="listbox"
        aria-label={label}
        onPointerDown={keepTitleFocused}
        onOpenAutoFocus={(event) => {
          if (preservingFocus.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (!preservingFocus.current) return;
          event.preventDefault();
          preservingFocus.current = false;
        }}
      >
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            className="mobile-composer-select-option"
            role="option"
            aria-selected={option.value === value}
            onClick={() => {
              onValueChange(option.value);
              setOpen(false);
            }}
          >
            {option.label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

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
              <DateTimePicker
                label="日期"
                value={dueAt}
                allDay
                preserveFocusRef={titleRef}
                onChange={setDueAt}
              />
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
              <MobileComposerSelect
                label="优先级"
                value={String(priority)}
                valueLabel={priority === 0 ? "优先级" : priorityLabels[priority]}
                options={[0, 1, 3, 5].map((value) => ({
                  value: String(value),
                  label: priorityLabels[value as 0 | 1 | 3 | 5],
                }))}
                preserveFocusRef={titleRef}
                onValueChange={(value) => setPriority(Number(value) as 0 | 1 | 3 | 5)}
              />
            </div>

            <div className="mobile-composer-option mobile-composer-list-option">
              <List />
              <MobileComposerSelect
                label="清单"
                value={listId}
                valueLabel={lists.find((list) => list.id === listId)?.name || "选择清单"}
                options={lists.map((list) => ({ value: list.id, label: list.name }))}
                preserveFocusRef={titleRef}
                onValueChange={setListId}
              />
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
