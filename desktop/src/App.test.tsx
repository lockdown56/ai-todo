import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { makeTask, server } from "./test/server";

function renderApp(path = "/view/inbox") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

describe("Todo List app", () => {
  it("renders the three-column shell and persists sidebar collapse", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();

    expect(await screen.findByRole("heading", { name: "收集箱" })).toBeInTheDocument();
    expect(await screen.findByText("编写测试")).toBeInTheDocument();
    expect(container.querySelector(".app-shell")).not.toHaveClass("detail-hidden");
    expect(screen.getByText("选择一个任务查看详情")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "收起侧栏" }));

    expect(localStorage.getItem("todo-sidebar-collapsed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "展开侧栏" }));

    expect(localStorage.getItem("todo-sidebar-collapsed")).toBe("false");
    expect(screen.getByRole("button", { name: "收起侧栏" })).toBeInTheDocument();
  });

  it("hides the empty detail panel when the layout switches to a drawer", async () => {
    setWindowWidth(1000);
    const { container } = renderApp();

    expect(await screen.findByRole("heading", { name: "收集箱" })).toBeInTheDocument();
    expect(container.querySelector(".app-shell")).toHaveClass("detail-drawer", "detail-hidden");
  });

  it("quick-adds a task and opens its detail panel", async () => {
    const user = userEvent.setup();
    renderApp();

    const input = await screen.findByRole("textbox", { name: "快速添加任务" });
    await user.type(input, "新增任务{enter}");

    expect(await screen.findByDisplayValue("新增任务")).toBeInTheDocument();
    expect(screen.getByText("任务详情")).toBeInTheDocument();
  });

  it("edits a task title directly from the task list", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByText("编写测试"));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "编辑任务标题" });
    expect(input).toHaveFocus();
    expect(await screen.findByText("任务详情")).toBeInTheDocument();
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);

    await user.clear(input);
    await user.type(input, "更新测试任务");
    await user.tab();

    expect(await screen.findByText("更新测试任务")).toBeInTheDocument();
  });

  it("creates a real task row on Enter and keeps the new task selected", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByText("编写测试"));
    await user.keyboard("{Enter}");

    const newTaskInput = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "编辑任务标题",
    });
    await waitFor(() => expect(newTaskInput).toHaveFocus());
    expect(newTaskInput).toHaveValue("");
    expect(screen.getAllByRole("checkbox", { name: "完成任务" })).toHaveLength(2);
    expect(screen.queryByRole("textbox", { name: "新任务标题" })).not.toBeInTheDocument();
    await user.type(newTaskInput, "下一条任务{Enter}");

    expect(await screen.findByText("下一条任务")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "编辑任务标题" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "编辑任务标题" })).toHaveFocus();
    expect(screen.getAllByRole("checkbox", { name: "完成任务" })).toHaveLength(3);
  });

  it("deletes an empty selected task on Backspace and focuses the previous task", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByText("编写测试"));
    await user.keyboard("{Enter}");
    const emptyTask = await screen.findByRole("textbox", { name: "编辑任务标题" });
    expect(emptyTask).toHaveValue("");
    await waitFor(() => expect(emptyTask).toHaveFocus());

    await user.keyboard("{Backspace}");

    await waitFor(() => {
      const previousTask = screen.getByRole<HTMLInputElement>("textbox", {
        name: "编辑任务标题",
      });
      expect(previousTask).toHaveValue("编写测试");
      expect(previousTask).toHaveFocus();
      expect(screen.getAllByRole("checkbox", { name: "完成任务" })).toHaveLength(1);
    });
  });

  it("switches smart-list routes without losing the shell", async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("编写测试");
    await user.click(screen.getByRole("button", { name: "今天" }));

    expect(await screen.findByRole("heading", { name: "今天" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "任务导航" })).toBeInTheDocument();
  });

  it("renders list actions outside the scrollable list container", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();

    await user.click(await screen.findByRole("button", { name: "管理清单 工作" }));

    const menu = screen.getByRole("menu", { name: "管理清单 工作" });
    expect(menu).toBeInTheDocument();
    expect(container.querySelector(".custom-lists")).not.toContainElement(menu);
    expect(container).not.toContainElement(menu);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "管理清单 工作" })).not.toBeInTheDocument();
  });

  it("opens a styled dialog for renaming a list", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole("button", { name: "管理清单 工作" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));

    expect(screen.getByRole("dialog", { name: "重命名清单" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue("工作");
  });

  it("completes a task from the task row", async () => {
    const user = userEvent.setup();
    renderApp();

    const checkbox = await screen.findByRole("checkbox", { name: "完成任务" });
    expect(checkbox).toHaveClass("task-checkbox", "has-priority", "priority-3");
    await user.click(checkbox);

    expect(await screen.findByRole("checkbox", { name: "重新打开任务" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("updates the task checkbox color immediately when priority changes", async () => {
    const user = userEvent.setup();
    renderApp("/view/inbox?task=00000000-0000-4000-8000-000000000100");

    const checkbox = await screen.findByRole("checkbox", { name: "完成任务" });
    expect(checkbox).toHaveClass("priority-3");

    await user.click(screen.getByRole("combobox", { name: "优先级" }));
    await user.click(screen.getByRole("option", { name: "高" }));

    expect(checkbox).toHaveClass("priority-5");
    expect(checkbox).not.toHaveClass("priority-3");
  });

  it("sets task priority with Alt plus a number while the task title is focused", async () => {
    const patches: object[] = [];
    server.use(
      http.patch(
        "http://127.0.0.1:8000/api/v1/tasks/:taskId",
        async ({ request }) => {
          const patch = (await request.json()) as object;
          patches.push(patch);
          return HttpResponse.json(makeTask({ ...patch }));
        },
      ),
    );
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByText("编写测试"));
    const title = screen.getByRole("textbox", { name: "编辑任务标题" });
    expect(title).toHaveFocus();

    for (const [key, priority] of [["3", 5], ["2", 3], ["1", 1], ["0", 0]] as const) {
      const shortcut = new KeyboardEvent("keydown", {
        key,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      expect(title.dispatchEvent(shortcut)).toBe(false);
      await waitFor(() => expect(patches.at(-1)).toEqual({ priority }));
    }
  });

  it("sets and clears task due dates with Ctrl plus a number", async () => {
    const patches: Array<Record<string, unknown>> = [];
    server.use(
      http.patch(
        "http://127.0.0.1:8000/api/v1/tasks/:taskId",
        async ({ request }) => {
          const patch = (await request.json()) as Record<string, unknown>;
          patches.push(patch);
          return HttpResponse.json(makeTask({ ...patch }));
        },
      ),
    );
    renderApp("/view/inbox?task=00000000-0000-4000-8000-000000000100");

    const detailTitle = await screen.findByRole("textbox", { name: "任务标题" });
    const expectedDates = ["1", "2", "3"].map((key) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      if (key === "2") date.setDate(date.getDate() + 1);
      if (key === "3") {
        const daysUntilNextMonday = ((8 - date.getDay()) % 7) || 7;
        date.setDate(date.getDate() + daysUntilNextMonday);
      }
      return date.toISOString();
    });

    for (const [index, key] of ["1", "2", "3"].entries()) {
      const shortcut = new KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      expect(detailTitle.dispatchEvent(shortcut)).toBe(false);
      await waitFor(() =>
        expect(patches.at(-1)).toEqual({
          due_at: expectedDates[index],
          is_all_day: true,
          reminder_at: null,
        }),
      );
    }

    const clearShortcut = new KeyboardEvent("keydown", {
      key: "0",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    expect(detailTitle.dispatchEvent(clearShortcut)).toBe(false);
    await waitFor(() =>
      expect(patches.at(-1)).toEqual({ due_at: null, reminder_at: null }),
    );
  });

  it("debounces search before requesting filtered tasks", async () => {
    const requestedQueries: string[] = [];
    server.use(
      http.get("http://127.0.0.1:8000/api/v1/tasks", ({ request }) => {
        requestedQueries.push(new URL(request.url).searchParams.get("query") || "");
        return HttpResponse.json({ items: [makeTask()], next_cursor: null });
      }),
    );
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole("button", { name: "展开搜索" }));
    await user.type(await screen.findByRole("textbox", { name: "搜索任务" }), "测试");
    await waitFor(() => expect(requestedQueries).toContain("测试"), { timeout: 1200 });
    expect(requestedQueries.filter((query) => query === "测试")).toHaveLength(1);
  });

  it("does not intercept application shortcuts while editing text", async () => {
    const user = userEvent.setup();
    renderApp();

    const input = await screen.findByRole("textbox", { name: "快速添加任务" });
    await user.click(input);

    const newTaskShortcut = new KeyboardEvent("keydown", {
      key: "n",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const searchShortcut = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(input.dispatchEvent(newTaskShortcut)).toBe(true);
    expect(input.dispatchEvent(searchShortcut)).toBe(true);
    expect(input).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "搜索任务" })).not.toBeInTheDocument();
  });

  it("does not close task details while an IME composition is active", async () => {
    renderApp("/view/inbox?task=00000000-0000-4000-8000-000000000100");

    const title = await screen.findByRole("textbox", { name: "任务标题" });
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(escape, "isComposing", { value: true });

    expect(title.dispatchEvent(escape)).toBe(true);
    expect(screen.getByText("任务详情")).toBeInTheDocument();
  });

  it("opens the sort menu and updates the active sort", async () => {
    const user = userEvent.setup();
    renderApp();

    const trigger = await screen.findByRole("button", { name: "选择排序方式" });
    expect(trigger).toHaveTextContent("手动");

    await user.click(trigger);
    await user.click(screen.getByRole("menuitemradio", { name: "优先级" }));

    expect(trigger).toHaveTextContent("优先级");
    expect(screen.queryByRole("menu", { name: "任务排序" })).not.toBeInTheDocument();
  });

  it("auto-collapses the sidebar at medium widths without changing the saved preference", async () => {
    setWindowWidth(1200);
    const user = userEvent.setup();
    const { container } = renderApp();

    await screen.findByRole("heading", { name: "收集箱" });
    const shell = container.querySelector(".app-shell");
    expect(shell).toHaveClass("compact-sidebar", "sidebar-collapsed");
    const collapsedList = screen.getByRole("button", { name: "工作，0 个任务" });
    expect(collapsedList).toHaveTextContent("工");

    await user.hover(collapsedList);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("工作0 个任务");

    await user.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(shell).toHaveClass("sidebar-overlay-open");
    expect(localStorage.getItem("todo-sidebar-collapsed")).toBeNull();

    await user.click(screen.getByRole("button", { name: "今天" }));
    expect(await screen.findByRole("heading", { name: "今天" })).toBeInTheDocument();
    expect(shell).not.toHaveClass("sidebar-overlay-open");
  });

  it("uses a dismissible detail drawer at narrow widths", async () => {
    setWindowWidth(1000);
    const user = userEvent.setup();
    const { container } = renderApp(
      "/view/inbox?task=00000000-0000-4000-8000-000000000100",
    );

    expect(await screen.findByText("任务详情")).toBeInTheDocument();
    expect(container.querySelector(".app-shell")).toHaveClass("detail-drawer");

    await user.click(screen.getByRole("button", { name: "关闭详情抽屉" }));

    expect(screen.queryByText("任务详情")).not.toBeInTheDocument();
  });

  it("autosaves the title after 500ms", async () => {
    const patches: unknown[] = [];
    server.use(
      http.patch(
        "http://127.0.0.1:8000/api/v1/tasks/:taskId",
        async ({ request }) => {
          const patch = await request.json();
          patches.push(patch);
          return HttpResponse.json(makeTask({ ...(patch as object) }));
        },
      ),
    );
    const user = userEvent.setup();
    renderApp("/view/inbox?task=00000000-0000-4000-8000-000000000100");

    const title = await screen.findByRole("textbox", { name: "任务标题" });
    await user.clear(title);
    await user.type(title, "自动保存");

    await waitFor(
      () => expect(patches).toContainEqual({ title: "自动保存" }),
      { timeout: 1500 },
    );
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("keeps edits after an autosave failure and retries", async () => {
    let attempts = 0;
    server.use(
      http.patch(
        "http://127.0.0.1:8000/api/v1/tasks/:taskId",
        async ({ request }) => {
          attempts += 1;
          const patch = (await request.json()) as object;
          if (attempts === 1) {
            return HttpResponse.json(
              { error: { code: "SAVE_FAILED", message: "保存失败", fields: null } },
              { status: 500 },
            );
          }
          return HttpResponse.json(makeTask({ ...patch }));
        },
      ),
    );
    const user = userEvent.setup();
    renderApp("/view/inbox?task=00000000-0000-4000-8000-000000000100");

    const title = await screen.findByRole("textbox", { name: "任务标题" });
    await user.clear(title);
    await user.type(title, "保留的编辑");
    expect(await screen.findByText("保存失败", {}, { timeout: 1500 })).toBeInTheDocument();
    expect(title).toHaveValue("保留的编辑");

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("已保存")).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("closes the date picker with Escape without closing task details", async () => {
    const user = userEvent.setup();
    renderApp("/view/inbox?task=00000000-0000-4000-8000-000000000100");

    await user.click(await screen.findByRole("button", { name: "截止日期" }));
    expect(screen.getByRole("dialog", { name: "截止日期选择器" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "截止日期选择器" })).not.toBeInTheDocument();
    expect(screen.getByText("任务详情")).toBeInTheDocument();
  });

  it("closes the date picker when clicking outside it", async () => {
    const user = userEvent.setup();
    renderApp("/view/inbox?task=00000000-0000-4000-8000-000000000100");

    await user.click(await screen.findByRole("button", { name: "截止日期" }));
    expect(screen.getByRole("dialog", { name: "截止日期选择器" })).toBeInTheDocument();

    await user.click(screen.getByText("任务详情"));

    expect(screen.queryByRole("dialog", { name: "截止日期选择器" })).not.toBeInTheDocument();
    expect(screen.getByText("任务详情")).toBeInTheDocument();
  });

  it("closes both pickers when clicking their already-selected date", async () => {
    server.use(
      http.get(
        "http://127.0.0.1:8000/api/v1/tasks/:taskId",
        () =>
          HttpResponse.json(
            makeTask({
              due_at: "2026-06-12T09:30:00Z",
              reminder_at: "2026-06-12T08:30:00Z",
            }),
          ),
      ),
    );
    const user = userEvent.setup();
    renderApp("/view/inbox?task=00000000-0000-4000-8000-000000000100");

    await user.click(await screen.findByRole("button", { name: "截止日期" }));
    expect(screen.getByRole("dialog", { name: "截止日期选择器" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2026年6月12日" }));

    expect(screen.queryByRole("dialog", { name: "截止日期选择器" })).not.toBeInTheDocument();
    expect(screen.getByText("任务详情")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "提醒时间" }));
    expect(screen.getByRole("dialog", { name: "提醒时间选择器" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2026年6月12日" }));

    expect(screen.queryByRole("dialog", { name: "提醒时间选择器" })).not.toBeInTheDocument();
    expect(screen.getByText("任务详情")).toBeInTheDocument();
  });

  it("shows the connection error page and retries", async () => {
    const health = vi.fn();
    server.use(
      http.get("http://127.0.0.1:8000/health", () => {
        health();
        return HttpResponse.error();
      }),
    );
    const user = userEvent.setup();
    renderApp();

    expect(await screen.findByRole("heading", { name: "无法连接到服务" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /重试连接/ }));
    await act(async () => {});
    expect(health).toHaveBeenCalledTimes(2);
  });
});
