import { noRedirectFetch } from "./no-redirect-fetch.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Readable text from a string or from the objects gateways use for hidden reasoning. Parsed JSON has no cycles to guard against. */
function textFrom(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => textFrom(part)).join("");
  if (!isRecord(value)) return "";
  return ["text", "summary", "content"].map((key) => textFrom(value[key])).join("");
}

/**
 * Copies gateway reasoning onto the `reasoning` string the Agents SDK reads.
 * OpenRouter and similar proxies send thinking as `reasoning_content` or `reasoning_details`.
 * Without this, a length stop that only filled those fields looks like an empty reply.
 */
export function liftChatCompletionReasoning(part: Record<string, unknown>): void {
  const current = typeof part["reasoning"] === "string" ? part["reasoning"] : textFrom(part["reasoning"]);
  if (current.length > 0) {
    if (part["reasoning"] !== current) part["reasoning"] = current;
    return;
  }
  const extra = textFrom(part["reasoning_content"]) + textFrom(part["reasoning_details"]);
  if (extra.length > 0) part["reasoning"] = extra;
}

export function normalizeChatCompletionBody(body: unknown): void {
  if (!isRecord(body) || !Array.isArray(body["choices"])) return;
  for (const choice of body["choices"]) {
    if (!isRecord(choice)) continue;
    for (const key of ["delta", "message"]) {
      const part = choice[key];
      if (isRecord(part)) liftChatCompletionReasoning(part);
    }
  }
}

function rewriteDataLine(line: string): string {
  const marker = line.indexOf("data:");
  if (marker < 0) return line;
  const payload = line.slice(marker + "data:".length).trim();
  if (payload.length === 0 || payload === "[DONE]") return line;
  try {
    const parsed: unknown = JSON.parse(payload);
    normalizeChatCompletionBody(parsed);
    return `${line.slice(0, marker)}data: ${JSON.stringify(parsed)}`;
  } catch {
    return line;
  }
}

function normalizeEventStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        if (lines.length === 0) return;
        controller.enqueue(encoder.encode(`${lines.map(rewriteDataLine).join("\n")}\n`));
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending.length > 0) controller.enqueue(encoder.encode(rewriteDataLine(pending)));
      },
    }),
  );
}

/** Chat Completions fetch that keeps redirects blocked and makes gateway reasoning visible. */
export function chatCompletionsFetch(base: typeof fetch = noRedirectFetch): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init);
    if (!response.ok || !response.body) return response;
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream")) {
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(normalizeEventStream(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    if (!type.includes("application/json") && !type.includes("+json")) return response;
    const text = await response.text();
    try {
      const parsed: unknown = JSON.parse(text);
      normalizeChatCompletionBody(parsed);
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(JSON.stringify(parsed), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
  };
}
