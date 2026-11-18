import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "@/App";
import {
  agentRunEventLog,
  agentRunRequestLog,
  listAgentRuns,
  makeAgentRun,
  makeTask,
  server,
} from "@/test/server";
import { AgentBoardPage } from "./AgentBoardPage";

const agentRunsUrl = "http://127.0.0.1:8000/api/v1/agent-runs";
const agentRunEventsUrl = "http://127.0.0.1:8000/api/v1/agent-runs/:runId/events";

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/agent-board"]}>
        <AgentBoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderApp(path = "/agent-board") {
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

function laneRegion(name: string) {
  return screen.getByRole("region", { name: `${name}列` });
}

describe("智能体看板", () => {
  it("renders the three lanes with their runs", async () => {
    renderBoard();

    expect(await screen.findByRole("heading", { name: "待我处理" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "进行中" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已结束" })).toBeInTheDocument();

    const attention = laneRegion("待我处理");
    const active = laneRegion("进行中");
    const history = laneRegion("已结束");
    expect(await within(attention).findByText("等待确认迁移方案")).toBeInTheDocument();
    expect(within(active).getByText("排查支付回调异常")).toBeInTheDocument();
    expect(within(history).getByText("回归验证完成")).toBeInTheDocument();
    expect(within(attention).getByText("Codex · 工作电脑")).toBeInTheDocument();
    expect(
      within(attention).getByRole("button", { name: /复制会话标识 db-migration-review/ }),
    ).toBeInTheDocument();
    // 目标域名允许列表初始为空，不展示会话外链
    expect(screen.queryByRole("link", { name: "打开原会话" })).not.toBeInTheDocument();

    await waitFor(() => expect(agentRunRequestLog).toHaveLength(3));
    expect(
      agentRunRequestLog.every((search) => new URLSearchParams(search).get("cursor") === null),
    ).toBe(true);
  });

  it("filters every lane by an exact key source and resets pagination", async () => {
    renderBoard();
    await screen.findByText("等待确认迁移方案");
    agentRunRequestLog.length = 0;

    fireEvent.change(screen.getByRole("textbox", { name: "按来源筛选" }), {
      target: { value: "Claude Code" },
    });

    await waitFor(
      () => {
        expect(agentRunRequestLog.length).toBeGreaterThanOrEqual(3);
        expect(
          agentRunRequestLog.every(
            (search) => new URLSearchParams(search).get("source") === "Claude Code",
          ),
        ).toBe(true);
      },
      { timeout: 3000 },
    );
    expect(
      agentRunRequestLog.every((search) => new URLSearchParams(search).get("cursor") === null),
    ).toBe(true);

    const active = laneRegion("进行中");
    expect(await within(active).findByText("排查支付回调异常")).toBeInTheDocument();
    expect(await within(laneRegion("待我处理")).findByText("暂无待我处理")).toBeInTheDocument();
    expect(screen.queryByText("等待确认迁移方案")).not.toBeInTheDocument();
    expect(screen.queryByText("回归验证完成")).not.toBeInTheDocument();
  });

  it("refreshes every lane from the first page when the window regains focus", async () => {
    renderBoard();
    await screen.findByText("等待确认迁移方案");
    agentRunRequestLog.length = 0;

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(agentRunRequestLog).toHaveLength(3));
    expect(
      agentRunRequestLog.every((search) => new URLSearchParams(search).get("cursor") === null),
    ).toBe(true);
  });

  it("keeps the last snapshot when a manual refresh fails", async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText("等待确认迁移方案");
    let failing = true;
    server.use(
      http.get(agentRunsUrl, ({ request }) => {
        if (failing) {
          return HttpResponse.json(
            { error: { code: "SERVER_ERROR", message: "服务暂时不可用", fields: null } },
            { status: 500 },
          );
        }
        return HttpResponse.json(listAgentRuns(new URL(request.url).searchParams));
      }),
    );

    await user.click(screen.getByRole("button", { name: "刷新" }));

    expect(await screen.findByText(/同步失败：服务暂时不可用/)).toBeInTheDocument();
    expect(screen.getByText(/上次同步/)).toBeInTheDocument();
    expect(screen.getByText("等待确认迁移方案")).toBeInTheDocument();
    expect(screen.getByText("排查支付回调异常")).toBeInTheDocument();

    failing = false;
    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByText(/同步失败/)).not.toBeInTheDocument());
  });

  it("dismisses a non-terminal run with the card version and an idempotency key", async () => {
    const user = userEvent.setup();
    renderBoard();
    const attention = await screen.findByRole("region", { name: "待我处理列" });
    await within(attention).findByText("等待确认迁移方案");

    await user.click(within(attention).getByRole("button", { name: "取消跟踪" }));

    await waitFor(() => expect(agentRunEventLog).toHaveLength(1));
    expect(agentRunEventLog[0].idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(agentRunEventLog[0].body).toMatchObject({
      type: "dismiss",
      expected_version: 3,
    });

    const history = laneRegion("已结束");
    expect(await within(history).findByText("等待确认迁移方案")).toBeInTheDocument();
    expect(within(history).getByText("已取消跟踪")).toBeInTheDocument();
    expect(await within(laneRegion("待我处理")).findByText("暂无待我处理")).toBeInTheDocument();
  });

  it("reports a version conflict and refreshes after a dismiss conflict", async () => {
    const user = userEvent.setup();
    renderBoard();
    const attention = await screen.findByRole("region", { name: "待我处理列" });
    await within(attention).findByText("等待确认迁移方案");
    server.use(
      http.post(agentRunEventsUrl, () =>
        HttpResponse.json(
          {
            error: {
              code: "AGENT_VERSION_CONFLICT",
              message: "版本已过期，请刷新后重试",
              fields: null,
            },
          },
          { status: 409 },
        ),
      ),
    );
    agentRunRequestLog.length = 0;

    await user.click(within(attention).getByRole("button", { name: "取消跟踪" }));

    expect(await screen.findByText(/已发生变化/)).toBeInTheDocument();
    await waitFor(() => expect(agentRunRequestLog).toHaveLength(3));
    expect(within(attention).getByText("等待确认迁移方案")).toBeInTheDocument();
  });

  it("marks non-terminal runs that have not reported for ten minutes", async () => {
    server.use(
      http.get(agentRunsUrl, ({ request }) => {
        const lane = new URL(request.url).searchParams.get("lane");
        const items = lane === "active"
          ? [makeAgentRun({ status: "running", title: "长跑任务", updated_at: "2026-06-11T08:00:00Z" })]
          : [];
        return HttpResponse.json({ items, next_cursor: null });
      }),
    );
    renderBoard();

    const active = await screen.findByRole("region", { name: "进行中列" });
    expect(await within(active).findByText("长时间未更新")).toBeInTheDocument();
  });

  it("opens the linked todo in the board detail panel", async () => {
    const user = userEvent.setup();
    const task = makeTask();
    server.use(
      http.get(agentRunsUrl, ({ request }) => {
        const lane = new URL(request.url).searchParams.get("lane");
        const items = lane === "attention"
          ? [makeAgentRun({ task_id: task.id })]
          : [];
        return HttpResponse.json({ items, next_cursor: null });
      }),
    );
    renderBoard();

    const attention = await screen.findByRole("region", { name: "待我处理列" });
    await user.click(await within(attention).findByRole("button", { name: "查看待办" }));

    const panel = await screen.findByRole("complementary", { name: "待办详情" });
    expect(
      await within(panel).findByRole("button", { name: "编辑任务标题" }),
    ).toBeInTheDocument();
    expect(within(panel).getByText("编写测试")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "关闭待办详情" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "待办详情" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows 待办不可用 for a run whose linked task was soft deleted", async () => {
    const user = userEvent.setup();
    const deletedTask = makeTask({
      id: "00000000-0000-4000-8000-000000000901",
      title: "已删除的待办",
      deleted_at: "2026-06-11T08:00:00Z",
    });
    server.use(
      http.get(agentRunsUrl, ({ request }) => {
        const lane = new URL(request.url).searchParams.get("lane");
        const items = lane === "attention"
          ? [makeAgentRun({ task_id: deletedTask.id })]
          : [];
        return HttpResponse.json({ items, next_cursor: null });
      }),
      http.get("http://127.0.0.1:8000/api/v1/tasks/:taskId", () =>
        HttpResponse.json(deletedTask),
      ),
    );
    renderBoard();

    const attention = await screen.findByRole("region", { name: "待我处理列" });
    await user.click(await within(attention).findByRole("button", { name: "查看待办" }));

    expect(await screen.findByText("待办不可用")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "待办详情" })).toBeInTheDocument();
  });

  it("registers /agent-board as a standalone page without loading the task list", async () => {
    let taskListRequests = 0;
    server.use(
      http.get("http://127.0.0.1:8000/api/v1/tasks", () => {
        taskListRequests += 1;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );
    renderApp();

    expect(await screen.findByRole("heading", { name: "智能体看板" })).toBeInTheDocument();
    expect(await screen.findByText("等待确认迁移方案")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "智能体看板" })).toBeInTheDocument();
    await waitFor(() => expect(taskListRequests).toBe(0));
  });

  it("opens the board from the mobile more drawer at narrow width", async () => {
    const user = userEvent.setup();
    setWindowWidth(390);
    renderApp("/view/inbox");

    await screen.findByText("编写测试");
    await user.click(screen.getByRole("button", { name: "打开更多" }));
    await user.click(await screen.findByRole("button", { name: "智能体看板" }));

    expect(await screen.findByRole("heading", { name: "智能体看板" })).toBeInTheDocument();
    expect(document.querySelector(".mobile-shell .agent-board")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
  });
});
