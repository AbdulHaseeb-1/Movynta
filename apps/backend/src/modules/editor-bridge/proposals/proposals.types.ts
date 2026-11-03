import type { EditorCommand } from "../../../shared/types/editor-command.types.js";
import type { PROPOSAL_STATUSES } from "./command-proposal.repository.js";
import type { CommandExecutionResult } from "../editor-bridge.types.js";

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface CommandProposalRecord {
  readonly strictRevision?: boolean;
  readonly id: string;
  readonly runId: string;
  readonly projectId: string;
  readonly clientId: string;
  readonly baseRevision: number;
  readonly summary: string;
  readonly commands: readonly EditorCommand[];
  readonly requiresApproval: boolean;
  readonly status: ProposalStatus;
  readonly result: CommandExecutionResult | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewProposal {
  readonly strictRevision?: boolean;
  readonly id: string;
  readonly runId: string;
  readonly projectId: string;
  readonly clientId: string;
  readonly baseRevision: number;
  readonly summary: string;
  readonly commands: readonly EditorCommand[];
  readonly requiresApproval: boolean;
  readonly now: string;
}

export interface ProposalRun {
  readonly id: string;
  readonly userId: string;
  readonly projectId: string;
  readonly clientId: string;
}

export interface ProposalInput {
  /** Reject computations based on an obsolete scene snapshot. */
  readonly expectedRevision?: number | undefined;
  readonly summary: string;
  readonly commands: readonly EditorCommand[];
  /** The id of a waiting proposal this batch replaces. */
  readonly supersedes?: string | undefined;
}

export interface ProposalIssue {
  readonly commandId: string;
  readonly message: string;
}
