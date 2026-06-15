import { useCallback, useEffect, useRef, useState } from "react";
import type { DropPosition } from "@/lib/list-reorder";

const DRAG_THRESHOLD_PX = 8;
const SCROLL_CANCEL_THRESHOLD_PX = 10;

export interface ListDragSource {
  type: "list";
  id: string;
  groupId: string | null;
}

export interface GroupDragSource {
  type: "group";
  id: string;
}

export type SortDragSource = ListDragSource | GroupDragSource;

export interface DropIndicator {
  targetId: string;
  position: DropPosition;
  targetKind: "list" | "group";
  groupId: string | null;
}

interface PointerSession {
  source: SortDragSource;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  pressActivated: boolean;
  target: HTMLElement;
  longPressTimer: ReturnType<typeof setTimeout> | null;
  detachListeners: () => void;
}

function clearLongPressTimer(session: PointerSession) {
  if (session.longPressTimer) {
    clearTimeout(session.longPressTimer);
    session.longPressTimer = null;
  }
}

function dropPositionFromY(clientY: number, element: Element): DropPosition {
  const rect = element.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function sortTargetFromPoint(clientX: number, clientY: number): HTMLElement | null {
  const element = document.elementFromPoint(clientX, clientY);
  return element?.closest<HTMLElement>("[data-sort-id]") ?? null;
}

export function usePointerListSort({
  canDropOnList,
  canDropOnGroup,
  onReorderLists,
  onReorderTopLevel,
  longPressMs,
}: {
  canDropOnList: (source: SortDragSource, groupId: string | null, listId: string) => boolean;
  canDropOnGroup: (source: SortDragSource, groupId: string) => boolean;
  onReorderLists: (activeId: string, overId: string, position: DropPosition) => void;
  onReorderTopLevel: (activeId: string, overId: string, position: DropPosition) => void;
  /** 长按多久后进入拖拽排序；未设置时移动超过阈值即开始拖拽（桌面端） */
  longPressMs?: number;
}) {
  const longPressMsRef = useRef(longPressMs);
  longPressMsRef.current = longPressMs;

  const sessionRef = useRef<PointerSession | null>(null);
  const suppressClickRef = useRef(false);
  const dropIndicatorRef = useRef<DropIndicator | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const setIndicator = useCallback((indicator: DropIndicator | null) => {
    dropIndicatorRef.current = indicator;
    setDropIndicator(indicator);
  }, []);

  const clearSession = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      clearLongPressTimer(session);
      session.detachListeners();
    }
    sessionRef.current = null;
    setDraggingId(null);
    setIndicator(null);
    document.body.classList.remove("is-list-sorting");
  }, [setIndicator]);

  const commitDrop = useCallback(
    (source: SortDragSource, indicator: DropIndicator) => {
      if (source.id === indicator.targetId) return;

      if (indicator.targetKind === "group") {
        if (!canDropOnGroup(source, indicator.targetId)) return;
        onReorderTopLevel(source.id, indicator.targetId, indicator.position);
        return;
      }

      if (!canDropOnList(source, indicator.groupId, indicator.targetId)) return;
      if (indicator.groupId !== null) {
        onReorderLists(source.id, indicator.targetId, indicator.position);
      } else if (source.type === "list" && source.groupId === null) {
        onReorderLists(source.id, indicator.targetId, indicator.position);
      } else {
        onReorderTopLevel(source.id, indicator.targetId, indicator.position);
      }
    },
    [canDropOnGroup, canDropOnList, onReorderLists, onReorderTopLevel],
  );

  const updateIndicator = useCallback(
    (source: SortDragSource, clientX: number, clientY: number) => {
      const target = sortTargetFromPoint(clientX, clientY);
      if (!target) {
        setIndicator(null);
        return;
      }

      const targetId = target.dataset.sortId;
      if (!targetId) {
        setIndicator(null);
        return;
      }

      const targetKind = target.dataset.sortKind === "group" ? "group" : "list";
      const groupId = target.dataset.sortGroup || null;
      const position = dropPositionFromY(clientY, target);

      if (targetKind === "group") {
        if (!canDropOnGroup(source, targetId)) {
          setIndicator(null);
          return;
        }
      } else if (!canDropOnList(source, groupId, targetId)) {
        setIndicator(null);
        return;
      }

      setIndicator({ targetId, position, targetKind, groupId });
    },
    [canDropOnGroup, canDropOnList, setIndicator],
  );

  const activatePressDrag = useCallback((session: PointerSession) => {
    session.pressActivated = true;
    setDraggingId(session.source.id);
    document.body.classList.add("is-list-sorting");
    if (!session.target.hasPointerCapture(session.pointerId)) {
      session.target.setPointerCapture(session.pointerId);
    }
  }, []);

  const beginDrag = useCallback(
    (session: PointerSession, event: PointerEvent) => {
      if (!session.moved) {
        session.moved = true;
        if (!session.target.hasPointerCapture(event.pointerId)) {
          session.target.setPointerCapture(event.pointerId);
        }
        setDraggingId(session.source.id);
        document.body.classList.add("is-list-sorting");
      }

      event.preventDefault();
      updateIndicator(session.source, event.clientX, event.clientY);
    },
    [updateIndicator],
  );

  const cancelSessionForScroll = useCallback((session: PointerSession) => {
    suppressClickRef.current = true;
    clearLongPressTimer(session);
    session.detachListeners();
    sessionRef.current = null;
  }, []);

  const processPointerMove = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      const pressDelay = longPressMsRef.current;

      if (pressDelay) {
        if (!session.pressActivated) {
          if (distance >= SCROLL_CANCEL_THRESHOLD_PX) {
            cancelSessionForScroll(session);
          }
          return;
        }

        beginDrag(session, event);
        return;
      }

      if (!session.moved) {
        if (distance < DRAG_THRESHOLD_PX) return;
      }

      beginDrag(session, event);
    },
    [beginDrag, cancelSessionForScroll],
  );

  const processPointerUp = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      clearLongPressTimer(session);

      if (session.moved) {
        suppressClickRef.current = true;
        const indicator = dropIndicatorRef.current;
        if (indicator) {
          commitDrop(session.source, indicator);
        }
      } else if (session.pressActivated) {
        suppressClickRef.current = true;
      }

      if (session.target.hasPointerCapture(event.pointerId)) {
        session.target.releasePointerCapture(event.pointerId);
      }

      session.detachListeners();
      sessionRef.current = null;
      setDraggingId(null);
      setIndicator(null);
      document.body.classList.remove("is-list-sorting");
    },
    [commitDrop, setIndicator],
  );

  const processPointerCancel = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      if (session.target.hasPointerCapture(event.pointerId)) {
        session.target.releasePointerCapture(event.pointerId);
      }
      clearSession();
    },
    [clearSession],
  );

  const attachDocumentListeners = useCallback(
    (pointerId: number) => {
      const onMove = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        processPointerMove(event);
      };
      const onUp = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        processPointerUp(event);
      };
      const onCancel = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        processPointerCancel(event);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);

      return () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
      };
    },
    [processPointerCancel, processPointerMove, processPointerUp],
  );

  const onSortPointerDown = useCallback(
    (event: React.PointerEvent, source: SortDragSource) => {
      if (event.button !== 0) return;

      const detachListeners = attachDocumentListeners(event.pointerId);
      const session: PointerSession = {
        source,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        pressActivated: false,
        target: event.currentTarget as HTMLElement,
        longPressTimer: null,
        detachListeners,
      };
      sessionRef.current = session;

      const pressDelay = longPressMsRef.current;
      if (pressDelay) {
        session.longPressTimer = setTimeout(() => {
          if (sessionRef.current !== session) return;
          activatePressDrag(session);
        }, pressDelay);
      }
    },
    [activatePressDrag, attachDocumentListeners],
  );

  const onSortPointerMove = useCallback(
    (event: React.PointerEvent) => {
      processPointerMove(event.nativeEvent);
    },
    [processPointerMove],
  );

  const onSortPointerUp = useCallback(
    (event: React.PointerEvent) => {
      processPointerUp(event.nativeEvent);
    },
    [processPointerUp],
  );

  const onSortPointerCancel = useCallback(
    (event: React.PointerEvent) => {
      processPointerCancel(event.nativeEvent);
    },
    [processPointerCancel],
  );

  const consumeClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  useEffect(
    () => () => {
      clearSession();
    },
    [clearSession],
  );

  return {
    dropIndicator,
    draggingId,
    onSortPointerDown,
    onSortPointerMove,
    onSortPointerUp,
    onSortPointerCancel,
    consumeClick,
  };
}
