import { isTypingTarget } from "@/lib/dom";

/** Surfaces that own the keyboard while they are open: Radix closes them with Escape and moves in them with letters. */
const MODAL_SURFACE = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Whether a key press is aimed at a text field, a dialog or a menu, where the Edit-mode shortcuts must leave it alone. */
export function shortcutsBlocked(event: Pick<KeyboardEvent, "target">): boolean {
  const target = event.target;
  if (isTypingTarget(target)) return true;
  return typeof HTMLElement !== "undefined" && target instanceof HTMLElement && typeof target.closest === "function" && target.closest(MODAL_SURFACE) !== null;
}
