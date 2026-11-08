import type { ActivityStep, ChatMessage } from "./types";

/** One part of a reply: a run of text, or one step of the work. */
export type MessagePart = { kind: "text"; id: string; text: string } | { kind: "step"; id: string; step: ActivityStep };

/**
 * Interleaves a reply's text with its tool steps in the order they happened, so tool calls
 * appear inline between the paragraphs written before and after them.
 */
export function buildParts(message: ChatMessage): MessagePart[] {
  const parts: MessagePart[] = [];
  let cursor = 0;
  for (const step of message.activity) {
    const end = Math.min(Math.max(step.contentOffset ?? cursor, cursor), message.content.length);
    const text = message.content.slice(cursor, end);
    if (text.trim()) parts.push({ kind: "text", id: `text-${cursor}`, text });
    parts.push({ kind: "step", id: step.id, step });
    cursor = end;
  }
  const rest = message.content.slice(cursor);
  if (rest.trim()) parts.push({ kind: "text", id: `text-${cursor}`, text: rest });
  return parts;
}
