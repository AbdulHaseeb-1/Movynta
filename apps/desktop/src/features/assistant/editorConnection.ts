import { z } from "zod";
import { editorCommandListSchema, identifierSchema, measurementRequestSchema, meshInspectionRequestSchema, viewCaptureRequestSchema } from "@movynta/editor-protocol";
import {
  BACKEND_URL,
  backendToken,
  ensureBackendConnection,
} from "@/lib/backend";
import { rememberCapture, type ViewCaptureHandler } from "@/features/viewCapture";
import type { EditorScene } from "./EditorScene";
import { executionSchema, executeSafely } from "./commandExecution";
import { waitForAbortable } from "./waitForAbortable";
import { recoverSavedScene } from "../objectEditing/sceneHistory";

const messageSchema = z.object({
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
});
/**
 * Answers a request to look at the scene. A view that cannot be drawn is an answer, not a reason to drop the
 * connection, so the assistant is told why and can ask differently.
 */
const viewCandidateSchema = z.object({
  proposalId: identifierSchema,
  revision: z.number().int().nonnegative(),
  commands: editorCommandListSchema,
}).strict().optional();

function answerViewRequest(
  data: Record<string, unknown>,
  capture: ViewCaptureHandler | null,
  send: (name: string, data: unknown) => void,
): void {
  const requestId = data["requestId"];
  if (typeof requestId !== "string") return;
  try {
    if (!capture) throw new Error("The viewport is not available");
    const request = viewCaptureRequestSchema.parse(data["request"]);
    const candidate = viewCandidateSchema.parse(data["candidate"]);
    if (request.proposalId !== candidate?.proposalId) throw new Error("The proposal preview was not supplied by the backend");
    const result = capture(request, { withImages: data["withImages"] === true, ...(candidate ? { candidate } : {}) });
    // The chat shows the user what the assistant is about to see, found again by the id the backend gave this capture.
    const captureId = data["captureId"];
    if (typeof captureId === "string") rememberCapture(captureId, result.images);
    send("view.response", { requestId, result });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "The view request was not valid"
        : error instanceof Error
          ? error.message.slice(0, 400)
          : "The view could not be drawn";
    send("view.error", { requestId, message });
  }
}

export interface EditorConnection {
  clientId: string;
  close: () => void;
}
/**
 * Opens the editor's side of the bridge. `capture` is read each time the assistant asks to look at the scene, so it
 * may be replaced while the connection is open; null means no viewport is showing.
 */
export async function connectEditor(
  editor: EditorScene,
  signal: AbortSignal,
  capture: { readonly current: ViewCaptureHandler | null } = { current: null },
): Promise<EditorConnection> {
  await waitForAbortable(signal, ensureBackendConnection);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${BACKEND_URL.replace("http:", "ws:")}/api/v1/editor/ws`,
    );
    const timer = window.setTimeout(() => {
      socket.close();
      reject(new Error("Editor connection timed out"));
    }, 10000);
    const close = () => {
      editor.discardPrepared();
      clearTimeout(timer);
      socket.close();
    };
    const onAbort = () => {
      close();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    socket.onclose = () => {
      editor.discardPrepared();
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
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
          const clientId = message.data["clientId"];
          if (message.data["recoveryRequired"] === true || editor.requiresRecovery) {
            void recoverSavedScene(editor).then(() => resolve({ clientId, close })).catch((error: unknown) => { close(); reject(error); });
          } else resolve({ clientId, close });
        }
        if (
          message.event === "context.request" &&
          typeof message.data["requestId"] === "string"
        )
          send("context.response", {
            requestId: message.data["requestId"],
            context: editor.context(
              message.data["inspection"] === undefined ? undefined : meshInspectionRequestSchema.parse(message.data["inspection"]),
              message.data["measurement"] === undefined ? undefined : measurementRequestSchema.parse(message.data["measurement"]),
            ),
          });
        if (message.event === "commands.execute") {
          const request = executionSchema.parse(message.data);
          // A rejected batch is an answer, not a reason to drop the editor connection.
          send("commands.result", {
            requestId: request.requestId,
            ...executeSafely(editor, request),
          });
        }
        if (message.event === "view.request") answerViewRequest(message.data, capture.current, send);
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
