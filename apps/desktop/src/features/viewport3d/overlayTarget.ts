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
