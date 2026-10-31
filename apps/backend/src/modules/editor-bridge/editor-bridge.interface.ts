import type { EditorCommand } from "../../shared/schemas/editor-command.schema.js";
import type { EditorContext } from "../../shared/schemas/editor-context.schema.js";

export const EDITOR_BRIDGE = Symbol("EDITOR_BRIDGE");

export const EDITOR_WS_PATH = "/api/v1/editor/ws";

export type CommandExecutionStatus = "applied" | "failed" | "revision_conflict";

export interface EditorCommandResult {
  readonly commandId: string;
  readonly status: "applied" | "failed";
  readonly message: string | undefined;
}

export interface CommandExecutionResult {
  readonly proposalId: string;
  readonly status: CommandExecutionStatus;
  readonly revision: number | undefined;
  readonly results: readonly EditorCommandResult[];
  readonly message: string | undefined;
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
  getContext(clientId: string): Promise<EditorContext>;
  proposeCommands(clientId: string, proposal: CommandProposalView): Promise<void>;
  executeCommands(clientId: string, request: CommandExecutionRequest): Promise<CommandExecutionResult>;
}
