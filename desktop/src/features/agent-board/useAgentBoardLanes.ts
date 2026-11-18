import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { api } from "@/api";
import { queryKeys } from "@/query";
import { errorMessage } from "@/lib/error-utils";
import type { AgentRunLane, AgentRunPage } from "@/types";
import { agentRunLanes } from "./format";

const AGENT_RUN_PAGE_SIZE = 30;

export type AgentRunPages = InfiniteData<AgentRunPage, string>;

function useAgentRunLaneQuery(lane: AgentRunLane, source: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.agentRuns(lane, source),
    queryFn: ({ pageParam }): Promise<AgentRunPage> =>
      api.agentRuns({
        lane,
        source: source || undefined,
        cursor: pageParam || undefined,
        limit: AGENT_RUN_PAGE_SIZE,
      }),
    initialPageParam: "",
    getNextPageParam: (lastPage: AgentRunPage) => lastPage.next_cursor || undefined,
    // 看板不轮询：打开、回焦、手动刷新由页面显式触发。
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: false,
  });
}

export function useAgentBoardLanes(source: string) {
  const queryClient = useQueryClient();
  const attention = useAgentRunLaneQuery("attention", source);
  const active = useAgentRunLaneQuery("active", source);
  const history = useAgentRunLaneQuery("history", source);
  const [syncing, setSyncing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshingRef = useRef(false);

  /**
   * 三列一起从第一页重新拉取。成功后用新鲜首页替换该查询的全部旧分页，
   * 因此不会继续复用旧游标；失败时保留缓存中的上次成功快照。
   */
  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setSyncing(true);
    setRefreshError(null);
    let failureMessage = "";
    await Promise.all(
      agentRunLanes.map(async ({ lane }) => {
        try {
          const page = await api.agentRuns({
            lane,
            source: source || undefined,
            limit: AGENT_RUN_PAGE_SIZE,
          });
          queryClient.setQueryData<AgentRunPages>(queryKeys.agentRuns(lane, source), {
            pages: [page],
            pageParams: [""],
          });
        } catch (error) {
          if (!failureMessage) failureMessage = errorMessage(error);
        }
      }),
    );
    if (failureMessage) setRefreshError(failureMessage);
    setSyncing(false);
    refreshingRef.current = false;
  }, [queryClient, source]);

  useEffect(() => {
    const hasCachedSnapshot = agentRunLanes.some(
      ({ lane }) => queryClient.getQueryData(queryKeys.agentRuns(lane, source)) !== undefined,
    );
    if (hasCachedSnapshot) void refresh();
  }, [queryClient, refresh, source]);

  useEffect(() => {
    const onWindowFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [refresh]);

  const lastSyncedAt = Math.max(
    attention.dataUpdatedAt,
    active.dataUpdatedAt,
    history.dataUpdatedAt,
  );

  const lanes = [
    { ...agentRunLanes[0], query: attention },
    { ...agentRunLanes[1], query: active },
    { ...agentRunLanes[2], query: history },
  ];

  return {
    attention,
    active,
    history,
    lanes,
    refresh,
    syncing,
    refreshError,
    lastSyncedAt,
  };
}

export type AgentBoardLaneEntry = ReturnType<typeof useAgentBoardLanes>["lanes"][number];
