import type { z } from "zod";
import type { MeasurementRequest, MeshInspectionRequest, ViewCaptureRequest, ViewCaptureResult } from "@movynta/editor-protocol";
import type { EditorCommand } from "../../shared/types/editor-command.types.js";
import type { EditorContext } from "../../shared/types/editor-context.types.js";
import type { EDITOR_INBOUND_EVENTS, commandResultSchema } from "./editor-protocol.js";

export type CommandExecutionStatus = "applied" | "failed" | "revision_conflict";

export interface EditorCommandResult {
  readonly commandId: string;
  readonly status: "applied" | "failed";
  readonly message: string | undefined;
  /** The name an object ended up with. Set by commands that create, rename or move an object. */
  readonly name?: string;
}

export interface CommandExecutionResult {
  readonly proposalId: string;
  readonly status: CommandExecutionStatus;
  readonly revision: number | undefined;
  readonly results: readonly EditorCommandResult[];
  readonly message: string | undefined;
  /** True when the batch was written for an older scene and ran again on a newer one. */
  readonly rebased?: boolean;
}

/** What the editor needs to show a preview and to run the proposal later. */
export interface CommandProposalView {
  readonly id: string;
  readonly summary: string;
  readonly baseRevision: number;
  readonly requiresApproval: boolean;
  readonly commands: readonly EditorCommand[];
}

export interface CommandExecutionRequest {
  readonly phase?: "prepare" | "commit" | "discard";
  readonly proposalId: string;
  /** Equal to the proposal id, so a repeated request cannot run the batch twice. */
  readonly idempotencyKey: string;
  readonly expectedRevision: number;
  readonly commands: readonly EditorCommand[];
}

export interface EditorConnectionScope {
  readonly clientId: string;
  readonly userId: string;
  readonly projectId: string;
}

/**
 * The only way the backend talks to the editor. Implementations transport
 * validated, structured messages; they never run code supplied by the agent.
 */
export interface EditorBridge {
  /** Throws unless `clientId` is a live editor connection for this user and project. */
  assertConnection(userId: string, projectId: string, clientId: string): EditorConnectionScope;
  getContext(clientId: string, inspection?: MeshInspectionRequest, measurement?: MeasurementRequest): Promise<EditorContext>;
  proposeCommands(clientId: string, proposal: CommandProposalView): Promise<void>;
  executeCommands(clientId: string, request: CommandExecutionRequest): Promise<CommandExecutionResult>;
  /** Asks the editor to draw the scene from the requested points of view. Nothing in the scene changes. */
  captureViews(clientId: string, request: ViewCaptureRequest, options: ViewCaptureOptions): Promise<ViewCaptureResult>;
}

/** What the backend decides about a capture, apart from what the assistant asked for. */
export interface ViewCaptureOptions {
  /** False when the model cannot receive images, so the editor skips drawing and only measures. */
  readonly withImages: boolean;
  /** Names this capture. The editor files the pictures under it so the chat can show what the assistant saw. */
  readonly captureId: string;
  readonly candidate?: {
    readonly proposalId: string;
    readonly revision: number;
    readonly commands: readonly EditorCommand[];
  };
}

/** The subset of a WebSocket the bridge needs. Keeps the transport swappable and testable. */
export interface EditorSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface EditorConnection extends EditorConnectionScope {
  readonly socket: EditorSocket;
}

export type PendingRequest =
  | {
      readonly kind: "context";
      readonly clientId: string;
      readonly timer: NodeJS.Timeout;
      readonly resolve: (context: EditorContext) => void;
      readonly reject: (error: Error) => void;
    }
  | {
      readonly kind: "execute";
      readonly clientId: string;
      readonly proposalId: string;
      readonly timer: NodeJS.Timeout;
      readonly resolve: (result: CommandExecutionResult) => void;
      readonly reject: (error: Error) => void;
    }
  | {
      readonly kind: "capture";
      readonly clientId: string;
      readonly timer: NodeJS.Timeout;
      readonly resolve: (result: ViewCaptureResult) => void;
      readonly reject: (error: Error) => void;
    };

export interface SocketState {
  authenticated: boolean;
  clientId: string | undefined;
  authTimer: NodeJS.Timeout | undefined;
}

export type CommandResultMessage = z.infer<typeof commandResultSchema>;

export type EditorInboundEvent = (typeof EDITOR_INBOUND_EVENTS)[number];

/** Data for `commands.execute`: the execution request plus the id the editor must echo back. */
export type CommandsExecuteData = CommandExecutionRequest & { readonly requestId: string };

/** Data for `view.request`: what to draw, the id the editor must echo back, and whether to draw at all. */
export type ViewRequestData = ViewCaptureOptions & {
  readonly requestId: string;
  readonly request: ViewCaptureRequest;
};

/** Outbound messages. The gateway serializes each one as JSON text; every event has its own data shape. */
export type EditorOutboundMessage =
  | { readonly event: "auth.ok"; readonly data: { readonly clientId: string; readonly projectId: string; readonly recoveryRequired?: boolean } }
  | { readonly event: "error"; readonly data: { readonly code: string; readonly message: string } }
  | { readonly event: "context.request"; readonly data: { readonly requestId: string; readonly inspection?: MeshInspectionRequest | undefined; readonly measurement?: MeasurementRequest | undefined } }
  | { readonly event: "proposal.created"; readonly data: { readonly proposal: CommandProposalView } }
  | { readonly event: "commands.execute"; readonly data: CommandsExecuteData }
  | { readonly event: "view.request"; readonly data: ViewRequestData };
