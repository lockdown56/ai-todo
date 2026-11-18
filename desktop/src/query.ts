import type { AgentRunLane } from "./types";

export const queryKeys = {
  health: ["health"] as const,
  auth: ["auth"] as const,
  lists: ["lists"] as const,
  trashLists: ["lists", "trash"] as const,
  archivedLists: ["lists", "archived"] as const,
  listGroups: ["list-groups"] as const,
  smartLists: ["smart-lists"] as const,
  tasks: (scope: string, query: string, sort: string, status?: number) =>
    status === undefined
      ? (["tasks", scope, query, sort] as const)
      : (["tasks", scope, query, sort, status] as const),
  task: (id: string) => ["task", id] as const,
  tags: ["tags"] as const,
  apiKeys: ["api-keys"] as const,
  agentRuns: (lane: AgentRunLane, source: string) => ["agent-runs", lane, source] as const,
  agentRun: (id: string) => ["agent-run", id] as const,
};
