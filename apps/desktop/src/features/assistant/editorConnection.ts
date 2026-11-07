import { z } from "zod";
import {
  editorCommandListSchema,
  identifierSchema,
  measurementRequestSchema,
  meshInspectionRequestSchema,
  viewCaptureRequestSchema,
} from "@movynta/editor-protocol";
import { BACKEND_URL, backendToken, ensureBackendConnection } from "@/lib/backend";
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
const viewCandidateSchema = z
  .object({
    proposalId: identifierSchema,
    revision: z.number().int().nonnegative(),
    commands: editorCommandListSchema,
  })
  .strict()
  .optional();

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
    if (request.proposalId !== candidate?.proposalId)
      throw new Error("The proposal preview was not supplied by the backend");
    const result = capture(request, { withImages: data["withImages"] === true, ...(candidate ? { candidate } : {}) });
    // The chat shows the user what the assistant is about to see, found again by the id the backend gave this capture.
    const captureId = data["captureId"];
    if (typeof captureId === "string") rememberCapture(captureId, result.images);
    send("view.response", { requestId, result });
  } catch (error) {
    send("view.error", {
      requestId,
      message:
        error instanceof z.ZodError
          ? "The view request was not valid"
          : failureReason(error, "The view could not be drawn"),
    });
  }
}

/** Bridge error codes that mean this connection can no longer be used. */
const FATAL_BRIDGE_ERRORS = new Set(["unauthorized", "forbidden", "auth_timeout", "not_authenticated"]);

function isFatalBridgeError(data: Record<string, unknown>): boolean {
  const code = data["code"];
  return typeof code !== "string" || FATAL_BRIDGE_ERRORS.has(code);
}

/** A short reason for an answer the editor could not give, within the bridge's message limit. */
function failureReason(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError) return "The request was not valid";
  return error instanceof Error && error.message ? error.message.slice(0, 400) : fallback;
}

/** Answers a request for the scene's state. A request the editor cannot answer gets a reason, not a dropped connection. */
function answerContextRequest(
  data: Record<string, unknown>,
  editor: EditorScene,
  send: (name: string, data: unknown) => void,
): void {
  const requestId = data["requestId"];
  if (typeof requestId !== "string") return;
  try {
    const context = editor.context(
      data["inspection"] === undefined ? undefined : meshInspectionRequestSchema.parse(data["inspection"]),
      data["measurement"] === undefined ? undefined : measurementRequestSchema.parse(data["measurement"]),
    );
    send("context.response", { requestId, context });
  } catch (error) {
    send("context.error", { requestId, message: failureReason(error, "The scene could not be read") });
  }
}

/** Runs a batch. A request that cannot be read is answered as a failed batch when it names its request. */
function answerCommands(
  data: Record<string, unknown>,
  editor: EditorScene,
  send: (name: string, data: unknown) => void,
): void {
  const request = executionSchema.safeParse(data);
  if (request.success) {
    // A rejected batch is an answer, not a reason to drop the editor connection.
    send("commands.result", { requestId: request.data.requestId, ...executeSafely(editor, request.data) });
    return;
  }
  const requestId = data["requestId"];
  if (typeof requestId === "string")
    send("commands.result", {
      requestId,
      status: "failed",
      results: [],
      message: "The editor could not read this command batch",
    });
}

/** An open connection from the desktop editor to the backend, which runs the assistant's batches. */
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
    const socket = new WebSocket(`${BACKEND_URL.replace("http:", "ws:")}/api/v1/editor/ws`);
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
    let authenticated = false;
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "string") return;
      let message: z.infer<typeof messageSchema>;
      try {
        message = messageSchema.parse(JSON.parse(event.data));
      } catch {
        // Before sign-in an unreadable reply means the bridge cannot be trusted; afterwards one bad
        // message is skipped so the rest of the run keeps its editor.
        if (!authenticated) {
          close();
          reject(new Error("The editor received an invalid message"));
        }
        return;
      }
      const send = (name: string, data: unknown) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: name, data }));
      };
      if (message.event === "auth.ok" && typeof message.data["clientId"] === "string") {
        authenticated = true;
        clearTimeout(timer);
        const clientId = message.data["clientId"];
        if (message.data["recoveryRequired"] === true || editor.requiresRecovery) {
          void recoverSavedScene(editor)
            .then(() => resolve({ clientId, close }))
            .catch((error: unknown) => {
              close();
              reject(error);
            });
        } else resolve({ clientId, close });
        return;
      }
      if (message.event === "context.request") answerContextRequest(message.data, editor, send);
      if (message.event === "commands.execute") answerCommands(message.data, editor, send);
      if (message.event === "view.request") answerViewRequest(message.data, capture.current, send);
      // After sign-in the backend also reports harmless problems this way, such as an answer that came
      // after its request timed out. Only a failed sign-in ends the connection.
      if (message.event === "error" && (!authenticated || isFatalBridgeError(message.data))) {
        close();
        reject(new Error("Editor authentication failed"));
      }
    };
  });
}
