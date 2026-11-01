import { z } from "zod";
import {
  BACKEND_URL,
  backendToken,
  ensureBackendConnection,
} from "@/lib/backend";
import type { EditorScene } from "./EditorScene";

const messageSchema = z.object({
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
});
const executionSchema = z.object({
  requestId: z.string(),
  proposalId: z.string(),
  expectedRevision: z.number().int(),
  commands: z.unknown(),
});
export interface EditorConnection {
  clientId: string;
  close: () => void;
}
export async function connectEditor(
  editor: EditorScene,
  signal: AbortSignal,
): Promise<EditorConnection> {
  await ensureBackendConnection();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${BACKEND_URL.replace("http:", "ws:")}/api/v1/editor/ws`,
    );
    const timer = window.setTimeout(() => {
      socket.close();
      reject(new Error("Editor connection timed out"));
    }, 10000);
    const close = () => {
      clearTimeout(timer);
      socket.close();
    };
    signal.addEventListener("abort", close, { once: true });
    socket.onclose = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", close);
      reject(new Error("Editor disconnected"));
    };
    socket.onerror = () => {
      close();
      reject(new Error("Could not connect to the editor bridge"));
    };
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          event: "auth",
          data: { token: backendToken(), projectId: editor.projectId },
        }),
      );
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "string") return;
      try {
        const message = messageSchema.parse(JSON.parse(event.data));
        const send = (name: string, data: unknown) =>
          socket.send(JSON.stringify({ event: name, data }));
        if (
          message.event === "auth.ok" &&
          typeof message.data["clientId"] === "string"
        ) {
          clearTimeout(timer);
          resolve({ clientId: message.data["clientId"], close });
        }
        if (
          message.event === "context.request" &&
          typeof message.data["requestId"] === "string"
        )
          send("context.response", {
            requestId: message.data["requestId"],
            context: editor.context(),
          });
        if (message.event === "commands.execute") {
          const request = executionSchema.parse(message.data);
          send("commands.result", {
            requestId: request.requestId,
            ...editor.execute(
              request.proposalId,
              request.expectedRevision,
              request.commands,
            ),
          });
        }
        if (message.event === "error") {
          close();
          reject(new Error("Editor authentication failed"));
        }
      } catch {
        close();
        reject(new Error("The editor received an invalid command"));
      }
    };
  });
}
