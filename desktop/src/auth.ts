import type { AuthToken, AuthUser } from "./types";

const ACCESS_TOKEN_KEY = "todolist-access-token";
const REFRESH_TOKEN_KEY = "todolist-refresh-token";
const AUTH_USER_KEY = "todolist-auth-user";
const ACCESS_EXPIRES_AT_KEY = "todolist-access-expires-at";
const ACCESS_EXPIRES_IN_KEY = "todolist-access-expires-in";
const REFRESH_EXPIRES_AT_KEY = "todolist-refresh-expires-at";
const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export const AUTH_CHANGED_EVENT = "todolist-auth-changed";

const AUTH_STORAGE_KEYS = new Set([
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  AUTH_USER_KEY,
  ACCESS_EXPIRES_AT_KEY,
  ACCESS_EXPIRES_IN_KEY,
  REFRESH_EXPIRES_AT_KEY,
]);

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(AUTH_USER_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value) as AuthUser;
  } catch {
    window.localStorage.removeItem(AUTH_USER_KEY);
    return null;
  }
}

export function shouldRefreshAccessToken(now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  if (!getAccessToken() || !getRefreshToken()) return false;
  const expiresAt = Date.parse(window.localStorage.getItem(ACCESS_EXPIRES_AT_KEY) || "");
  if (Number.isNaN(expiresAt)) return true;
  const expiresInSeconds = Number(window.localStorage.getItem(ACCESS_EXPIRES_IN_KEY) || "0");
  const threshold = Math.min(
    REFRESH_THRESHOLD_MS,
    Math.max(60_000, expiresInSeconds > 0 ? expiresInSeconds * 200 : REFRESH_THRESHOLD_MS),
  );
  return expiresAt - now <= threshold;
}

export function isAuthStorageEvent(event: StorageEvent): boolean {
  return event.storageArea === window.localStorage && AUTH_STORAGE_KEYS.has(event.key || "");
}

function writeAuthSession(session: AuthToken): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, session.access_token);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, session.refresh_token);
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(session.user));
  window.localStorage.setItem(ACCESS_EXPIRES_AT_KEY, session.expires_at);
  window.localStorage.setItem(ACCESS_EXPIRES_IN_KEY, String(session.expires_in));
  window.localStorage.setItem(REFRESH_EXPIRES_AT_KEY, session.refresh_expires_at);
}

export function setAuthSession(session: AuthToken): void {
  writeAuthSession(session);
  notifyAuthChanged();
}

export function replaceAuthSession(session: AuthToken): void {
  writeAuthSession(session);
}

export function setStoredUser(user: AuthUser): void {
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function clearAuthSession(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_USER_KEY);
  window.localStorage.removeItem(ACCESS_EXPIRES_AT_KEY);
  window.localStorage.removeItem(ACCESS_EXPIRES_IN_KEY);
  window.localStorage.removeItem(REFRESH_EXPIRES_AT_KEY);
}

export function notifyAuthChanged(): void {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function expireAuthSession(): void {
  clearAuthSession();
  notifyAuthChanged();
}
