import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { useTaskWorkspace } from "@/features/tasks/useTaskWorkspace";
import { DesktopSidebar } from "@/features/navigation/DesktopSidebar";
import { TaskHeader } from "@/features/tasks/TaskHeader";
import { TaskListPanel } from "@/features/tasks/TaskListPanel";
import { TaskDetail } from "@/features/tasks/TaskDetail";
import { SettingsPage } from "@/features/account/SettingsPage";
import { ProfilePage } from "@/features/account/ProfilePage";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ConnectionError } from "@/components/ConnectionError";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ListDialog } from "@/components/ListDialog";
import { GroupDialog } from "@/components/GroupDialog";
import { DeletedLists } from "@/components/DeletedLists";
import { viewNames, priorityShortcutValues } from "@/lib/constants";
import { errorMessage } from "@/lib/error-utils";
import { shouldIgnoreAppShortcut, isCtrlShortcut, isImeComposing } from "@/lib/keyboard-utils";
import {
  getListSiblings,
  getTopLevelSortables,
  planListReorder,
  planSortReorder,
  type DropPosition,
} from "@/lib/list-reorder";
import { dueAtForShortcut } from "@/lib/date-utils";
import { api } from "@/api";
import { queryKeys } from "@/query";
import type { ListGroup, Task, TaskList, TaskView } from "@/types";

