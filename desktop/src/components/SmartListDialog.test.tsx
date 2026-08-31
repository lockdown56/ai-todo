import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SmartListDialog } from "./SmartListDialog";
import type { ListGroup, SmartList, TaskList } from "@/types";

const timestamp = "2026-08-31T00:00:00Z";

function makeGroup(id: string, name: string, sortOrder: number): ListGroup {
  return { id, name, sort_order: sortOrder, is_collapsed: false,
    created_at: timestamp, updated_at: timestamp };
}

function makeList(
  id: string,
  name: string,
  sortOrder: number,
  groupId: string | null,
): TaskList {
  return {
    id, name, sort_order: sortOrder, group_id: groupId, color: "#6C5CE7",
    system_type: null, task_count: 0, archived_at: null, deleted_at: null,
    deletion_batch_id: null, created_at: timestamp, updated_at: timestamp,
  };
}

const groups = [makeGroup("g2", "生活", 2048), makeGroup("g1", "工作", 1024)];
const lists = [
  makeList("l2", "工作二", 2048, "g1"),
  makeList("l3", "生活一", 1024, "g2"),
  makeList("l1", "工作一", 1024, "g1"),
  makeList("l4", "收集箱", 512, null),
];

function renderDialog(options: { smartList?: SmartList; onSubmit?: ReturnType<typeof vi.fn> } = {}) {
  const onSubmit = options.onSubmit || vi.fn().mockResolvedValue(undefined);
  render(<SmartListDialog smartList={options.smartList} lists={lists} groups={groups} tags={[]}
    onClose={vi.fn()} onSubmit={onSubmit} />);
  return onSubmit;
}

describe("SmartListDialog 来源清单", () => {
  it("按分组与清单顺序展示，并把未分组清单放在末尾", () => {
    renderDialog();
    const labels = screen.getAllByText(/^(工作|生活|未分组)$/);
    expect(labels.map((item) => item.textContent)).toEqual(["工作", "生活", "未分组"]);
    const workGroup = labels[0].closest(".smart-source-group") as HTMLElement;
    expect(within(workGroup).getAllByRole("checkbox").map((item) => item.getAttribute("aria-label")))
      .toEqual(["选择分组 工作", "选择清单 工作一", "选择清单 工作二"]);
  });

  it("支持整组选择、半选状态、整组补全与取消", async () => {
    const user = userEvent.setup();
    renderDialog();
    const groupCheckbox = screen.getByRole("checkbox", { name: "选择分组 工作" });

    await user.click(groupCheckbox);
    expect(screen.getByRole("checkbox", { name: "选择清单 工作一" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择清单 工作二" })).toBeChecked();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "选择清单 工作一" }));
    expect(groupCheckbox).toHaveAttribute("data-state", "indeterminate");
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    await user.click(groupCheckbox);
    expect(groupCheckbox).toBeChecked();
    await user.click(groupCheckbox);
    expect(groupCheckbox).not.toBeChecked();
  });

  it("折叠分组时保留选择，并提交实际选中的清单 ID", async () => {
    const user = userEvent.setup();
    const onSubmit = renderDialog();
    await user.type(screen.getByLabelText("名称"), "重点任务");
    await user.click(screen.getByRole("checkbox", { name: "选择分组 工作" }));
    await user.click(screen.getByRole("button", { name: "折叠分组 工作" }));

    expect(screen.queryByRole("checkbox", { name: "选择清单 工作一" })).not.toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "重点任务",
      source_list_ids: ["l1", "l2"],
    }));
  });

  it("编辑时根据已有来源初始化分组半选状态", () => {
    renderDialog({ smartList: {
      id: "s1", name: "已有智能清单", color: "#6C5CE7", sort_order: 1024,
      source_list_ids: ["l2", "l4"],
      filters: { statuses: ["active"], priorities: [], tag_ids: [], date: null },
      task_count: 0, created_at: timestamp, updated_at: timestamp,
    } });

    expect(screen.getByRole("checkbox", { name: "选择分组 工作" }))
      .toHaveAttribute("data-state", "indeterminate");
    expect(screen.getByRole("checkbox", { name: "选择分组 未分组" })).toBeChecked();
  });
});
