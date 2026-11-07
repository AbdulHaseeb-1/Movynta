/**
 * A small grammar for the key text shown in the guide and the shortcut reference, so the same strings can be
 * drawn as key caps and looked up from a key press.
 *
 *   keys        = alternative { (" / " | " · ") alternative }
 *   alternative = step { " then " step }      e.g. "B then Drag"
 *   step        = part { "+" part }           e.g. "Ctrl+Shift+Z", "Space + Drag"
 *
 * A part is a key ("Ctrl", "Z", "Numpad 1", "Esc", "↑") or a pointer action ("Click", "Drag", "Scroll"). An
 * alternative with any other word ("Mesh menu", "Type a number") is shown as plain text. A lone "+" is the
 * plus key, not a separator.
 */

export type KeyPart =
  | { readonly kind: "key"; readonly key: string; readonly modifier: boolean }
  | { readonly kind: "pointer"; readonly action: string };

/** Keys pressed together, such as Ctrl+B. */
export type KeyStep = readonly KeyPart[];

export type KeyAlternative =
  { readonly kind: "keys"; readonly steps: readonly KeyStep[] } | { readonly kind: "label"; readonly text: string };

const MODIFIERS = ["Ctrl", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIERS)[number];

const NAMED_KEYS: Readonly<Record<string, string>> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  enter: "Enter",
  esc: "Esc",
  delete: "Delete",
  backspace: "Backspace",
  home: "Home",
  end: "End",
  space: "Space",
  tab: "Tab",
};

const POINTER_ACTIONS = new Set([
  "click",
  "right-click",
  "double-click",
  "drag",
  "right-drag",
  "middle-drag",
  "scroll",
  "move pointer",
]);

/** Characters that name a key on their own. The minus key is shown as the minus sign, "−", however it is written. */
const SYMBOL_KEYS: Readonly<Record<string, string>> = {
  "−": "−",
  "-": "−",
  "+": "+",
  "=": "=",
  ".": ".",
  "?": "?",
  "/": "/",
  "↑": "↑",
  "↓": "↓",
  "←": "←",
  "→": "→",
};

function isModifier(key: string): key is Modifier {
  return (MODIFIERS as readonly string[]).includes(key);
}

/** The canonical name of one key, or undefined when the text is not a key. */
export function keyName(text: string): string | undefined {
  const trimmed = text.trim();
  const named = NAMED_KEYS[trimmed.toLowerCase()];
  if (named) return named;
  const symbol = SYMBOL_KEYS[trimmed];
  if (symbol) return symbol;
  if (/^[a-z0-9]$/i.test(trimmed)) return trimmed.toUpperCase();
  const numpad = /^numpad\s*(\d)$/i.exec(trimmed);
  if (numpad) return `Numpad ${numpad[1] ?? ""}`;
  if (/^f([1-9]|1[0-2])$/i.test(trimmed)) return trimmed.toUpperCase();
  return undefined;
}

function parsePart(text: string): KeyPart | undefined {
  const trimmed = text.trim();
  if (POINTER_ACTIONS.has(trimmed.toLowerCase())) return { kind: "pointer", action: trimmed };
  const key = keyName(trimmed);
  return key === undefined ? undefined : { kind: "key", key, modifier: isModifier(key) };
}

function parseStep(text: string): KeyStep | undefined {
  const trimmed = text.trim();
  const names = trimmed === "+" ? ["+"] : trimmed.split("+");
  const parts: KeyPart[] = [];
  for (const piece of names) {
    const part = parsePart(piece);
    if (!part) return undefined;
    parts.push(part);
  }
  return parts.length > 0 ? parts : undefined;
}

function parseAlternative(text: string): KeyAlternative {
  const steps: KeyStep[] = [];
  for (const piece of text.split(" then ")) {
    const step = parseStep(piece);
    if (!step) return { kind: "label", text: text.trim() };
    steps.push(step);
  }
  return { kind: "keys", steps };
}

