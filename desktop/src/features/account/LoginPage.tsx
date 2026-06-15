import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, LoaderCircle } from "lucide-react";
import { api } from "@/api";
import { setAuthSession } from "@/auth";
import { errorMessage } from "@/lib/error-utils";
import { getDefaultWorkspaceRoute } from "@/lib/workspace-preferences";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const from =
    (location.state as { from?: string } | null)?.from || getDefaultWorkspaceRoute();

  const submit = async () => {
    setPending(true);
    setMessage("");
    try {
      const response = await api.login(username.trim(), password);
      setAuthSession(response.access_token, response.user);
      queryClient.clear();
      navigate(from === "/login" ? getDefaultWorkspaceRoute() : from, { replace: true });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">
            <KeyRound />
          </div>
          <div>
            <h1>登录 AI 清单</h1>
            <p>使用服务端配置的账号继续。</p>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="form-field">
            <Label htmlFor="login-username">用户名</Label>
            <Input
              id="login-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div className="form-field">
            <Label htmlFor="login-password">密码</Label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {message && <div className="settings-message error">{message}</div>}
          <Button type="submit" disabled={pending}>
            {pending && <LoaderCircle className="spin" />}
            登录
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate("/settings")}>
            设置后端接口地址
          </Button>
        </form>
      </section>
    </main>
  );
}