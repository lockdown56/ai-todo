import { Inbox, Star, ListChecks, CheckCircle2, Trash2 } from "lucide-react";
import type { TaskView } from "@/types";

export const viewNames: Record<TaskView, string> = {
  inbox: "收集箱",
  today: "今天",
  all: "全部",
  completed: "已完成",
  trash: "回收站",
};

export const viewIcons = {
  inbox: Inbox,
  today: Star,
  all: ListChecks,
  completed: CheckCircle2,
  trash: Trash2,
};

export const priorityLabels = { 0: "无", 1: "低", 3: "中", 5: "高" };
export const priorityShortcutValues = [0, 1, 3, 5] as const;
export const tagColors = ["#4F6FAE", "#5F7FB6", "#C08A32", "#C96F43", "#4F8A68", "#B65B62"];
export const weekDayLabels = ["一", "二", "三", "四", "五", "六", "日"];