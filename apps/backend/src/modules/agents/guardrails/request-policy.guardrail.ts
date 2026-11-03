import type { AgentInputItem, InputGuardrail } from "@openai/agents";

export const MAX_REQUEST_CHARACTERS = 4000;

/** System execution stays unavailable; JavaScript modeling calculations use the isolated tool. */
const CODE_EXECUTION_PATTERN =
  /\b(run|execute|eval)\b[\s\S]{0,40}\b(python|shell|bash|powershell|cmd)\b|\bos\.system\b|\bsubprocess\b|\bchild_process\b/i;

/** Text of the request, used for policy checks. Only user-visible message text is inspected. */
function requestText(input: string | readonly AgentInputItem[]): string {
  if (typeof input === "string") return input;
  return input
    .map((item) => {
      if (typeof item !== "object" || item === null || !("content" in item)) return "";
      return typeof item.content === "string" ? item.content : "";
    })
    .join("\n");
}

/**
 * Input guardrail for the coordinator. It trips on oversized requests and on
 * requests that ask for arbitrary code execution. It is a first line of defence;
 * tool approval and command validation still apply to everything else.
 */
export const requestPolicyGuardrail: InputGuardrail = {
  name: "request-policy",
  execute: ({ input }) => {
    const text = requestText(input);
    if (text.length > MAX_REQUEST_CHARACTERS) {
      return Promise.resolve({ outputInfo: { reason: "request_too_long" }, tripwireTriggered: true });
    }
    if (CODE_EXECUTION_PATTERN.test(text)) {
      return Promise.resolve({ outputInfo: { reason: "code_execution_requested" }, tripwireTriggered: true });
    }
    return Promise.resolve({ outputInfo: { reason: "allowed" }, tripwireTriggered: false });
  },
};
