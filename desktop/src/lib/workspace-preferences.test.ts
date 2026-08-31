import { beforeEach, describe, expect, it } from "vitest";
import {
  getDefaultWorkspaceRoute,
  getLastWorkspaceRoute,
  getSelectedTaskId,
  getTaskSectionCollapsed,
  getTaskSort,
  isWorkspaceRoute,
  setLastWorkspaceRoute,
  setSelectedTaskId,
  setTaskSectionCollapsed,
  setTaskSort,
} from "./workspace-preferences";

describe("workspace-preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("validates workspace routes", () => {
    expect(isWorkspaceRoute("/view/inbox")).toBe(true);
    expect(isWorkspaceRoute("/view/today?task=abc")).toBe(true);
    expect(isWorkspaceRoute("/list/list-1")).toBe(true);
    expect(isWorkspaceRoute("/settings")).toBe(false);
    expect(isWorkspaceRoute("/profile")).toBe(false);
  });

  it("persists and restores the last workspace route", () => {
    setLastWorkspaceRoute("/list/work", "?task=task-1");
    expect(getLastWorkspaceRoute()).toBe("/list/work?task=task-1");
    expect(getDefaultWorkspaceRoute()).toBe("/list/work?task=task-1");
  });

  it("falls back to inbox when no route is saved", () => {
    expect(getDefaultWorkspaceRoute()).toBe("/view/inbox");
  });

  it("persists sort per scope", () => {
    setTaskSort("view:inbox", "priority_desc");
    setTaskSort("list:work", "due_asc");
    expect(getTaskSort("view:inbox")).toBe("priority_desc");
    expect(getTaskSort("list:work")).toBe("due_asc");
    expect(getTaskSort("view:today")).toBe("manual");
  });

  it("persists selected task per scope", () => {
    setSelectedTaskId("view:inbox", "task-1");
    setSelectedTaskId("list:work", "task-2");
    expect(getSelectedTaskId("view:inbox")).toBe("task-1");
    expect(getSelectedTaskId("list:work")).toBe("task-2");

    setSelectedTaskId("view:inbox", null);
    expect(getSelectedTaskId("view:inbox")).toBeNull();
  });

  it("persists collapsed task sections per scope", () => {
    expect(getTaskSectionCollapsed("view:today", "overdue")).toBe(false);
    setTaskSectionCollapsed("view:today", "overdue", true);

    expect(getTaskSectionCollapsed("view:today", "overdue")).toBe(true);
    expect(getTaskSectionCollapsed("view:today", "completed")).toBe(false);
    expect(getTaskSectionCollapsed("list:work", "overdue")).toBe(false);

    setTaskSectionCollapsed("view:today", "overdue", false);
    expect(getTaskSectionCollapsed("view:today", "overdue")).toBe(false);
  });

  it("falls back to expanded sections when stored data is invalid", () => {
    localStorage.setItem("todo-collapsed-task-sections", "invalid-json");
    expect(getTaskSectionCollapsed("view:today", "overdue")).toBe(false);
  });
});
