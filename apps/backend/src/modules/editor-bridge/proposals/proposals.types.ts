import type { EditorCommand } from "@movynta/editor-protocol";
import type { PROPOSAL_STATUSES } from "./command-proposal.repository.js";
import type { CommandExecutionResult } from "../editor-bridge.types.js";

/** The status of a proposal. */
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** A proposal as it is stored. */
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

/** What is needed to create a proposal record. */
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

/** The run and connection a proposal belongs to. */
export interface ProposalRun {
  readonly id: string;
  readonly userId: string;
  readonly projectId: string;
  readonly clientId: string;
}

/** What a tool gives when it proposes a batch. */
export interface ProposalInput {
  /** Reject computations based on an obsolete scene snapshot. */
  readonly expectedRevision?: number | undefined;
  readonly summary: string;
  readonly commands: readonly EditorCommand[];
  /** The id of a waiting proposal this batch replaces. */
  readonly supersedes?: string | undefined;
}

/** One problem found in a proposed batch, with the path of the field at fault. */
export interface ProposalIssue {
  readonly commandId: string;
  readonly message: string;
}
