import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { queryKeys } from "@/query";
import {
  getListSiblings,
  getTopLevelSortables,
  planListReorder,
  planSortReorder,
  type DropPosition,
} from "@/lib/list-reorder";
import type { ListGroup, TaskList } from "@/types";

export function useListReorder(
  lists: TaskList[] | undefined,
  groups: ListGroup[] | undefined,
) {
  const queryClient = useQueryClient();

  const invalidateListData = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
    void queryClient.invalidateQueries({ queryKey: queryKeys.listGroups });
    void queryClient.invalidateQueries({ queryKey: queryKeys.archivedLists });
  };

  const reorderLists = (activeId: string, overId: string, position: DropPosition = "before") => {
    const allLists = lists;
    if (!allLists) return;

    const activeList = allLists.find((list) => list.id === activeId);
    const overList = allLists.find((list) => list.id === overId);
    if (!activeList || !overList || activeList.group_id !== overList.group_id) return;

    const siblings = getListSiblings(allLists, activeList.group_id);
    const updates = planListReorder(siblings, activeId, overId, position);
    if (!updates.length) return;

    const sortOrders = new Map(updates.map((item) => [item.id, item.sort_order]));
    queryClient.setQueryData<TaskList[]>(queryKeys.lists, (current) =>
      current?.map((list) =>
        sortOrders.has(list.id) ? { ...list, sort_order: sortOrders.get(list.id)! } : list,
      ),
    );

    void Promise.all(
      updates.map((item) => api.updateList(item.id, { sort_order: item.sort_order })),
    )
      .then(invalidateListData)
      .catch(() => invalidateListData());
  };

  const reorderTopLevel = (activeId: string, overId: string, position: DropPosition = "before") => {
    const allLists = lists;
    const allGroups = groups;
    if (!allLists || !allGroups) return;

    const siblings = getTopLevelSortables(allLists, allGroups);
    if (!siblings.some((item) => item.id === activeId) || !siblings.some((item) => item.id === overId)) {
      return;
    }

    const updates = planSortReorder(siblings, activeId, overId, position);
    if (!updates.length) return;

    const listIds = new Set(allLists.map((list) => list.id));
    const sortOrders = new Map(updates.map((item) => [item.id, item.sort_order]));

    queryClient.setQueryData<TaskList[]>(queryKeys.lists, (current) =>
      current?.map((list) =>
        sortOrders.has(list.id) ? { ...list, sort_order: sortOrders.get(list.id)! } : list,
      ),
    );
    queryClient.setQueryData<ListGroup[]>(queryKeys.listGroups, (current) =>
      current?.map((group) =>
        sortOrders.has(group.id) ? { ...group, sort_order: sortOrders.get(group.id)! } : group,
      ),
    );

    void Promise.all(
      updates.map((item) =>
        listIds.has(item.id)
          ? api.updateList(item.id, { sort_order: item.sort_order })
          : api.updateGroup(item.id, { sort_order: item.sort_order }),
      ),
    )
      .then(invalidateListData)
      .catch(() => invalidateListData());
  };

  return { reorderLists, reorderTopLevel };
}
