import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveSessionUrl } from "@/lib/session-url";
import type { AgentRun } from "@/types";
import {
  agentRunStatusLabels,
  formatAgentRunFullTime,
  formatAgentRunRelativeTime,
  isAgentRunLongStale,
  isTerminalAgentRunStatus,
} from "./format";

export function AgentRunCard({
  run,
  dismissing,
  onDismiss,
  onOpenTask,
}: {
  run: AgentRun;
  dismissing: boolean;
  onDismiss: (run: AgentRun) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const sessionUrl = resolveSessionUrl(run.session_url);
  const longStale = isAgentRunLongStale(run);
  const terminal = isTerminalAgentRunStatus(run.status);

  const copySessionRef = async () => {
    if (!run.session_ref) return;
    try {
      await navigator.clipboard.writeText(run.session_ref);
      setCopied(true);
    } catch {
      // 剪贴板不可用时保留可选中文本
    }
  };

  return (
    <article className="agent-board-card" aria-label={`运行 ${run.title}`}>
      <div className="agent-board-card-head">
        <h3 className="agent-board-card-title">{run.title}</h3>
        <span className={`agent-status agent-status-${run.status}`}>
          {agentRunStatusLabels[run.status]}
        </span>
      </div>
      <div className="agent-board-card-meta">
        <span className="agent-board-source">{run.source}</span>
        {run.workspace_label && (
          <span className="agent-board-workspace">{run.workspace_label}</span>
        )}
        {longStale && (
          <span className="agent-board-stale" title="超过 10 分钟没有新的上报">
            长时间未更新
          </span>
        )}
      </div>
      {run.summary && <p className="agent-board-card-summary">{run.summary}</p>}
      {run.session_ref && (
        <div className="agent-board-session">
          <span className="agent-board-session-ref" title={run.session_ref}>
            {run.session_ref}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void copySessionRef()}
            aria-label={`复制会话标识 ${run.session_ref}`}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "已复制" : "复制"}
          </Button>
        </div>
      )}
      <div className="agent-board-card-footer">
        <span className="agent-board-card-time" title={formatAgentRunFullTime(run.updated_at)}>
          最后更新 {formatAgentRunRelativeTime(run.updated_at)}
        </span>
        <div className="agent-board-card-actions">
          {sessionUrl && (
            <a
              className="agent-board-link"
              href={sessionUrl}
              target="_blank"
              rel="noreferrer"
            >
              打开原会话
            </a>
          )}
          {run.task_id && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenTask(run.task_id!)}>
              查看待办
            </Button>
          )}
          {!terminal && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="agent-board-dismiss"
              disabled={dismissing}
              onClick={() => onDismiss(run)}
            >
              {dismissing ? "取消中…" : "取消跟踪"}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
