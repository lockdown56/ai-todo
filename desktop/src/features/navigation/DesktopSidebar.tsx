import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus, SlidersHorizontal, UserRound } from "lucide-react";
import { viewNames, viewIcons } from "@/lib/constants";
import type { TaskList, TaskView } from "@/types";

interface Scope {
  view?: TaskView;
  listId?: string;
}

export function DesktopSidebar({
  collapsed,
  currentPath,
  lists,
  scope,
  onToggle,
  onNavigate,
  onAdd,
  onEdit,
  onColor,
  onDelete,
}: {
  collapsed: boolean;
  currentPath: string;
  lists: TaskList[];
  scope: Scope;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  onAdd: () => void;
  onEdit: (list: TaskList) => void;
  onColor: (list: TaskList) => void;
  onDelete: (list: TaskList) => void;
}) {
  return (
    <nav className="sidebar" aria-label="任务导航">
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
          <Button variant="ghost" size="icon-sm" className="icon-button" onClick={onAdd} aria-label="新建清单">
            <Plus />
          </Button>
        </div>
      )}
      <TooltipProvider delayDuration={80} skipDelayDuration={100}>
        <div className="nav-section custom-lists">
          {lists
            .filter((item) => !item.system_type)
            .map((list) => (
              <div className="custom-list-wrap" key={list.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      className={`nav-item ${scope.listId === list.id ? "active" : ""}`}
                      onClick={() => void onNavigate(`/list/${list.id}`)}
                      title={collapsed ? undefined : list.name}
                      aria-label={collapsed ? `${list.name}，${list.task_count} 个任务` : undefined}
                    >
                      {collapsed ? (
                        <span
                          className="collapsed-list-mark"
                          style={{ "--list-color": list.color } as React.CSSProperties}
                          aria-hidden="true"
                        >
                          {Array.from(list.name.trim())[0]?.toUpperCase() || "·"}
                        </span>
                      ) : (
                        <>
                          <span className="list-dot" style={{ backgroundColor: list.color }} />
                          <span className="nav-label">{list.name}</span>
                          <span className="nav-count">{list.task_count}</span>
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right" align="center" className="list-tooltip">
                      <strong>{list.name}</strong>
                      <span>{list.task_count} 个任务</span>
                    </TooltipContent>
                  )}
                </Tooltip>
                {!collapsed && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="icon-button list-menu-button"
                        aria-label={`管理清单 ${list.name}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      aria-label={`清单 ${list.name} 操作`}
                    >
                      <DropdownMenuItem onSelect={() => onEdit(list)}>重命名</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onColor(list)}>更改颜色</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => onDelete(list)}>
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
          ))}
        </div>
      </TooltipProvider>
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