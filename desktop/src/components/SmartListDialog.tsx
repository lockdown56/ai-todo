import { useMemo, useState } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/error-utils";
import { priorityLabels, tagColors } from "@/lib/constants";
import { sortGroupsByOrder, sortListsByOrder } from "@/lib/list-reorder";
import type {
  ListGroup, SmartList, SmartListDateMode, SmartListFilters, SmartListInput, Tag, TaskList,
} from "@/types";

const dateOptions: Array<[SmartListDateMode | "", string]> = [
  ["", "不限日期"], ["none", "无日期"], ["overdue", "已逾期"], ["today", "今天"],
  ["tomorrow", "明天"], ["this_week", "本周"], ["next_7_days", "未来 7 天"],
  ["range", "自定义范围"],
];

export function SmartListDialog({ smartList, lists, groups, tags, onClose, onSubmit }: {
  smartList?: SmartList;
  lists: TaskList[];
  groups: ListGroup[];
  tags: Tag[];
  onClose: () => void;
  onSubmit: (values: SmartListInput) => Promise<void>;
}) {
  const [name, setName] = useState(smartList?.name || "");
  const [color, setColor] = useState(smartList?.color || tagColors[0]);
  const [sources, setSources] = useState<string[]>(smartList?.source_list_ids || []);
  const [filters, setFilters] = useState<SmartListFilters>(smartList?.filters || {
    statuses: ["active"], priorities: [], tag_ids: [], date: null,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);

  const sourceGroups = useMemo(() => {
    const grouped = sortGroupsByOrder(groups).map((group) => ({
      id: group.id,
      name: group.name,
      lists: sortListsByOrder(lists.filter((list) => list.group_id === group.id)),
    })).filter((group) => group.lists.length > 0);
    const ungrouped = sortListsByOrder(lists.filter((list) => list.group_id === null));
    return ungrouped.length > 0
      ? [...grouped, { id: "ungrouped", name: "未分组", lists: ungrouped }]
      : grouped;
  }, [groups, lists]);

  const toggle = <T,>(values: T[], value: T) =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  const toggleGroup = (listIds: string[]) => {
    const selected = new Set(sources);
    const allSelected = listIds.every((id) => selected.has(id));
    listIds.forEach((id) => allSelected ? selected.delete(id) : selected.add(id));
    setSources([...selected]);
  };
  const submit = async () => {
    if (!name.trim() || sources.length === 0 || filters.statuses.length === 0) return;
    if (filters.date?.mode === "range" && (!filters.date.start || !filters.date.end)) return;
    setPending(true);
    setError("");
    try {
      await onSubmit({ name: name.trim(), color, source_list_ids: sources, filters });
    } catch (cause) {
      setError(errorMessage(cause));
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent className="smart-list-dialog">
        <DialogHeader>
          <DialogTitle>{smartList ? "编辑智能清单" : "新建智能清单"}</DialogTitle>
          <DialogDescription>汇总多个清单，并按任务属性自动筛选。</DialogDescription>
        </DialogHeader>
        <form className="list-dialog-form smart-list-dialog-form" onSubmit={(event) => {
          event.preventDefault(); void submit();
        }}>
          <div className="form-field"><Label htmlFor="smart-list-name">名称</Label>
            <Input id="smart-list-name" autoFocus maxLength={100} value={name}
              onChange={(event) => setName(event.target.value)} placeholder="例如：本周重点" />
          </div>
          <div className="form-field"><Label>颜色</Label><div className="color-options">
            {tagColors.map((option) => <button key={option} type="button"
              className={`color-option ${color === option ? "selected" : ""}`}
              style={{ backgroundColor: option }} onClick={() => setColor(option)}
              aria-label={`选择颜色 ${option}`} aria-pressed={color === option} />)}
          </div></div>
          <fieldset className="smart-filter-group smart-source-picker"><legend>来源清单</legend>
            {sourceGroups.map((group) => {
              const listIds = group.lists.map((list) => list.id);
              const selectedCount = listIds.filter((id) => sources.includes(id)).length;
              const checked = selectedCount === listIds.length
                ? true
                : selectedCount > 0 ? "indeterminate" as const : false;
              const collapsed = collapsedGroups.includes(group.id);
              return <div className="smart-source-group" key={group.id}>
                <div className="smart-source-group-header">
                  <label className="smart-source-group-select">
                    <Checkbox checked={checked} aria-label={`选择分组 ${group.name}`}
                      onCheckedChange={() => toggleGroup(listIds)} />
                    <span>{group.name}</span>
                    <span className="smart-source-count">{selectedCount} / {listIds.length}</span>
                  </label>
                  <button type="button" className="smart-source-collapse"
                    aria-label={`${collapsed ? "展开" : "折叠"}分组 ${group.name}`}
                    aria-expanded={!collapsed}
                    onClick={() => setCollapsedGroups(toggle(collapsedGroups, group.id))}>
                    <ChevronDown className={collapsed ? "collapsed" : ""} />
                  </button>
                </div>
                {!collapsed && <div className="smart-source-lists">
                  {group.lists.map((list) => <label key={list.id} className="smart-filter-option">
                    <Checkbox checked={sources.includes(list.id)} aria-label={`选择清单 ${list.name}`}
                      onCheckedChange={() => setSources(toggle(sources, list.id))} />
                    <span className="list-dot" style={{ backgroundColor: list.color }} />{list.name}
                  </label>)}
                </div>}
              </div>;
            })}
          </fieldset>
          <fieldset className="smart-filter-group"><legend>任务状态</legend>
            {(["active", "completed"] as const).map((status) =>
              <label key={status} className="smart-filter-option"><Checkbox
                checked={filters.statuses.includes(status)} onCheckedChange={() => setFilters({
                  ...filters, statuses: toggle(filters.statuses, status),
                })} />{status === "active" ? "未完成" : "已完成"}</label>)}
          </fieldset>
          <fieldset className="smart-filter-group"><legend>优先级</legend>
            {([0, 1, 3, 5] as const).map((priority) =>
              <label key={priority} className="smart-filter-option"><Checkbox
                checked={filters.priorities.includes(priority)} onCheckedChange={() => setFilters({
                  ...filters, priorities: toggle(filters.priorities, priority),
                })} />{priorityLabels[priority]}</label>)}
          </fieldset>
          <div className="form-field"><Label htmlFor="smart-date">日期</Label>
            <select id="smart-date" className="smart-filter-select" value={filters.date?.mode || ""}
              onChange={(event) => setFilters({ ...filters, date: event.target.value
                ? { mode: event.target.value as SmartListDateMode } : null })}>
              {dateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {filters.date?.mode === "range" && <div className="smart-date-range">
              <Input type="date" aria-label="开始日期" value={filters.date.start || ""}
                onChange={(event) => setFilters({ ...filters, date: {
                  ...filters.date!, start: event.target.value,
                } })} />
              <Input type="date" aria-label="结束日期" value={filters.date.end || ""}
                onChange={(event) => setFilters({ ...filters, date: {
                  ...filters.date!, end: event.target.value,
                } })} />
            </div>}
          </div>
          {tags.length > 0 && <fieldset className="smart-filter-group"><legend>标签</legend>
            {tags.map((tag) => <label key={tag.id} className="smart-filter-option"><Checkbox
              checked={filters.tag_ids.includes(tag.id)} onCheckedChange={() => setFilters({
                ...filters, tag_ids: toggle(filters.tag_ids, tag.id),
              })} /><span className="list-dot" style={{ backgroundColor: tag.color }} />{tag.name}</label>)}
          </fieldset>}
          {sources.length === 0 && <div className="inline-error">请至少选择一个来源清单</div>}
          {filters.statuses.length === 0 && <div className="inline-error">请至少选择一个任务状态</div>}
          {error && <div className="inline-error">{error}</div>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={pending}>取消</Button>
            <Button type="submit" disabled={!name.trim() || !sources.length || !filters.statuses.length || pending}>
              {pending && <LoaderCircle className="spin" />}{smartList ? "保存" : "创建"}
            </Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
