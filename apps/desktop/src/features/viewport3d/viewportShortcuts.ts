import { presetForKey, type ViewPreset } from "./viewPresets";

/** What a navigation or display key asks the viewport to do. */
export type ViewportShortcut =
  | { kind: "view"; preset: ViewPreset }
  | { kind: "zoom"; direction: "in" | "out" }
  | { kind: "reset" }
  | { kind: "frame"; scope: "selection" | "all" }
  | { kind: "toggle-wireframe" }
  | { kind: "toggle-xray" };

/** The parts of a key press the mapping reads, so it can be tested without a DOM event. */
export type ShortcutKey = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat"
>;

/**
 * The viewport action a key press stands for, or undefined. The keys follow Blender: numpad 1, 3 and 7
 * (with Ctrl, the opposite side), Shift+Z for wireframe and Alt+Z for X-ray. They work in Object and
 * Edit mode alike; a tool that is using a key claims it first.
 */
export function viewportShortcut(event: ShortcutKey): ViewportShortcut | undefined {
  if (event.repeat || event.metaKey) return undefined;
  if (event.code === "KeyZ" && !event.ctrlKey) {
    if (event.altKey && !event.shiftKey) return { kind: "toggle-xray" };
    if (event.shiftKey && !event.altKey) return { kind: "toggle-wireframe" };
    return undefined;
  }
  if (event.altKey) return undefined;
  const preset = presetForKey(event.code, event.ctrlKey);
  if (preset) return { kind: "view", preset };
  if (event.ctrlKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === "=" || key === "+") return { kind: "zoom", direction: "in" };
  if (key === "-" || key === "_") return { kind: "zoom", direction: "out" };
  // The top-row zero is a shifted key on AZERTY layouts, so it is matched by its position as well as by its character.
  if (key === "0" || event.code === "Digit0") return { kind: "reset" };
  if (key === ".") return { kind: "frame", scope: "selection" };
  if (event.key === "Home") return { kind: "frame", scope: "all" };
  return undefined;
}
