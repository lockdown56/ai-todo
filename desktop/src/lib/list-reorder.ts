import type { ListGroup, TaskList } from "@/types";

export const SORT_GAP = 1024;

export interface SortableEntity {
  id: string;
  sort_order: number;
}

export function sortByOrder<T extends SortableEntity>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
}

export function sortListsByOrder(lists: TaskList[]): TaskList[] {
  return sortByOrder(lists);
}

export function sortGroupsByOrder(groups: ListGroup[]): ListGroup[] {
  return sortByOrder(groups);
}

export function getListSiblings(lists: TaskList[], groupId: string | null): TaskList[] {
  return sortListsByOrder(
    lists.filter((list) => !list.system_type && list.group_id === groupId),
  );
}

export type TopLevelEntry =
  | { kind: "list"; item: TaskList }
  | { kind: "group"; item: ListGroup };

export function getTopLevelEntries(lists: TaskList[], groups: ListGroup[]): TopLevelEntry[] {
  const ungrouped = getListSiblings(lists, null);
  const sortedGroups = sortGroupsByOrder(groups);
  const entries: TopLevelEntry[] = [
    ...ungrouped.map((item) => ({ kind: "list" as const, item })),
    ...sortedGroups.map((item) => ({ kind: "group" as const, item })),
  ];
  return entries.sort(
    (a, b) => a.item.sort_order - b.item.sort_order || a.item.id.localeCompare(b.item.id),
  );
}

export function getTopLevelSortables(lists: TaskList[], groups: ListGroup[]): SortableEntity[] {
  return getTopLevelEntries(lists, groups).map((entry) => ({
    id: entry.item.id,
    sort_order: entry.item.sort_order,
  }));
}

export type DropPosition = "before" | "after";

export function planSortReorder(
  siblings: SortableEntity[],
  activeId: string,
  overId: string,
  position: DropPosition = "before",
): Array<{ id: string; sort_order: number }> {
  const fromIndex = siblings.findIndex((item) => item.id === activeId);
  const targetIndex = siblings.findIndex((item) => item.id === overId);
  if (fromIndex < 0 || targetIndex < 0) return [];

  const reordered = [...siblings];
  const [removed] = reordered.splice(fromIndex, 1);
  let insertAt = position === "before" ? targetIndex : targetIndex + 1;
  if (fromIndex < insertAt) insertAt -= 1;
  reordered.splice(insertAt, 0, removed);

  if (reordered.every((item, index) => item.id === siblings[index]?.id)) return [];

  const newIndex = reordered.findIndex((item) => item.id === activeId);
  const prev = reordered[newIndex - 1];
  const next = reordered[newIndex + 1];
  const current = reordered[newIndex];

  let sortOrder: number;
  if (!prev) {
    sortOrder = next ? next.sort_order - SORT_GAP / 2 : current.sort_order;
  } else if (!next) {
    sortOrder = prev.sort_order + SORT_GAP;
  } else {
    sortOrder = Math.floor((prev.sort_order + next.sort_order) / 2);
  }

  if (prev && next && (sortOrder <= prev.sort_order || sortOrder >= next.sort_order)) {
    return reordered.map((item, index) => ({
      id: item.id,
      sort_order: (index + 1) * SORT_GAP,
    }));
  }

  if (sortOrder === current.sort_order) return [];

  return [{ id: activeId, sort_order: sortOrder }];
}

export function planListReorder(
  siblings: TaskList[],
  activeId: string,
  overId: string,
  position: DropPosition = "before",
): Array<{ id: string; sort_order: number }> {
  return planSortReorder(siblings, activeId, overId, position);
}

// Backward-compatible alias
export const LIST_SORT_GAP = SORT_GAP;
