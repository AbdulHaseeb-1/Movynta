import { z } from "zod";
import { editorContextSchema, MAX_COMMANDS_PER_PROPOSAL, viewCaptureResultSchema } from "@movynta/editor-protocol";

/**
 * Messages exchanged with the editor over WebSocket. Format: `{ event, data }`.
 * Every inbound message is validated before it reaches the bridge.
 */

/** The WebSocket path the desktop editor connects to. */
export const EDITOR_WS_PATH = "/api/v1/editor/ws";

const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** The first message an editor sends: its token and project. */
export const authMessageSchema = z
  .object({
    token: z.string().min(1).max(4096),
    projectId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  })
  .strict();

/** The editor's reply to a request for the scene. */
export const contextResponseSchema = z.object({ requestId, context: editorContextSchema }).strict();

/** The editor's reply when it cannot read the scene. */
export const contextErrorSchema = z.object({ requestId, message: z.string().max(500) }).strict();

/** The editor's reply to a command batch. */
export const commandResultSchema = z
  .object({
    requestId,
    status: z.enum(["applied", "failed", "revision_conflict"]),
    revision: z.number().int().nonnegative().optional(),
    message: z.string().max(500).optional(),
    results: z
      .array(
        z
          .object({
            commandId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
            status: z.enum(["applied", "failed"]),
            message: z.string().max(500).optional(),
            /** The name an object ended up with, when a command created, renamed or moved one. */
            name: z.string().max(80).optional(),
          })
          .strict(),
      )
      .max(MAX_COMMANDS_PER_PROPOSAL),
  })
  .strict();

/** The editor's answer to a `view.request`: the drawn images, or why it could not draw them. */
export const viewResponseSchema = z.object({ requestId, result: viewCaptureResultSchema }).strict();

/** The editor's reply when it cannot draw a requested view. */
export const viewErrorSchema = z.object({ requestId, message: z.string().max(500) }).strict();

/** The events the editor may send, which the backend accepts. */
export const EDITOR_INBOUND_EVENTS = [
  "auth",
  "context.response",
  "context.error",
  "commands.result",
  "view.response",
  "view.error",
] as const;
