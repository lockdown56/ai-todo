import { useEffect } from "react";
import { AppRoutes } from "@/app/AppRoutes";
import { syncTraySettingsToBackend } from "@/lib/tray-settings";

export default function App() {
  useEffect(() => {
    void syncTraySettingsToBackend();
  }, []);

  return <AppRoutes />;
}
