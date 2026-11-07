/* eslint-disable no-await-in-loop -- SSE chunks must be consumed in wire order. */
import { z } from "zod";
import { BACKEND_URL, backendRequest, backendToken } from "@/lib/backend";
export const runSchema = z.object({
  id: z.string(),
  status: z.enum(["created", "running", "waiting_approval", "completed", "failed", "cancelled"]),
  finalOutput: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
});
export const acceptedSchema = z.object({
  runId: z.string(),
  sessionId: z.string(),
  eventsUrl: z.string(),
});
export const approvalSchema = z.object({
  id: z.string(),
  status: z.string(),
  preview: z.record(z.string(), z.unknown()),
});
const eventSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type RunEvent = z.infer<typeof eventSchema>;

/** A transport interruption that can be recovered by checking the run and reconnecting. */
class ProgressStreamDisconnected extends Error {}

/** Fetch-based SSE supports bearer auth; EventSource would put credentials in a URL. */
export async function streamRun(
  path: string,
  signal: AbortSignal,
  onEvent: (event: RunEvent) => void,
  cursor = { id: "" },
) {
  let response: Response;
  try {
    response = await fetch(BACKEND_URL + path, {
      headers: {
        Authorization: `Bearer ${backendToken()}`,
        ...(cursor.id ? { "Last-Event-ID": cursor.id } : {}),
      },
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ProgressStreamDisconnected("Agent progress stream disconnected");
  }
  if (response.status >= 500) throw new ProgressStreamDisconnected("Agent progress stream is unavailable");
  if (!response.ok || !response.body) throw new Error("Could not open agent progress stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal.aborted) throw error;
        throw new ProgressStreamDisconnected("Agent progress stream disconnected");
      }
      const { done, value } = chunk;
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = frame.split("\n");
        const id = lines
          .find((line) => line.startsWith("id:"))
          ?.slice(3)
          .trim();
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) {
          const event = eventSchema.safeParse(JSON.parse(data));
          if (event.success) {
            if (id) cursor.id = id;
            onEvent(event.data);
          }
        }
        end = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
export const getRun = (id: string) => backendRequest(`/agent-runs/${id}`, runSchema);

/** A lost progress stream does not mean the run failed: check its state and let the caller reconnect. */
export async function readRunProgress(
  path: string,
  runId: string,
  signal: AbortSignal,
  onEvent: (event: RunEvent) => void,
  cursor: { id: string },
) {
  try {
    await streamRun(path, signal, onEvent, cursor);
  } catch (error) {
    if (signal.aborted || !(error instanceof ProgressStreamDisconnected)) throw error;
  }
  signal.throwIfAborted();
  return getRun(runId);
}
