import { isTauri } from "@tauri-apps/api/core";

const CLOSE_TO_TRAY_KEY = "ai-close-to-tray";
const MINIMIZE_TO_TRAY_KEY = "ai-minimize-to-tray";

export interface TraySettings {
  closeToTray: boolean;
  minimizeToTray: boolean;
}

export function getTraySettings(): TraySettings {
  if (typeof window === "undefined") {
    return { closeToTray: true, minimizeToTray: true };
  }
  return {
    closeToTray: localStorage.getItem(CLOSE_TO_TRAY_KEY) !== "false",
    minimizeToTray: localStorage.getItem(MINIMIZE_TO_TRAY_KEY) !== "false",
  };
}

export function setTraySettings(settings: TraySettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CLOSE_TO_TRAY_KEY, String(settings.closeToTray));
  localStorage.setItem(MINIMIZE_TO_TRAY_KEY, String(settings.minimizeToTray));
}

export async function syncTraySettingsToBackend(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const settings = getTraySettings();
  await invoke("set_tray_settings", { settings });
}
