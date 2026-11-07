import type { KeyPress } from "./keys";

/** The parts of a key press `isHelpShortcut` reads. */
export type HelpKey = KeyPress & Pick<KeyboardEvent, "repeat">;

/**
 * Whether a key press asks for the keyboard shortcuts: "?" (Shift+/ on most layouts) or F1. "?" is ignored
 * while typing, so it can still be typed into a field; F1 works everywhere.
 */
export function isHelpShortcut(event: HelpKey, typing: boolean): boolean {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key === "F1") return true;
  return event.key === "?" && !typing;
}

/** Whether a key press asks to move to the documentation search: "/" outside a text field. */
export function isSearchShortcut(event: HelpKey, typing: boolean): boolean {
  return (
    !typing &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key === "/"
  );
}
