import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LoaderCircle, SlidersHorizontal } from "lucide-react";
import { testApiBaseUrl } from "@/api";
import {
  getApiBaseUrl,
  getDefaultApiBaseUrl,
  normalizeApiBaseUrl,
  resetApiBaseUrl,
  setApiBaseUrl,
} from "@/config";
import { clearAuthSession, notifyAuthChanged } from "@/auth";
import { queryKeys } from "@/query";
import { errorMessage } from "@/lib/error-utils";

export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [apiBaseUrl, setApiBaseUrlValue] = useState(() => getApiBaseUrl());
  const [savedApiBaseUrl, setSavedApiBaseUrl] = useState(() => getApiBaseUrl());
  const [status, setStatus] = useState<"idle" | "saving" | "testing" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    const current = getApiBaseUrl();
    setApiBaseUrlValue(current);
    setSavedApiBaseUrl(current);
  }, []);

  const refreshAppData = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.health });
    void queryClient.invalidateQueries({ queryKey: queryKeys.lists });
    void queryClient.invalidateQueries({ queryKey: queryKeys.trashLists });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const save = async () => {
    const cleaned = normalizeApiBaseUrl(apiBaseUrl);
    if (!cleaned) {
      setStatus("error");
      setMessage("请输入有效的后端接口地址。");
      return;
    }
    setStatus("saving");
    setMessage("");
    const apiChanged = cleaned !== savedApiBaseUrl;
    setApiBaseUrl(cleaned);
    setApiBaseUrlValue(cleaned);
    setSavedApiBaseUrl(cleaned);
    refreshAppData();
    if (apiChanged) {
      clearAuthSession();
      notifyAuthChanged();
      navigate("/login", { replace: true });
      return;
    }
    setStatus("success");
    setMessage("已保存，后续请求会使用新的地址。");
  };

  const test = async () => {
    const cleaned = normalizeApiBaseUrl(apiBaseUrl);
    if (!cleaned) {
      setStatus("error");
      setMessage("请输入有效的后端接口地址。");
      return;
    }
    setStatus("testing");
    setMessage("");
    try {
      await testApiBaseUrl(cleaned);
      setStatus("success");
      setMessage("连接成功。");
    } catch (error) {
      setStatus("error");
      setMessage(errorMessage(error));
    }
  };

  const reset = () => {
    const apiChanged = savedApiBaseUrl !== getDefaultApiBaseUrl();
    resetApiBaseUrl();
    const defaultUrl = getDefaultApiBaseUrl();
    setApiBaseUrlValue(defaultUrl);
    setSavedApiBaseUrl(defaultUrl);
    setStatus("idle");
    setMessage("");
    refreshAppData();
    if (apiChanged) {
      clearAuthSession();
      notifyAuthChanged();
      navigate("/login", { replace: true });
    }
  };

  return (
    <section className="settings-page">
      <div className="settings-header">
        <div className="settings-title">
          <div className="settings-icon">
            <SlidersHorizontal />
          </div>
          <div>
            <h1>设置</h1>
            <p>配置桌面端请求的后端接口地址。</p>
          </div>
        </div>
        <Badge variant="secondary">当前：{savedApiBaseUrl || getDefaultApiBaseUrl()}</Badge>
      </div>
      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="form-field">
          <Label htmlFor="api-base-url">后端接口地址</Label>
          <Input
            id="api-base-url"
            type="text"
            value={apiBaseUrl}
            onChange={(event) => setApiBaseUrlValue(event.target.value)}
            placeholder={getDefaultApiBaseUrl()}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="settings-help">
            保存后会立即生效。留空会恢复默认地址 {getDefaultApiBaseUrl()}。
          </span>
        </div>
        <div className="settings-actions">
          <Button type="button" variant="outline" onClick={reset} disabled={status === "saving" || status === "testing"}>
            恢复默认
          </Button>
          <Button type="button" variant="outline" onClick={() => void test()} disabled={status === "saving" || status === "testing"}>
            {status === "testing" && <LoaderCircle className="spin" />}
            测试连接
          </Button>
          <Button type="submit" disabled={status === "saving" || status === "testing"}>
            {status === "saving" && <LoaderCircle className="spin" />}
            保存
          </Button>
        </div>
        {message && (
          <div className={status === "error" ? "settings-message error" : "settings-message"}>
            {message}
          </div>
        )}
      </form>
    </section>
  );
}