import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, UserRound } from "lucide-react";
import { clearAuthSession, getStoredUser, notifyAuthChanged } from "@/auth";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ApiKeyPanel } from "./ApiKeyPanel";

export function ProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = getStoredUser();

  const logout = () => {
    clearAuthSession();
    queryClient.clear();
    notifyAuthChanged();
    navigate("/login", { replace: true });
  };

  if (!user) return <LoadingScreen />;

  const initial = Array.from(user.display_name.trim())[0]?.toUpperCase() || "U";

  return (
    <section className="settings-page profile-page">
      <div className="settings-header">
        <div className="settings-title">
          <div className="settings-icon">
            <UserRound />
          </div>
          <div>
            <h1>个人中心</h1>
            <p>查看当前登录账号和认证状态。</p>
          </div>
        </div>
        <Badge variant="secondary">已登录</Badge>
      </div>
      <section className="settings-card profile-card" aria-label="账号信息">
        <div className="profile-summary">
          <div className="profile-avatar" aria-hidden="true">{initial}</div>
          <div>
            <h2>{user.display_name}</h2>
            <p>@{user.username}</p>
          </div>
        </div>
        <dl className="profile-details">
          <div>
            <dt>用户名</dt>
            <dd>{user.username}</dd>
          </div>
          <div>
            <dt>用户 ID</dt>
            <dd>{user.id}</dd>
          </div>
          <div>
            <dt>认证方式</dt>
            <dd>单用户 Bearer Token</dd>
          </div>
        </dl>
      </section>
      <ApiKeyPanel />
      <section className="settings-card profile-danger" aria-label="登录管理">
        <div>
          <strong>退出当前账号</strong>
          <p>退出后会清除本机保存的登录凭据，需要重新输入用户名和密码。</p>
        </div>
        <Button type="button" variant="destructive" onClick={logout}>
          <LogOut />
          退出登录
        </Button>
      </section>
    </section>
  );
}