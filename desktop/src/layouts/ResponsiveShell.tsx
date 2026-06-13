import { useWindowWidth } from "@/lib/hooks";
import { DesktopShell } from "./DesktopShell";
import { MobileShell } from "./MobileShell";

const MOBILE_BREAKPOINT = 900;

export function ResponsiveShell() {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;

  return isMobile ? <MobileShell /> : <DesktopShell />;
}