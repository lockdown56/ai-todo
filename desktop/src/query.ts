export const queryKeys = {
  health: ["health"] as const,
  auth: ["auth"] as const,
  lists: ["lists"] as const,
  trashLists: ["lists", "trash"] as const,
  archivedLists: ["lists", "archived"] as const,
  listGroups: ["list-groups"] as const,
  tasks: (scope: string, query: string, sort: string) =>
    ["tasks", scope, query, sort] as const,
  task: (id: string) => ["task", id] as const,
  tags: ["tags"] as const,
};
