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
 * Elements that hold an open menu, list or dialog. Radix renders these in a portal and moves the focus into them,
 * so a key pressed there is aimed at the overlay (type-ahead, Escape, Delete), not at the scene behind it.
 */
const OVERLAY_SELECTOR = '[role="menu"], [role="menubar"], [role="listbox"], [role="dialog"], [role="alertdialog"]';

/**
 * Whether a key press is aimed at an open menu, list or dialog, where the editor's own shortcuts must stay quiet.
 * Without this, typing "x" to pick the X axis in a list would delete the selected object. `typeof Element` keeps
 * this safe where there is no DOM, such as the unit tests.
 */
export function isOverlayTarget(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && target instanceof Element && target.closest(OVERLAY_SELECTOR) !== null;
}

/**
 * Whether the editor's single-key shortcuts must leave this key press alone: it is aimed at a text field, or at an
 * open menu, list or dialog. A focused button does not block them, because buttons use Space and Enter, not letters,
 * and a button keeps the focus after it is clicked.
 */
export function isShortcutBlocked(target: EventTarget | null): boolean {
  return isTypingTarget(target) || isOverlayTarget(target);
}

/**
 * Gives focus back to the control that opened a dialog or menu, as it closes. Only a control that is still
 * on the page takes it; otherwise the event is left alone and the library's own focus handling runs.
 */
export function returnFocus(
  target: Pick<HTMLElement, "isConnected" | "focus"> | null | undefined,
  event: Pick<Event, "preventDefault">,
): boolean {
  if (!target?.isConnected) return false;
  event.preventDefault();
  target.focus();
  return true;
}
