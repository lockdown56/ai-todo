const DEFAULT_API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

const API_BASE_URL_STORAGE_KEY = "ai-api-base-url";

export function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function getDefaultApiBaseUrl(): string {
  return DEFAULT_API_BASE_URL;
}

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_API_BASE_URL;
  const stored = window.localStorage.getItem(API_BASE_URL_STORAGE_KEY);
  return normalizeApiBaseUrl(stored || DEFAULT_API_BASE_URL);
}

export function setApiBaseUrl(value: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, normalizeApiBaseUrl(value));
}

export function resetApiBaseUrl(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
}