function pieces(text: string, separator: string): string[] {
  return text
    .split(separator)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

/**
 * Splits key text into groups (" · ", usually different roles such as confirm and cancel) of alternatives
 * (" / "). Parsing never fails: unknown words become labels.
 */
export function parseKeyGroups(text: string): KeyAlternative[][] {
  return pieces(text, " · ").map((group) => pieces(group, " / ").map(parseAlternative));
}

/** Every alternative the key text offers, ignoring how they are grouped. */
export function parseKeys(text: string): KeyAlternative[] {
  return parseKeyGroups(text).flat();
}

/**
 * The id of a keyboard-only step that ends in a non-modifier key, such as "Ctrl+Shift+Z", or undefined for
 * steps that use the pointer or only hold a modifier. Modifiers are always ordered Ctrl, Alt, Shift.
 */
export function stepChord(step: KeyStep): string | undefined {
  const modifiers = new Set<Modifier>();
  let main: string | undefined;
  for (const part of step) {
    if (part.kind === "pointer") return undefined;
    if (isModifier(part.key)) modifiers.add(part.key);
    else if (main === undefined) main = part.key;
    else return undefined;
  }
  if (main === undefined) return undefined;
  return [...MODIFIERS.filter((modifier) => modifiers.has(modifier)), main].join("+");
}

/** Every keyboard chord the text names; a sequence such as "B then Drag" is found by its first step. */
export function chordsOf(text: string): string[] {
  const chords = new Set<string>();
  for (const alternative of parseKeys(text)) {
    if (alternative.kind !== "keys") continue;
    const first = alternative.steps[0];
    const chord = first ? stepChord(first) : undefined;
    if (chord) chords.add(chord);
  }
  return [...chords];
}

/** The parts of a key press needed to name it, so the lookup can be tested without a DOM event. */
export type KeyPress = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

const EVENT_KEYS: Readonly<Record<string, string>> = {
  " ": "Space",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "Enter",
  Delete: "Delete",
  Backspace: "Backspace",
  Home: "Home",
  End: "End",
  Tab: "Tab",
};

function eventKey(event: KeyPress): { key: string; symbol: boolean } | undefined {
  const numpad = /^Numpad(\d)$/.exec(event.code);
  if (numpad) return { key: `Numpad ${numpad[1] ?? ""}`, symbol: false };
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter?.[1]) return { key: letter[1], symbol: false };
  const digit = /^Digit(\d)$/.exec(event.code);
  if (digit?.[1] && !event.shiftKey) return { key: digit[1], symbol: false };
  const named = EVENT_KEYS[event.key];
  if (named) return { key: named, symbol: false };
  if (/^F([1-9]|1[0-2])$/.test(event.key)) return { key: event.key, symbol: false };
  if (event.key.length === 1) {
    const symbol = keyName(event.key);
    if (symbol) return { key: symbol, symbol: !/^[A-Z0-9]$/.test(symbol) };
  }
  return undefined;
}

/**
 * The chord a key press stands for, in the same form as `stepChord`, or undefined while only modifiers are
 * held. Command counts as Ctrl, as it does for undo and redo on macOS. For symbols such as "?" or "+", Shift
 * is part of typing the character, so it is left out.
 */
export function chordFromEvent(event: KeyPress): string | undefined {
  if (["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(event.key)) return undefined;
  const pressed = eventKey(event);
  if (!pressed) return undefined;
  const modifiers: Modifier[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey && !pressed.symbol) modifiers.push("Shift");
  return [...modifiers, pressed.key].join("+");
}

/** The keys of a chord id, in order: "Ctrl+Shift+Z" gives Ctrl, Shift and Z, and "Ctrl++" gives Ctrl and +. */
export function chordKeys(chord: string): string[] {
  if (chord === "+") return ["+"];
  if (chord.endsWith("++")) return [...chord.slice(0, -2).split("+"), "+"];
  return chord.split("+");
}
