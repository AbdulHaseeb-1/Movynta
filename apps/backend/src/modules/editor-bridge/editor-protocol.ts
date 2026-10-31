import { z } from "zod";
import { editorContextSchema } from "../../shared/schemas/editor-context.schema.js";
import type { CommandExecutionRequest, CommandProposalView } from "./editor-bridge.interface.js";

/**
 * Messages exchanged with the editor over WebSocket. Format: `{ event, data }`.
 * Every inbound message is validated before it reaches the bridge.
 */

const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const authMessageSchema = z
  .object({
    token: z.string().min(1).max(4096),
    projectId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  })
  .strict();

export const contextResponseSchema = z.object({ requestId, context: editorContextSchema }).strict();

export const contextErrorSchema = z.object({ requestId, message: z.string().max(500) }).strict();

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
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type CommandResultMessage = z.infer<typeof commandResultSchema>;

export const EDITOR_INBOUND_EVENTS = ["auth", "context.response", "context.error", "commands.result"] as const;
export type EditorInboundEvent = (typeof EDITOR_INBOUND_EVENTS)[number];

/** Data for `commands.execute`: the execution request plus the id the editor must echo back. */
export type CommandsExecuteData = CommandExecutionRequest & { readonly requestId: string };

/** Outbound messages. The gateway serializes each one as JSON text; every event has its own data shape. */
export type EditorOutboundMessage =
  | { readonly event: "auth.ok"; readonly data: { readonly clientId: string; readonly projectId: string } }
  | { readonly event: "error"; readonly data: { readonly code: string; readonly message: string } }
  | { readonly event: "context.request"; readonly data: { readonly requestId: string } }
  | { readonly event: "proposal.created"; readonly data: { readonly proposal: CommandProposalView } }
  | { readonly event: "commands.execute"; readonly data: CommandsExecuteData };
