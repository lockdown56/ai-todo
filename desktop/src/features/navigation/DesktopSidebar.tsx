import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from "lucide-react";
import { viewNames, viewIcons } from "@/lib/constants";
import {
  getTopLevelEntries,
  sortListsByOrder,
  type DropPosition,
} from "@/lib/list-reorder";
import type { ListGroup, TaskList, TaskView } from "@/types";

interface Scope {
  view?: TaskView;
  listId?: string;
}

interface ListDragState {
  type: "list";
  id: string;
  groupId: string | null;
}

interface GroupDragState {
  type: "group";
  id: string;
}

type SidebarDragState = ListDragState | GroupDragState;

interface DropIndicator {
  targetId: string;
  position: DropPosition;
}

function dropPositionFromEvent(event: React.DragEvent, element: HTMLElement): DropPosition {
  const rect = element.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function DropLine() {
  return <div className="sidebar-drop-line" aria-hidden="true" />;
}

interface ListActions {
  scope: Scope;
  groups: ListGroup[];
  onNavigate: (path: string) => void;
  onEdit: (list: TaskList) => void;
  onColor: (list: TaskList) => void;
  onDelete: (list: TaskList) => void;
  onArchive: (list: TaskList) => void;
  onMoveToGroup: (list: TaskList, groupId: string | null) => void;
  onReorderLists: (activeId: string, overId: string, position: DropPosition) => void;
  onReorderTopLevel: (activeId: string, overId: string, position: DropPosition) => void;
  canDropOnList: (groupId: string | null, listId: string) => boolean;
  onListDragStart: (list: TaskList, groupId: string | null) => void;
  onDragEnd: () => void;
  getDragState: () => SidebarDragState | null;
  dropIndicator: DropIndicator | null;
  setDropIndicator: (indicator: DropIndicator | null) => void;
}

function ListRow({
  list,
  actions,
  groupId,
}: {
  list: TaskList;
  actions: ListActions;
  groupId: string | null;
}) {
  const showBefore =
    actions.dropIndicator?.targetId === list.id && actions.dropIndicator.position === "before";
  const showAfter =
    actions.dropIndicator?.targetId === list.id && actions.dropIndicator.position === "after";

  return (
    <div className="sidebar-sort-slot">
      {showBefore && <DropLine />}
      <div
        className="custom-list-wrap"
        draggable
        onDragStart={(event) => {
          actions.onListDragStart(list, groupId);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", list.id);
          event.currentTarget.classList.add("is-list-dragging");
        }}
        onDragEnd={(event) => {
          actions.onDragEnd();
          event.currentTarget.classList.remove("is-list-dragging");
        }}
        onDragOver={(event) => {
          if (!actions.canDropOnList(groupId, list.id)) {
            actions.setDropIndicator(null);
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          actions.setDropIndicator({
            targetId: list.id,
            position: dropPositionFromEvent(event, event.currentTarget),
          });
        }}
        onDrop={(event) => {
          event.preventDefault();
          const position = dropPositionFromEvent(event, event.currentTarget);
          const source = actions.getDragState();
          actions.setDropIndicator(null);
          if (!source || !actions.canDropOnList(groupId, list.id)) {
            actions.onDragEnd();
            return;
          }
          if (groupId !== null) {
            actions.onReorderLists(source.id, list.id, position);
          } else if (source.type === "list" && source.groupId === null) {
            actions.onReorderLists(source.id, list.id, position);
          } else {
            actions.onReorderTopLevel(source.id, list.id, position);
          }
          actions.onDragEnd();
        }}
      >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            className={`nav-item w-full justify-start ${actions.scope.listId === list.id ? "active" : ""}`}
            onClick={() => void actions.onNavigate(`/list/${list.id}`)}
            title={list.name}
            draggable={false}
            onDragStart={(event) => event.stopPropagation()}
          >
            <span className="nav-icon-slot">
              <span className="list-dot" style={{ backgroundColor: list.color }} />
            </span>
            <span className="nav-label">{list.name}</span>
            <span className="nav-count">{list.task_count}</span>
          </Button>
        </TooltipTrigger>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="icon-button list-menu-button"
            aria-label={`管理清单 ${list.name}`}
            draggable={false}
            onDragStart={(event) => event.stopPropagation()}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label={`清单 ${list.name} 操作`}>
          <DropdownMenuItem onSelect={() => actions.onEdit(list)}>重命名</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.onColor(list)}>更改颜色</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>移动到分组</DropdownMenuLabel>
          {list.group_id && (
            <DropdownMenuItem onSelect={() => actions.onMoveToGroup(list, null)}>
              无分组
            </DropdownMenuItem>
          )}
          {actions.groups
            .filter((group) => group.id !== list.group_id)
            .map((group) => (
              <DropdownMenuItem
                key={group.id}
                onSelect={() => actions.onMoveToGroup(list, group.id)}
              >
                {group.name}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => actions.onArchive(list)}>归档</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete(list)}>
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
      {showAfter && <DropLine />}
    </div>
  );
}

function GroupHeaderRow({
  group,
  groupLists,
  canDropOnHeader,
  onGroupDragStart,
  onDragEnd,
  onReorderTopLevel,
  onToggleGroupCollapse,
  onAddListToGroup,
  onRenameGroup,
  onDeleteGroup,
  dropIndicator,
  setDropIndicator,
}: {
  group: ListGroup;
  groupLists: TaskList[];
  canDropOnHeader: (groupId: string) => boolean;
  onGroupDragStart: (group: ListGroup) => void;
  onDragEnd: () => void;
  onReorderTopLevel: (activeId: string, overId: string, position: DropPosition) => void;
  onToggleGroupCollapse: (group: ListGroup) => void;
  onAddListToGroup: (groupId: string) => void;
  onRenameGroup: (group: ListGroup) => void;
  onDeleteGroup: (group: ListGroup) => void;
  dropIndicator: DropIndicator | null;
  setDropIndicator: (indicator: DropIndicator | null) => void;
}) {
  const showBefore =
    dropIndicator?.targetId === group.id && dropIndicator.position === "before";
  const showAfter =
    dropIndicator?.targetId === group.id && dropIndicator.position === "after";

  return (
    <div className="sidebar-sort-slot">
      {showBefore && <DropLine />}
      <div
        className="list-group-header"
        draggable
        onDragStart={(event) => {
          onGroupDragStart(group);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", group.id);
          event.currentTarget.classList.add("is-list-dragging");
        }}
        onDragEnd={(event) => {
          onDragEnd();
          event.currentTarget.classList.remove("is-list-dragging");
        }}
        onDragOver={(event) => {
          if (!canDropOnHeader(group.id)) {
            setDropIndicator(null);
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropIndicator({
            targetId: group.id,
            position: dropPositionFromEvent(event, event.currentTarget),
          });
        }}
        onDrop={(event) => {
          event.preventDefault();
          const position = dropPositionFromEvent(event, event.currentTarget);
          setDropIndicator(null);
          if (canDropOnHeader(group.id)) {
            const activeId = event.dataTransfer.getData("text/plain");
            if (activeId && activeId !== group.id) {
              onReorderTopLevel(activeId, group.id, position);
            }
          }
          onDragEnd();
        }}
      >
      <Button
        variant="ghost"
        className="list-group-toggle !h-[42px] !min-h-[42px] !px-[11px] !pr-[46px] gap-[11px]"
        onClick={() => onToggleGroupCollapse(group)}
        aria-expanded={!group.is_collapsed}
        aria-label={`${group.is_collapsed ? "展开" : "折叠"}分组 ${group.name}`}
        draggable={false}
        onDragStart={(event) => event.stopPropagation()}
      >
        {group.is_collapsed ? <ChevronRight /> : <ChevronDown />}
        <span className="nav-label">{group.name}</span>
        <span className="nav-count">{groupLists.length}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="icon-button list-menu-button"
            aria-label={`管理分组 ${group.name}`}
            draggable={false}
            onDragStart={(event) => event.stopPropagation()}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label={`分组 ${group.name} 操作`}>
          <DropdownMenuItem onSelect={() => onAddListToGroup(group.id)}>
            新建清单
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRenameGroup(group)}>
            重命名
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDeleteGroup(group)}>
            删除分组
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
      {showAfter && <DropLine />}
    </div>
  );
}

export function DesktopSidebar({
  collapsed,
  currentPath,
  lists,
  groups,
  archivedLists,
  showArchived,
  scope,
  onToggle,
  onNavigate,
  onAdd,
  onAddGroup,
  onEdit,
  onColor,
  onDelete,
  onArchive,
  onMoveToGroup,
  onReorderLists,
  onReorderTopLevel,
  onRenameGroup,
  onDeleteGroup,
  onToggleGroupCollapse,
  onAddListToGroup,
  onToggleArchived,
  onUnarchive,
}: {
  collapsed: boolean;
  currentPath: string;
  lists: TaskList[];
  groups: ListGroup[];
  archivedLists: TaskList[];
  showArchived: boolean;
  scope: Scope;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  onAdd: () => void;
  onAddGroup: () => void;
  onEdit: (list: TaskList) => void;
  onColor: (list: TaskList) => void;
  onDelete: (list: TaskList) => void;
  onArchive: (list: TaskList) => void;
  onMoveToGroup: (list: TaskList, groupId: string | null) => void;
  onReorderLists: (activeId: string, overId: string, position: DropPosition) => void;
  onReorderTopLevel: (activeId: string, overId: string, position: DropPosition) => void;
  onRenameGroup: (group: ListGroup) => void;
  onDeleteGroup: (group: ListGroup) => void;
  onToggleGroupCollapse: (group: ListGroup) => void;
  onAddListToGroup: (groupId: string) => void;
  onToggleArchived: () => void;
  onUnarchive: (list: TaskList) => void;
}) {
  const dragRef = useRef<SidebarDragState | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const customLists = lists.filter((item) => !item.system_type);
  const topLevelEntries = getTopLevelEntries(customLists, groups);

  const handleListDragStart = (list: TaskList, groupId: string | null) => {
    dragRef.current = { type: "list", id: list.id, groupId };
  };

  const handleGroupDragStart = (group: ListGroup) => {
    dragRef.current = { type: "group", id: group.id };
  };

  const handleDragEnd = () => {
    dragRef.current = null;
    setDropIndicator(null);
  };

  const canDropOnList = (groupId: string | null, listId: string) => {
    const source = dragRef.current;
    if (!source || source.id === listId) return false;
    if (groupId !== null) {
      return source.type === "list" && source.groupId === groupId;
    }
    if (source.type === "group") return true;
    return source.type === "list" && source.groupId === null;
  };

  const canDropOnHeader = (groupId: string) => {
    const source = dragRef.current;
    if (!source || source.id === groupId) return false;
    if (source.type === "group") return true;
    return source.type === "list" && source.groupId === null;
  };

  const actions: ListActions = {
    scope,
    groups,
    onNavigate,
    onEdit,
    onColor,
    onDelete,
    onArchive,
    onMoveToGroup,
    onReorderLists,
    onReorderTopLevel,
    canDropOnList,
    onListDragStart: handleListDragStart,
    onDragEnd: handleDragEnd,
    getDragState: () => dragRef.current,
    dropIndicator,
    setDropIndicator,
  };

  return (
    <nav className="sidebar" aria-label="任务导航">
      <div className="sidebar-body">
        <div className="sidebar-header">
        {!collapsed && (
          <>
            <div className="logo">AI</div>
            <strong>AI 清单</strong>
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="icon-button sidebar-toggle"
          onClick={onToggle}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </Button>
      </div>
      <div className="nav-section">
        {(Object.keys(viewNames) as TaskView[]).map((view) => {
          const Icon = viewIcons[view];
          return (
            <Button
              key={view}
              variant="ghost"
              className={`nav-item ${scope.view === view ? "active" : ""}`}
              onClick={() => void onNavigate(`/view/${view}`)}
              title={viewNames[view]}
            >
              <Icon />
              {!collapsed && <span>{viewNames[view]}</span>}
            </Button>
          );
        })}
      </div>
      <div className="sidebar-divider" />
      {!collapsed && (
        <div className="lists-heading">
          <span>清单</span>
          <div className="lists-heading-actions">
            <Button
              variant="ghost"
              size="icon-sm"
              className="icon-button"
              onClick={onAddGroup}
              aria-label="新建分组"
            >
              <FolderPlus />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="icon-button"
              onClick={onAdd}
              aria-label="新建清单"
            >
              <Plus />
            </Button>
          </div>
        </div>
      )}
      <TooltipProvider delayDuration={80} skipDelayDuration={100}>
        {collapsed ? (
          <div className="sidebar-lists-scroll nav-section custom-lists">
            {sortListsByOrder(customLists).map((list) => (
              <div className="custom-list-wrap" key={list.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      className={`nav-item ${scope.listId === list.id ? "active" : ""}`}
                      onClick={() => void onNavigate(`/list/${list.id}`)}
                      aria-label={`${list.name}，${list.task_count} 个任务`}
                    >
                      <span
                        className="collapsed-list-mark"
                        style={{ "--list-color": list.color } as React.CSSProperties}
                        aria-hidden="true"
                      >
                        {Array.from(list.name.trim())[0]?.toUpperCase() || "·"}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" align="center" className="list-tooltip">
                    <strong>{list.name}</strong>
                    <span>{list.task_count} 个任务</span>
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="sidebar-lists-scroll lists-scroll"
            onDragLeave={() => setDropIndicator(null)}
          >
            <div className="nav-section custom-lists">
              {topLevelEntries.map((entry) => {
                if (entry.kind === "list") {
                  return (
                    <ListRow
                      key={entry.item.id}
                      list={entry.item}
                      actions={actions}
                      groupId={null}
                    />
                  );
                }

                const group = entry.item;
                const groupLists = sortListsByOrder(
                  customLists.filter((item) => item.group_id === group.id),
                );
                return (
                  <div className="list-group" key={group.id}>
                    <GroupHeaderRow
                      group={group}
                      groupLists={groupLists}
                      canDropOnHeader={canDropOnHeader}
                      onGroupDragStart={handleGroupDragStart}
                      onDragEnd={handleDragEnd}
                      onReorderTopLevel={onReorderTopLevel}
                      onToggleGroupCollapse={onToggleGroupCollapse}
                      onAddListToGroup={onAddListToGroup}
                      onRenameGroup={onRenameGroup}
                      onDeleteGroup={onDeleteGroup}
                      dropIndicator={dropIndicator}
                      setDropIndicator={setDropIndicator}
                    />
                    {!group.is_collapsed && (
                      <div className="nav-section group-lists">
                        {groupLists.map((list) => (
                          <ListRow
                            key={list.id}
                            list={list}
                            actions={actions}
                            groupId={group.id}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="list-group archived-group w-full">
              <Button
                variant="ghost"
                className="list-group-toggle !h-[42px] !min-h-[42px] !px-[11px] !pr-[46px] gap-[11px]"
                onClick={onToggleArchived}
                aria-expanded={showArchived}
                aria-label={showArchived ? "折叠已归档" : "展开已归档"}
              >
                {showArchived ? <ChevronDown /> : <ChevronRight />}
                <Archive />
                <span className="nav-label">已归档</span>
              </Button>
              {showArchived && (
                <div className="nav-section group-lists">
                  {archivedLists.length === 0 ? (
                    <span className="archived-empty">暂无已归档清单</span>
                  ) : (
                    archivedLists.map((list) => (
                      <div className="custom-list-wrap" key={list.id}>
                        <Button
                          variant="ghost"
                          className="nav-item w-full justify-start"
                          onClick={() => void onNavigate(`/list/${list.id}`)}
                          title={list.name}
                        >
                          <span className="nav-icon-slot">
                            <span className="list-dot" style={{ backgroundColor: list.color }} />
                          </span>
                          <span className="nav-label">{list.name}</span>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="icon-button list-menu-button"
                              aria-label={`管理已归档清单 ${list.name}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            aria-label={`已归档清单 ${list.name} 操作`}
                          >
                            <DropdownMenuItem onSelect={() => onUnarchive(list)}>
                              <ArchiveRestore /> 取消归档
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => onDelete(list)}
                            >
                              <Trash2 /> 删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </TooltipProvider>
      </div>
      <div className="sidebar-settings">
        <div className="sidebar-divider" />
        <Button
          variant="ghost"
          className={`nav-item ${currentPath === "/profile" ? "active" : ""}`}
          onClick={() => void onNavigate("/profile")}
          title="个人中心"
          aria-label={collapsed ? "个人中心" : undefined}
        >
          <UserRound />
          {!collapsed && <span>个人中心</span>}
        </Button>
        <Button
          variant="ghost"
          className={`nav-item ${currentPath === "/settings" ? "active" : ""}`}
          onClick={() => void onNavigate("/settings")}
          title="设置"
          aria-label={collapsed ? "设置" : undefined}
        >
          <SlidersHorizontal />
          {!collapsed && <span>设置</span>}
        </Button>
      </div>
    </nav>
  );
}
