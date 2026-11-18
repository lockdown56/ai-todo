import type { AgentRun, AgentRunLane, AgentRunStatus } from "@/types";

export const AGENT_RUN_LONG_STALE_MS = 10 * 60 * 1000;

export const agentRunLanes: ReadonlyArray<{
  lane: AgentRunLane;
  title: string;
  emptyText: string;
}> = [
  { lane: "attention", title: "待我处理", emptyText: "暂无待我处理" },
  { lane: "active", title: "进行中", emptyText: "暂无进行中的运行" },
  { lane: "history", title: "已结束", emptyText: "暂无已结束的运行" },
];

export const agentRunStatusLabels: Record<AgentRunStatus, string> = {
  running: "进行中",
  waiting_user: "待我处理",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  dismissed: "已取消跟踪",
};

const terminalStatuses = new Set<AgentRunStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "dismissed",
]);

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
  return terminalStatuses.has(status);
}

export function isAgentRunLongStale(run: AgentRun, now = Date.now()): boolean {
  if (isTerminalAgentRunStatus(run.status)) return false;
  const updatedAt = Date.parse(run.updated_at);
  if (Number.isNaN(updatedAt)) return false;
  return now - updatedAt > AGENT_RUN_LONG_STALE_MS;
}

export function formatAgentRunRelativeTime(value: string, now = Date.now()): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "—";
  const diff = Math.max(0, now - time);
  if (diff < 60_000) return "刚刚";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

export function formatAgentRunFullTime(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

export function formatClockTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}
