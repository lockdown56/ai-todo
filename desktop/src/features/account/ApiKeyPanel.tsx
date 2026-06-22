import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2, Copy, Check, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api, ApiError } from "@/api";
import { queryKeys } from "@/query";
import { errorMessage } from "@/lib/error-utils";
import type { ApiKeyCreated } from "@/types";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ApiKeyPanel() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [createError, setCreateError] = useState("");

  const { data: keys, isPending, error } = useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: api.apiKeys,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.createApiKey(name),
    onSuccess: (created) => {
      setCreatedKey(created);
      setNewName("");
      setCreateError("");
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
    onError: (error) => {
      setCreateError(errorMessage(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteApiKey(id),
    onSuccess: () => {
      setRevokeTarget(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
  });

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createMutation.mutate(name);
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.api_key);
      setCopied(true);
    } catch {
      // clipboard may be unavailable; user can still select the text
    }
  };

  return (
    <section className="settings-card api-keys-card" aria-label="API Key 管理">
      <h2 className="settings-section-title">API Key</h2>
      <p className="settings-help">
        API Key 可用于 CLI 脚本和自动化场景的认证，作为登录令牌的长期替代。创建后明文仅显示一次，请妥善保管。
      </p>

      <form
        className="api-key-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleCreate();
        }}
      >
        <div className="form-field">
          <Label htmlFor="api-key-name">名称</Label>
          <Input
            id="api-key-name"
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="例如：CI 脚本"
            maxLength={100}
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={createMutation.isPending || !newName.trim()}>
          {createMutation.isPending ? <LoaderCircle className="spin" /> : <Plus />}
          创建
        </Button>
      </form>
      {createError && <div className="settings-message error">{createError}</div>}

      {isPending ? (
        <div className="api-key-loading">加载中…</div>
      ) : error ? (
        <div className="settings-message error">
          {error instanceof ApiError ? error.message : errorMessage(error)}
        </div>
      ) : keys && keys.length > 0 ? (
        <ul className="api-key-list">
          {keys.map((key) => (
            <li key={key.id} className="api-key-item">
              <div className="api-key-info">
                <div className="api-key-name-row">
                  <KeyRound className="api-key-icon" />
                  <strong>{key.name}</strong>
                  <Badge variant="secondary" className="api-key-prefix">{key.key_prefix}…</Badge>
                </div>
                <dl className="api-key-meta">
                  <div>
                    <dt>创建时间</dt>
                    <dd>{formatTimestamp(key.created_at)}</dd>
                  </div>
                  <div>
                    <dt>最后使用</dt>
                    <dd>{formatTimestamp(key.last_used_at)}</dd>
                  </div>
                </dl>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setRevokeTarget({ id: key.id, name: key.name })}
              >
                <Trash2 />
                吊销
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="api-key-empty">暂无 API Key。</div>
      )}

      {createdKey && (
        <Dialog open onOpenChange={(open) => { if (!open) setCreatedKey(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>API Key 已创建</DialogTitle>
              <DialogDescription>
                请立即复制并妥善保管此 Key，关闭后将无法再次查看。
              </DialogDescription>
            </DialogHeader>
            <div className="api-key-reveal">
              <code className="api-key-plaintext">{createdKey.api_key}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
                {copied ? <Check /> : <Copy />}
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            <div className="api-key-reveal-hint">
              名称：{createdKey.name} · 前缀：{createdKey.key_prefix}…
            </div>
            <Button type="button" onClick={() => setCreatedKey(null)}>
              我已保存，关闭
            </Button>
          </DialogContent>
        </Dialog>
      )}

      {revokeTarget && (
        <ConfirmDialog
          title="吊销 API Key"
          message={`“${revokeTarget.name}”将被永久吊销，使用此 Key 的脚本将无法继续认证，此操作不可撤销。`}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={() => deleteMutation.mutate(revokeTarget.id)}
        />
      )}
    </section>
  );
}
