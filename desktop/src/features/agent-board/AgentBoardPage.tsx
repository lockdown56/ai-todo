import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Search, X } from "lucide-react";
import { ApiError, api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/query";
import { errorMessage } from "@/lib/error-utils";
import { useDebouncedValue, useWindowWidth } from "@/lib/hooks";
import { createRequestId } from "@/lib/request-id";
import type { AgentRun } from "@/types";
import { AgentBoardColumn } from "./AgentBoardColumn";
import { AgentBoardTaskDetailPanel } from "./AgentBoardTaskDetailPanel";
import { formatClockTimestamp } from "./format";
import { useAgentBoardLanes } from "./useAgentBoardLanes";

interface BoardNotice {
  tone: "info" | "warning" | "error";
  message: string;
}

export function AgentBoardPage() {
  const navigate = useNavigate();
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth > 0 && windowWidth < 900;
  const [sourceInput, setSourceInput] = useState("");
  const source = useDebouncedValue(sourceInput.trim(), 300);
  const { lanes, refresh, syncing, refreshError, lastSyncedAt } = useAgentBoardLanes(source);
  const [notice, setNotice] = useState<BoardNotice | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const lists = useQuery({ queryKey: queryKeys.lists, queryFn: api.lists });
  const tags = useQuery({ queryKey: queryKeys.tags, queryFn: api.tags });

  const dismissMutation = useMutation({
    mutationFn: (run: AgentRun) =>
      api.dismissAgentRun(run.id, run.version, createRequestId()),
    onSuccess: () => {
      setNotice({ tone: "info", message: "已取消跟踪。" });
      void refresh();
    },
    onError: (error, run) => {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === "AGENT_VERSION_CONFLICT"
      ) {
        setNotice({
          tone: "warning",
          message: `「${run.title}」已发生变化，已为你刷新最新状态。`,
        });
        void refresh();
        return;
      }
      setNotice({ tone: "error", message: `取消跟踪失败：${errorMessage(error)}` });
    },
  });

  const total = useMemo(() => {
    const ids = new Set<string>();
    for (const { query } of lanes) {
      for (const page of query.data?.pages || []) {
        for (const run of page.items) ids.add(run.id);
      }
    }
    return ids.size;
  }, [lanes]);

  const dismissingId = dismissMutation.isPending
    ? dismissMutation.variables?.id ?? null
    : null;

  return (
    <div className="agent-board">
      <header className="middle-header agent-board-header">
        <div className="title-row">
          <div>
            {isMobile && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="icon-button"
                onClick={() => navigate(-1)}
                aria-label="返回"
              >
                <ArrowLeft />
              </Button>
            )}
            <h1>智能体看板</h1>
            <span>{total} 条记录</span>
          </div>
          <div className="header-tools">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="icon-button"
              onClick={() => void refresh()}
              disabled={syncing}
              aria-label="刷新"
              aria-busy={syncing}
            >
              <RefreshCw className={syncing ? "spin" : undefined} />
            </Button>
          </div>
        </div>
        <div className="agent-board-toolbar">
          <div className="agent-board-filter">
            <Search aria-hidden="true" />
            <Input
              className="agent-board-filter-input"
              value={sourceInput}
              onChange={(event) => setSourceInput(event.target.value)}
              placeholder="输入来源 Key 名精确筛选"
              aria-label="按来源筛选"
            />
            {sourceInput && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="icon-button"
                onClick={() => setSourceInput("")}
                aria-label="清除来源筛选"
              >
                <X />
              </Button>
            )}
          </div>
          <div
            className={`agent-board-sync ${refreshError ? "error" : ""}`}
            role={refreshError ? "alert" : undefined}
          >
            {refreshError && <span>同步失败：{refreshError}</span>}
            <span>上次同步 {lastSyncedAt > 0 ? formatClockTimestamp(lastSyncedAt) : "—"}</span>
            {refreshError && (
              <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
                重试
              </Button>
            )}
          </div>
        </div>
        {notice && (
          <div className={`agent-board-notice ${notice.tone}`} role="status">
            <span>{notice.message}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="icon-button"
              onClick={() => setNotice(null)}
              aria-label="关闭提示"
            >
              <X />
            </Button>
          </div>
        )}
      </header>
      <div className="agent-board-columns">
        {lanes.map((entry) => (
          <AgentBoardColumn
            key={entry.lane}
            entry={entry}
            dismissingId={dismissingId}
            onDismiss={(run) => dismissMutation.mutate(run)}
            onOpenTask={setOpenTaskId}
          />
        ))}
      </div>
      {openTaskId && (
        <AgentBoardTaskDetailPanel
          taskId={openTaskId}
          lists={lists.data || []}
          tags={tags.data || []}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  );
}
