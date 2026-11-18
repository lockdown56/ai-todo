/**
 * 允许跳转的会话链接域名。初始为空：只有确认目标应用的会话链接可以在
 * 桌面端安全打开后，才把对应域名加入这里。匹配时域名及其子域名都允许。
 */
export const SESSION_URL_ALLOWED_HOSTS: readonly string[] = [];

export function isAllowedSessionHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return SESSION_URL_ALLOWED_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/** 只有 HTTPS 且在允许列表内的会话链接才返回可打开的地址。 */
export function resolveSessionUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!isAllowedSessionHost(url.hostname)) return null;
  return url.toString();
}
