import type { Task } from "@/types";

export function formatDue(task: Task): string {
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

export function dueDateTone(task: Task): string {
  if (!task.due_at || task.status === 2) return "";
  const due = new Date(task.due_at);
  const today = new Date();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (dueDay < todayDay) return "overdue";
  if (dueDay === todayDay) return "due-today";
  return "";
}

export function pickerBaseDate(value: string | null, max: string | null): Date {
  return new Date(value || max || Date.now());
}

export function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function calendarDays(month: Date): Date[] {
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

export function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function isLocalDayAfter(day: Date, max: Date): boolean {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() >
    new Date(max.getFullYear(), max.getMonth(), max.getDate()).getTime();
}

export function formatTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function parseTimeInput(value: string): [number, number] {
  const [hours = "0", minutes = "0"] = value.split(":");
  return [Number(hours), Number(minutes)];
}

export function formatPickerValue(value: string | null, allDay: boolean): string {
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

export function formatDayLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function dueAtForShortcut(key: "1" | "2" | "3"): string {
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