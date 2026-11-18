import { useMemo } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/error-utils";
import type { AgentRun } from "@/types";
import { AgentRunCard } from "./AgentRunCard";
import type { AgentBoardLaneEntry } from "./useAgentBoardLanes";

export function AgentBoardColumn({
  entry,
  dismissingId,
  onDismiss,
  onOpenTask,
}: {
  entry: AgentBoardLaneEntry;
  dismissingId: string | null;
  onDismiss: (run: AgentRun) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { query } = entry;
  // 刷新会整体替换分页；这里再按 id 去重，避免加载更多与刷新交错时出现重复卡片。
  const items = useMemo(() => {
    const seen = new Set<string>();
    const runs: AgentRun[] = [];
    for (const page of query.data?.pages || []) {
      for (const run of page.items) {
        if (seen.has(run.id)) continue;
        seen.add(run.id);
        runs.push(run);
      }
    }
    return runs;
  }, [query.data]);
  const initialError = query.isError && !query.data;
  const nextPageError = query.isError && Boolean(query.data);

  return (
    <section className="agent-board-column" aria-label={`${entry.title}列`}>
      <header className="agent-board-column-header">
        <h2>{entry.title}</h2>
        <span className="agent-board-column-count">{items.length}</span>
      </header>
      <div className="agent-board-column-body">
        {query.isPending && (
          <div className="agent-board-empty">
            <LoaderCircle className="spin" />
            <span>正在加载</span>
          </div>
        )}
        {initialError && (
          <div className="agent-board-empty agent-board-error" role="alert">
            <span>加载失败：{errorMessage(query.error)}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
              重试
            </Button>
          </div>
        )}
        {!query.isPending && !initialError && items.length === 0 && (
          <div className="agent-board-empty">{entry.emptyText}</div>
        )}
        {items.map((run) => (
          <AgentRunCard
            key={run.id}
            run={run}
            dismissing={dismissingId === run.id}
            onDismiss={onDismiss}
            onOpenTask={onOpenTask}
          />
        ))}
        {query.hasNextPage && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="agent-board-load-more"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage && <LoaderCircle className="spin" />}
            {query.isFetchingNextPage ? "正在加载" : "加载更多"}
          </Button>
        )}
        {nextPageError && (
          <div className="agent-board-inline-error" role="alert">
            <span>加载更多失败：{errorMessage(query.error)}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void query.fetchNextPage()}
            >
              重试
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
