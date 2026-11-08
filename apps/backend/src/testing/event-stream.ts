import { z } from "zod";
import type { EventStream, StreamedEvent } from "./testing.types.js";

/** The schema for the envelope of one event on a test event stream. */
export const envelopeSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: z.string(),
  timestamp: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

/** Reads a server-sent event stream with optional `Last-Event-ID` resume. */
export function openEventStream(url: string, token: string, lastEventId?: string): EventStream {
  const controller = new AbortController();
  const events: StreamedEvent[] = [];
  const listeners: (() => void)[] = [];

  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "text/event-stream" };
  if (lastEventId !== undefined) headers["Last-Event-ID"] = lastEventId;

  void (async () => {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.body) throw new Error("SSE response has no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseBlock(block);
        if (parsed) {
          events.push(parsed);
          for (const notify of listeners.splice(0)) notify();
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    for (const notify of listeners.splice(0)) notify();
  })().catch(() => {
    // Aborting the stream is the normal way to stop reading.
    for (const notify of listeners.splice(0)) notify();
  });

  return {
    events,
    waitFor(predicate, timeoutMs = 10_000) {
      return new Promise<StreamedEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for an SSE event")), timeoutMs);
        const check = (): void => {
          const found = events.find(predicate);
          if (found) {
            clearTimeout(timer);
            resolve(found);
            return;
          }
          listeners.push(check);
        };
        check();
      });
    },
    stop() {
      controller.abort();
    },
  };
}

function parseBlock(block: string): StreamedEvent | undefined {
  let id: string | undefined;
  let type: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  const data = dataLines.join("\n");
  if (data.length === 0) return undefined;
  const envelope = envelopeSchema.parse(JSON.parse(data));
  return { id, type, envelope };
}
