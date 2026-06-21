import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  CalendarClock,
  ChevronDown,
  Flag,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { shouldIgnoreAppShortcut, isCtrlShortcut, isImeComposing } from "@/lib/keyboard-utils";
import { priorityLabels, priorityShortcutValues } from "@/lib/constants";
import { dueAtForShortcut, formatDue } from "@/lib/date-utils";
import type { CreateTaskInput, Task, TaskSort } from "@/types";

export function TaskHeader({
  title,
  count,
  search,
  sort,
  quickAddRef,
  createPending,
  createError,
  refreshPending = false,
  leading,
  showQuickAdd = true,
  onSearch,
  onSort,
  onCreate,
  onRefresh,
}: {
  title: string;
  count: number;
  search: string;
  sort: TaskSort;
  quickAddRef: React.RefObject<HTMLInputElement | null>;
  createPending: boolean;
  createError: string | null;
  refreshPending?: boolean;
  /** 渲染在标题左侧的可选内容（移动端用于放置打开抽屉的按钮） */
  leading?: React.ReactNode;
  showQuickAdd?: boolean;
  onSearch: (value: string) => void;
  onSort: (sort: TaskSort) => void;
  onCreate: (payload: CreateTaskInput) => void;
  onRefresh?: () => void | Promise<void>;
}) {
  const [titleInput, setTitleInput] = useState("");
  const [quickPriority, setQuickPriority] = useState<0 | 1 | 3 | 5>(0);
  const [quickDueAt, setQuickDueAt] = useState<string | null>(null);
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
          {leading}
          <h1>{title}</h1>
          <span>{count} 个任务</span>
        </div>
        <div className="header-tools">
          {onRefresh && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="icon-button"
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshPending}
              aria-label="刷新"
              aria-busy={refreshPending}
            >
              <RefreshCw className={refreshPending ? "spin" : undefined} />
            </Button>
          )}
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
      {showQuickAdd && (
        <>
          <form
            className="quick-add"
            onSubmit={(event) => {
              event.preventDefault();
              const cleaned = titleInput.trim();
              if (!cleaned) return;
              onCreate({
                title: cleaned,
                priority: quickPriority,
                ...(quickDueAt ? { due_at: quickDueAt, is_all_day: true } : {}),
              });
              setTitleInput("");
              setQuickPriority(0);
              setQuickDueAt(null);
            }}
          >
            {createPending ? <LoaderCircle className="spin" /> : <Plus />}
            <Input
              ref={quickAddRef}
              className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              onKeyDown={(event) => {
                if (isImeComposing(event.nativeEvent)) return;
                if (event.metaKey || event.shiftKey || event.repeat) return;
                if (!/^[0-3]$/.test(event.key)) return;
                if (event.altKey && !event.ctrlKey) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuickPriority(priorityShortcutValues[Number(event.key)] as 0 | 1 | 3 | 5);
                } else if (event.ctrlKey && !event.altKey) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuickDueAt(
                    event.key === "0" ? null : dueAtForShortcut(event.key as "1" | "2" | "3"),
                  );
                }
              }}
              placeholder="快速添加任务，回车提交"
              aria-label="快速添加任务"
            />
            {quickDueAt && (
              <button
                type="button"
                className="quick-add-chip"
                onClick={() => setQuickDueAt(null)}
                aria-label="清除截止日期"
              >
                <CalendarClock />
                <span>{formatDue({ due_at: quickDueAt, is_all_day: true } as Task)}</span>
                <X />
              </button>
            )}
            {quickPriority > 0 && (
              <button
                type="button"
                className={`quick-add-chip priority-${quickPriority}`}
                onClick={() => setQuickPriority(0)}
                aria-label="清除优先级"
              >
                <Flag />
                <span>{priorityLabels[quickPriority]}</span>
                <X />
              </button>
            )}
          </form>
          {createError && <div className="inline-error">{createError}</div>}
        </>
      )}
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