export function DesktopShell() {
  const queryClient = useQueryClient();
  const {
    scope,
    selectedTaskId,
    search,
    setSearch,
    sort,
    setSort,
    confirm,
    setConfirm,
    listDialog,
    setListDialog,
    groupDialog,
    setGroupDialog,
    showArchived,
    setShowArchived,
    compactSidebar,
    detailDrawer,
    effectiveSidebarCollapsed,
    sidebarOverlayOpen,
    setSidebarOverlayOpen,
    
    health,
    lists,
    listGroups,
    trashLists,
    archivedLists,
    tags,
    tasks,
    taskItems,
    completedTasksQuery,
    completedTaskItems,
    listScopeId,
    currentList,
    isSettingsRoute,
    isProfileRoute,
    isUtilityRoute,
    
    editorRef,
    quickAddRef,
    
    toggleSidebar,
    navigateAfterFlush,
    openTask,
    closeDetail,
    createTask,
    renameTask,
    createInlineTask,
    deleteInlineTask,
    stateMutation,
    applyTaskShortcut,
    deleteTaskMutation,
    restoreTaskMutation,
    permanentTaskMutation,
    
    navigate,
    location,
  } = useTaskWorkspace();

  const currentTitle = isSettingsRoute
    ? "设置"
    : isProfileRoute
      ? "个人中心"
    : scope.listId
      ? currentList?.name || "清单"
      : viewNames[scope.view || "inbox"];

  const invalidateListData = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
    void queryClient.invalidateQueries({ queryKey: queryKeys.listGroups });
    void queryClient.invalidateQueries({ queryKey: queryKeys.archivedLists });
  };

  const reorderLists = (activeId: string, overId: string, position: DropPosition = "before") => {
    const allLists = lists.data;
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
    const allLists = lists.data;
    const allGroups = listGroups.data;
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

  useEffect(() => {
    if (!compactSidebar) setSidebarOverlayOpen(false);
  }, [compactSidebar, setSidebarOverlayOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!shouldIgnoreAppShortcut(event) && isCtrlShortcut(event, "n")) {
        event.preventDefault();
        quickAddRef.current?.focus();
      }
      if (isImeComposing(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (sidebarOverlayOpen) {
          setSidebarOverlayOpen(false);
          return;
        }
        void closeDetail();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDetail, sidebarOverlayOpen, setSidebarOverlayOpen, quickAddRef]);

  useEffect(() => {
    const onTaskPropertyShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        isImeComposing(event) ||
        event.metaKey ||
        event.shiftKey ||
        !selectedTaskId ||
        !/^[0-3]$/.test(event.key)
      ) {
        return;
      }
      const task = taskItems.find((item) => item.id === selectedTaskId);
      if (!task || task.deleted_at) return;

      let patch: Partial<Task> | undefined;
      if (event.altKey && !event.ctrlKey) {
        patch = {
          priority: priorityShortcutValues[
            Number(event.key)
          ] as Task["priority"],
        };
      } else if (event.ctrlKey && !event.altKey) {
        patch = event.key === "0"
          ? { due_at: null, reminder_at: null }
          : {
              due_at: dueAtForShortcut(event.key as "1" | "2" | "3"),
              is_all_day: true,
              reminder_at: null,
            };
      }
      if (!patch) return;

      event.preventDefault();
      void applyTaskShortcut(task, patch);
    };
    document.addEventListener("keydown", onTaskPropertyShortcut);
    return () => document.removeEventListener("keydown", onTaskPropertyShortcut);
  }, [applyTaskShortcut, selectedTaskId, taskItems]);

  useEffect(() => {
    const onCompleteShortcut = (event: KeyboardEvent) => {
      if (
        shouldIgnoreAppShortcut(event) ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key !== "Enter" ||
        !selectedTaskId
      ) {
        return;
      }
      const task = taskItems.find((item) => item.id === selectedTaskId);
      if (!task || task.deleted_at) return;
      event.preventDefault();
      stateMutation.mutate({
        task,
        action: task.status === 2 ? "reopen" : "complete",
      });
    };
    document.addEventListener("keydown", onCompleteShortcut);
    return () => document.removeEventListener("keydown", onCompleteShortcut);
  }, [selectedTaskId, stateMutation, taskItems]);

  if (health.isPending && !isUtilityRoute) {
    return <LoadingScreen />;
  }
  if (health.isError && !isUtilityRoute) {
    return (
      <ConnectionError
        message={errorMessage(health.error)}
        onRetry={() => void health.refetch()}
        onOpenSettings={() => navigate("/settings")}
        pending={health.isFetching}
      />
    );
  }

  return (
    <>
      <div
        className={[
          "app-shell",
          isUtilityRoute ? "settings-mode" : "",
          effectiveSidebarCollapsed ? "sidebar-collapsed" : "",
          compactSidebar ? "compact-sidebar" : "",
          sidebarOverlayOpen ? "sidebar-overlay-open" : "",
          detailDrawer ? "detail-drawer" : "",
          detailDrawer && !selectedTaskId ? "detail-hidden" : "",
        ].join(" ")}
      >
        <DesktopSidebar
          collapsed={effectiveSidebarCollapsed}
          currentPath={location.pathname}
          lists={lists.data || []}
          groups={listGroups.data || []}
          archivedLists={archivedLists.data || []}
          showArchived={showArchived}
          scope={scope}
          onToggle={toggleSidebar}
          onNavigate={navigateAfterFlush}
          onAdd={() => setListDialog({ mode: "create" })}
          onAddGroup={() => setGroupDialog({ mode: "create" })}
          onEdit={(list) => setListDialog({ mode: "rename", list })}
          onColor={(list) => setListDialog({ mode: "color", list })}
          onDelete={(list) =>
            setConfirm({
              title: "删除清单",
              message: `“${list.name}”及其中的任务将进入回收站。`,
              action: () => {
                void api.deleteList(list.id).then(() => {
                  setConfirm(null);
                  invalidateListData();
                  navigate("/view/inbox");
                });
              },
            })
          }
          onArchive={(list) =>
            void api.archiveList(list.id).then(() => {
              invalidateListData();
              if (scope.listId === list.id) navigate("/view/inbox");
            })
          }
          onMoveToGroup={(list, groupId) =>
            void api.updateList(list.id, { group_id: groupId }).then(invalidateListData)
          }
          onReorderLists={reorderLists}
          onReorderTopLevel={reorderTopLevel}
          onRenameGroup={(group) => setGroupDialog({ mode: "rename", group })}
          onDeleteGroup={(group) =>
            setConfirm({
              title: "删除分组",
              message: `“${group.name}”将被删除，组内清单会移出分组但保留。`,
              action: () => {
                void api.deleteGroup(group.id).then(() => {
                  setConfirm(null);
                  invalidateListData();
                });
              },
            })
          }
          onToggleGroupCollapse={(group) =>
            void api
              .updateGroup(group.id, { is_collapsed: !group.is_collapsed })
              .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.listGroups }))
          }
          onAddListToGroup={(groupId) => setListDialog({ mode: "create", groupId })}
          onToggleArchived={() => setShowArchived((value) => !value)}
          onUnarchive={(list) =>
            void api.unarchiveList(list.id).then(invalidateListData)
          }
        />
        {compactSidebar && sidebarOverlayOpen && (
          <button
            className="sidebar-backdrop"
            onClick={() => setSidebarOverlayOpen(false)}
            aria-label="关闭侧栏"
          />
        )}
        <main className="middle-panel">
          {isSettingsRoute ? (
            <SettingsPage />
          ) : isProfileRoute ? (
            <ProfilePage />
          ) : (
            <>
              <TaskHeader
                title={currentTitle}
                count={taskItems.length}
                search={search}
                sort={sort}
                quickAddRef={quickAddRef}
                createPending={createTask.isPending}
                createError={createTask.error ? errorMessage(createTask.error) : null}
                onSearch={setSearch}
                onSort={setSort}
                onCreate={(payload) => createTask.mutate(payload)}
              />
              {scope.view === "trash" && (trashLists.data?.length || 0) > 0 && (
                <DeletedLists
                  lists={trashLists.data || []}
                  onRestore={(id) =>
                    void api.restoreList(id).then(() => {
                      void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
                    })
                  }
                  onDelete={(list) =>
                    setConfirm({
                      title: "永久删除清单",
                      message: `“${list.name}”及其中仍在回收站的任务将被永久删除，此操作不可撤销。`,
                      action: () => {
                        void api.permanentDeleteList(list.id).then(() => {
                          setConfirm(null);
                          void queryClient.invalidateQueries({ queryKey: queryKeys.trashLists });
                          void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
                        });
                      },
                    })
                  }
                />
              )}
              <TaskListPanel
                tasks={taskItems}
                completedTasks={listScopeId ? completedTaskItems : undefined}
                activeTaskId={selectedTaskId}
                view={scope.view}
                loading={tasks.isPending}
                completedLoading={listScopeId ? completedTasksQuery.isPending : undefined}
                error={tasks.error}
                hasNext={tasks.hasNextPage}
                completedHasNext={listScopeId ? completedTasksQuery.hasNextPage : undefined}
                fetchingNext={tasks.isFetchingNextPage}
                completedFetchingNext={
                  listScopeId ? completedTasksQuery.isFetchingNextPage : undefined
                }
                onLoadMore={() => void tasks.fetchNextPage()}
                onLoadMoreCompleted={
                  listScopeId ? () => void completedTasksQuery.fetchNextPage() : undefined
                }
                onSelect={openTask}
                onRename={renameTask}
                onCreateNext={createInlineTask}
                onDeleteEmpty={deleteInlineTask}
                onClearSelection={closeDetail}
                onDelete={(task) =>
                  setConfirm({
                    title: "删除任务",
                    message: "任务将进入回收站，你可以稍后恢复。",
                    action: () => {
                      setConfirm(null);
                      deleteTaskMutation.mutate(task.id);
                    },
                  })
                }
                onRestore={(task) => restoreTaskMutation.mutate(task.id)}
                onPermanentDelete={(task) =>
                  setConfirm({
                    title: "永久删除任务",
                    message: "任务、检查项和标签关联将被永久删除，此操作不可撤销。",
                    action: () => {
                      setConfirm(null);
                      permanentTaskMutation.mutate(task.id);
                    },
                  })
                }
                onToggle={(task) =>
                  stateMutation.mutate({
                    task,
                    action: task.status === 2 ? "reopen" : "complete",
                  })
                }
              />
            </>
          )}
        </main>
        {!isUtilityRoute && detailDrawer && selectedTaskId && (
          <button
            className="detail-backdrop"
            onClick={() => void closeDetail()}
            aria-label="关闭详情抽屉"
          />
        )}
        <aside className="detail-panel">
          {isUtilityRoute ? null : selectedTaskId ? (
            <TaskDetail
              ref={editorRef}
              taskId={selectedTaskId}
              lists={lists.data || []}
              tags={tags.data || []}
              onClose={closeDetail}
              onDataChanged={() => void queryClient.invalidateQueries({ queryKey: queryKeys.task(selectedTaskId) })}
            />
          ) : (
            <div className="detail-empty">
              <ListChecks size={42} />
              <span>选择一个任务查看详情</span>
            </div>
          )}
        </aside>
      </div>
      {listDialog && (
        <ListDialog
          key={`${listDialog.mode}:${listDialog.list?.id || "new"}`}
          mode={listDialog.mode}
          list={listDialog.list}
          onClose={() => setListDialog(null)}
          onSubmit={async ({ name, color }) => {
            if (listDialog.mode === "create") {
              await api.createList({ name, color, group_id: listDialog.groupId ?? null });
            } else if (listDialog.list && listDialog.mode === "rename") {
              await api.updateList(listDialog.list.id, { name });
            } else if (listDialog.list) {
              await api.updateList(listDialog.list.id, { color });
            }
            setListDialog(null);
            invalidateListData();
          }}
        />
      )}
      {groupDialog && (
        <GroupDialog
          key={`${groupDialog.mode}:${groupDialog.group?.id || "new"}`}
          mode={groupDialog.mode}
          group={groupDialog.group}
          onClose={() => setGroupDialog(null)}
          onSubmit={async ({ name }) => {
            if (groupDialog.mode === "create") {
              await api.createGroup({ name });
            } else if (groupDialog.group) {
              await api.updateGroup(groupDialog.group.id, { name });
            }
            setGroupDialog(null);
            await queryClient.invalidateQueries({ queryKey: queryKeys.listGroups });
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.action}
        />
      )}
    </>
  );
}