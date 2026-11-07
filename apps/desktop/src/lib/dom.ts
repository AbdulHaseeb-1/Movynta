/**
 * Whether a key press is aimed at a text field, where the editor's shortcuts must leave the key alone.
 * `typeof HTMLElement` keeps this safe where there is no DOM, such as the unit tests.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    typeof HTMLElement !== "undefined" &&
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Gives focus back to the control that opened a dialog or menu, as it closes. Only a control that is still
 * on the page takes it; otherwise the event is left alone and the library's own focus handling runs.
 */
export function returnFocus(target: Pick<HTMLElement, "isConnected" | "focus"> | null | undefined, event: Pick<Event, "preventDefault">): boolean {
  if (!target?.isConnected) return false;
  event.preventDefault();
  target.focus();
  return true;
}
