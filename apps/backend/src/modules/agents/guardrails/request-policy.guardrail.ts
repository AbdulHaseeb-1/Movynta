import type { AgentInputItem, InputGuardrail } from "@openai/agents";

/** The longest message, in characters, that a user may send in one request. */
export const MAX_REQUEST_CHARACTERS = 4000;

/** System execution stays unavailable; JavaScript modeling calculations use the isolated tool. */
const CODE_EXECUTION_PATTERN =
  /\b(run|execute|eval)\b[\s\S]{0,40}\b(python|shell|bash|powershell|cmd)\b|\bos\.system\b|\bsubprocess\b|\bchild_process\b/i;

/** Whether a request is allowed, and if not, the rule that refused it. */
export type RequestVerdict =
  | { readonly tripwireTriggered: true; readonly reason: "request_too_long" | "code_execution_requested" }
  | { readonly tripwireTriggered: false; readonly reason: "allowed" };

function partText(part: unknown): string {
  return typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "";
}

/**
 * The words of a message. A message with pictures carries what the user typed first, then a line naming each
 * picture; only what the user typed is judged, so a long file name cannot make a request too long.
 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const typed = content.findIndex(
    (part: unknown) => typeof part === "object" && part !== null && "type" in part && part.type === "input_image",
  );
  const words = typed < 0 ? content : content.slice(0, 1);
  return words.map(partText).join("\n");
}

/**
 * The message the user has just sent. A session replays its earlier messages into every run's input, so only the
 * last user message is judged; judging the whole history would block any conversation once it grew past the limit.
 */
function latestRequestText(input: string | readonly AgentInputItem[]): string {
  if (typeof input === "string") return input;
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index];
    if (item !== undefined && "role" in item && item.role === "user" && "content" in item) return textOf(item.content);
  }
  return "";
}

/** Judges the request the user has just made: its length and whether it asks for code execution. */
export function inspectRequest(input: string | readonly AgentInputItem[]): RequestVerdict {
  const text = latestRequestText(input);
  if (text.length > MAX_REQUEST_CHARACTERS) return { tripwireTriggered: true, reason: "request_too_long" };
  if (CODE_EXECUTION_PATTERN.test(text)) return { tripwireTriggered: true, reason: "code_execution_requested" };
  return { tripwireTriggered: false, reason: "allowed" };
}

/**
 * Input guardrail for the coordinator. It trips on oversized requests and on
 * requests that ask for arbitrary code execution. It is a first line of defence;
 * tool approval and command validation still apply to everything else.
 */
export const requestPolicyGuardrail: InputGuardrail = {
  name: "request-policy",
  execute: ({ input }) => {
    const verdict = inspectRequest(input);
    return Promise.resolve({ outputInfo: { reason: verdict.reason }, tripwireTriggered: verdict.tripwireTriggered });
  },
};
