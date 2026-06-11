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

describe("Todo List app", () => {
  it("renders the three-column shell and persists sidebar collapse", async () => {
    const user = userEvent.setup();
    renderApp();

    expect(await screen.findByRole("heading", { name: "收集箱" })).toBeInTheDocument();
    expect(await screen.findByText("编写测试")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "收起侧栏" }));

    expect(localStorage.getItem("todo-sidebar-collapsed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "展开侧栏" }));

    expect(localStorage.getItem("todo-sidebar-collapsed")).toBe("false");
    expect(screen.getByRole("button", { name: "收起侧栏" })).toBeInTheDocument();
  });

  it("quick-adds a task and opens its detail panel", async () => {
    const user = userEvent.setup();
    renderApp();

    const input = await screen.findByRole("textbox", { name: "快速添加任务" });
    await user.type(input, "新增任务{enter}");

    expect(await screen.findByDisplayValue("新增任务")).toBeInTheDocument();
    expect(screen.getByText("任务详情")).toBeInTheDocument();
  });

  it("switches smart-list routes without losing the shell", async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("编写测试");
    await user.click(screen.getByRole("button", { name: "今天" }));

    expect(await screen.findByRole("heading", { name: "今天" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "任务导航" })).toBeInTheDocument();
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

    await user.selectOptions(screen.getByRole("combobox", { name: "优先级" }), "5");

    expect(checkbox).toHaveClass("priority-5");
    expect(checkbox).not.toHaveClass("priority-3");
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

    await user.type(await screen.findByRole("textbox", { name: "搜索任务" }), "测试");
    await waitFor(() => expect(requestedQueries).toContain("测试"), { timeout: 1200 });
    expect(requestedQueries.filter((query) => query === "测试")).toHaveLength(1);
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
