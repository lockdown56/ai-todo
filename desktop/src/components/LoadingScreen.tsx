import { LoaderCircle } from "lucide-react";

export function LoadingScreen() {
  return <div className="full-screen-state"><LoaderCircle className="spin" /><span>正在连接服务</span></div>;
}