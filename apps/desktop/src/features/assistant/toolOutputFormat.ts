/** A tool's text, read as JSON when it is JSON, otherwise shown as it is. */
export type ToolText = { readonly kind: "json"; readonly value: unknown } | { readonly kind: "text"; readonly text: string };

/** Reads a stored input or result. A result cut short by the storage limit is not valid JSON, so it reads as text. */
export function readToolText(text: string): ToolText {
  try {
    const value: unknown = JSON.parse(text);
    return { kind: "json", value };
  } catch {
    return { kind: "text", text };
  }
}

/** The text to copy: indented JSON, or the text itself. */
export function copyText(text: ToolText): string {
  return text.kind === "json" ? JSON.stringify(text.value, null, 2) : text.text;
}

/** A size in the largest unit that keeps the number above one, such as `840 B`, `2.4 KB` or `1.1 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The size of a text in UTF-8 bytes. */
export function textBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What a value holds, in words: `12 items`, `4 fields`, `3 lines`, or `empty`. */
export function describeShape(text: ToolText): string {
  if (text.kind === "text") {
    if (text.text.trim() === "") return "empty";
    return plural(text.text.split("\n").length, "line");
  }
  const { value } = text;
  if (Array.isArray(value)) return plural(value.length, "item");
  if (value !== null && typeof value === "object") return plural(Object.keys(value).length, "field");
  if (typeof value === "string") return plural(value.split("\n").length, "line");
  return "one value";
}
