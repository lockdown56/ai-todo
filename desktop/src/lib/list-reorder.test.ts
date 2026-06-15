import { describe, expect, it } from "vitest";
import { planListReorder } from "./list-reorder";
import type { TaskList } from "@/types";

function makeList(id: string, sort_order: number, group_id: string | null = null): TaskList {
  return {
    id,
    name: id,
    color: "#3366FF",
    system_type: null,
    group_id,
    sort_order,
    task_count: 0,
    archived_at: null,
    deleted_at: null,
    deletion_batch_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("planListReorder", () => {
  it("moves a list between siblings with midpoint sort order", () => {
    const siblings = [makeList("a", 1024), makeList("b", 2048), makeList("c", 3072)];
    const updates = planListReorder(siblings, "c", "a");
    expect(updates).toEqual([{ id: "c", sort_order: 512 }]);
  });

  it("rebalances siblings when midpoint collides", () => {
    const siblings = [makeList("a", 1024), makeList("b", 1025), makeList("c", 2048)];
    const updates = planListReorder(siblings, "c", "b");
    expect(updates).toEqual([
      { id: "a", sort_order: 1024 },
      { id: "c", sort_order: 2048 },
      { id: "b", sort_order: 3072 },
    ]);
  });
});
