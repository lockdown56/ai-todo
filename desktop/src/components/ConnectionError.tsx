import { Button } from "@/components/ui/button";
import { LoaderCircle, RefreshCw, SlidersHorizontal, WifiOff } from "lucide-react";
import { getApiBaseUrl } from "@/config";

export function ConnectionError({
  message,
  onRetry,
  onOpenSettings,
  pending,
}: {
  message: string;
  onRetry: () => void;
  onOpenSettings: () => void;
  pending: boolean;
}) {
  return (
    <div className="full-screen-state connection-error">
      <WifiOff />
      <h1>无法连接到服务</h1>
      <p>{message}</p>
      <p>请确认 API 服务已启动并运行在 {getApiBaseUrl()}</p>
      <div className="connection-actions">
        <Button variant="outline" onClick={onOpenSettings}>
          <SlidersHorizontal />
          打开设置
        </Button>
        <Button className="primary-button" onClick={onRetry} disabled={pending}>{pending ? <LoaderCircle className="spin" /> : <RefreshCw />} 重试连接</Button>
      </div>
    </div>
  );
}