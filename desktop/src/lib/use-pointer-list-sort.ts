import { useCallback, useEffect, useRef, useState } from "react";
import type { DropPosition } from "@/lib/list-reorder";

const DRAG_THRESHOLD_PX = 8;

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
  target: HTMLElement;
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
}: {
  canDropOnList: (source: SortDragSource, groupId: string | null, listId: string) => boolean;
  canDropOnGroup: (source: SortDragSource, groupId: string) => boolean;
  onReorderLists: (activeId: string, overId: string, position: DropPosition) => void;
  onReorderTopLevel: (activeId: string, overId: string, position: DropPosition) => void;
}) {
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

  const processPointerMove = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (!session.moved) {
        if (distance < DRAG_THRESHOLD_PX) return;
        session.moved = true;
        session.target.setPointerCapture(event.pointerId);
        setDraggingId(session.source.id);
        document.body.classList.add("is-list-sorting");
      }

      event.preventDefault();
      updateIndicator(session.source, event.clientX, event.clientY);
    },
    [updateIndicator],
  );

  const processPointerUp = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      if (session.moved) {
        suppressClickRef.current = true;
        const indicator = dropIndicatorRef.current;
        if (indicator) {
          commitDrop(session.source, indicator);
        }
      }

      if (session.target.hasPointerCapture(event.pointerId)) {
        session.target.releasePointerCapture(event.pointerId);
      }
      clearSession();
    },
    [clearSession, commitDrop],
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
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
      };
      const onCancel = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        processPointerCancel(event);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    },
    [processPointerCancel, processPointerMove, processPointerUp],
  );

  const onSortPointerDown = useCallback(
    (event: React.PointerEvent, source: SortDragSource) => {
      if (event.button !== 0) return;
      sessionRef.current = {
        source,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        target: event.currentTarget as HTMLElement,
      };
      attachDocumentListeners(event.pointerId);
    },
    [attachDocumentListeners],
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
      document.body.classList.remove("is-list-sorting");
    },
    [],
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
