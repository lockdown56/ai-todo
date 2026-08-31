import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { resetMockData, server } from "./server";

Object.defineProperties(Element.prototype, {
  hasPointerCapture: {
    configurable: true,
    value: () => false,
  },
  setPointerCapture: {
    configurable: true,
    value: () => undefined,
  },
  releasePointerCapture: {
    configurable: true,
    value: () => undefined,
  },
  scrollIntoView: {
    configurable: true,
    value: () => undefined,
  },
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
});

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  resetMockData();
  localStorage.clear();
  localStorage.setItem("todolist-access-token", "test-access-token");
  localStorage.setItem("todolist-refresh-token", "test-refresh-token");
  localStorage.setItem("todolist-access-expires-at", "2099-06-18T08:00:00Z");
  localStorage.setItem("todolist-access-expires-in", "604800");
  localStorage.setItem("todolist-refresh-expires-at", "2099-07-18T08:00:00Z");
  localStorage.setItem(
    "todolist-auth-user",
    JSON.stringify({
      id: "00000000-0000-4000-8000-000000000001",
      username: "admin",
      display_name: "默认用户",
    }),
  );
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1440,
  });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
