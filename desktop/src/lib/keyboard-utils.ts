export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    Boolean(target.closest("input, textarea, select")) ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.key === "Process" || event.keyCode === 229;
}

export function shouldIgnoreAppShortcut(event: KeyboardEvent): boolean {
  return isImeComposing(event) || isEditableTarget(event.target);
}

export function isCtrlShortcut(event: KeyboardEvent, key: string): boolean {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === key
  );
}