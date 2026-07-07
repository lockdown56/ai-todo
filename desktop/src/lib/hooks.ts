import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth || 0);
  useEffect(() => {
    // 立即修正初始值（处理 WebView 中 window.innerWidth 可能为 0 的情况）
    setWidth((prev) => (prev === 0 && window.innerWidth ? window.innerWidth : prev));
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}