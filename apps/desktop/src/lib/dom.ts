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
