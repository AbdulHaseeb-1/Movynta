/** The part of a key press the composer reads. */
export interface ComposerKeyPress {
  key: string;
  shiftKey: boolean;
  /** True while an input method (Chinese, Japanese, Korean, accents) is still composing text. */
  isComposing: boolean;
}

/** What a key press in the message field does. Anything else is typing, which the field handles itself. */
export type ComposerKeyAction = "send" | "stop" | "none";

/**
 * Enter sends and Shift+Enter adds a line. Esc stops a reply that is being written. While an input method is
 * composing, both keys belong to it: Enter picks a candidate and Esc cancels the composition, and neither may
 * send a message or stop the assistant.
 */
export function composerKeyAction(press: ComposerKeyPress, busy: boolean): ComposerKeyAction {
  if (press.isComposing) return "none";
  if (press.key === "Escape") return busy ? "stop" : "none";
  if (press.key === "Enter" && !press.shiftKey) return "send";
  return "none";
}
