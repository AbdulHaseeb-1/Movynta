import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConflictError, NotFoundError, ValidationFailedError } from "../../../common/errors/app-error.js";
import { ApprovalPolicy } from "../../approvals/approval.policy.js";
import type { EditorCommand } from "../../../shared/types/editor-command.types.js";
import type { EditorContext } from "../../../shared/types/editor-context.types.js";
import { EDITOR_BRIDGE } from "../editor-bridge.tokens.js";
import type { CommandExecutionResult, EditorBridge } from "../editor-bridge.types.js";
import { CommandProposalRepository } from "./command-proposal.repository.js";
import type { CommandProposalRecord, ProposalInput, ProposalIssue, ProposalRun } from "./proposals.types.js";

/**
 * Validates command batches against the editor's latest scene before anyone is
 * asked to approve them, then executes approved proposals exactly once.
 */
@Injectable()
export class CommandProposalService {
  private readonly logger = new Logger(CommandProposalService.name);

  constructor(
    private readonly repository: CommandProposalRepository,
    private readonly policy: ApprovalPolicy,
    @Inject(EDITOR_BRIDGE) private readonly bridge: EditorBridge,
  ) {}

  async propose(run: ProposalRun, input: ProposalInput): Promise<CommandProposalRecord> {
    this.bridge.assertConnection(run.userId, run.projectId, run.clientId);
    const context = await this.bridge.getContext(run.clientId);
    const issues = validateAgainstContext(input.commands, context);
    if (issues.length > 0) {
      throw new ValidationFailedError("Proposal conflicts with the current scene", { issues });
    }

    const proposal = {
      id: `prp_${randomUUID()}`,
      runId: run.id,
      projectId: run.projectId,
      clientId: run.clientId,
      baseRevision: context.revision,
      summary: input.summary,
      commands: input.commands,
      requiresApproval: this.policy.requiresApproval(input.commands),
      now: new Date().toISOString(),
    };
    this.repository.insert(proposal);

    await this.bridge.proposeCommands(run.clientId, {
      id: proposal.id,
      summary: proposal.summary,
      baseRevision: proposal.baseRevision,
      requiresApproval: proposal.requiresApproval,
      commands: proposal.commands,
    });
    return this.require(run.id, proposal.id);
  }

  /** Returns a proposal only if it belongs to `runId`. */
  require(runId: string, proposalId: string): CommandProposalRecord {
    const proposal = this.repository.find(proposalId);
    if (!proposal || proposal.runId !== runId) throw new NotFoundError("Proposal not found");
    return proposal;
  }

  /**
   * Executes a proposal once. Repeat calls return the stored outcome instead of
   * sending the batch again. A proposal that is already running is a conflict.
   */
  async apply(run: ProposalRun, proposalId: string): Promise<CommandExecutionResult> {
    const proposal = this.require(run.id, proposalId);

    if (proposal.status === "applied" || proposal.status === "failed") {
      if (proposal.result) return proposal.result;
      throw new ConflictError("Proposal has no stored result");
    }
    if (proposal.status === "rejected") throw new ConflictError("Proposal was rejected");
    if (proposal.status === "applying") throw new ConflictError("Proposal is already being applied");

    const now = new Date().toISOString();
    if (!this.repository.transition(proposal.id, ["proposed"], "applying", now)) {
      throw new ConflictError("Proposal is already being applied");
    }

    let outcome: CommandExecutionResult;
    try {
      this.bridge.assertConnection(run.userId, run.projectId, proposal.clientId);
      outcome = await this.bridge.executeCommands(proposal.clientId, {
        proposalId: proposal.id,
        idempotencyKey: proposal.id,
        expectedRevision: proposal.baseRevision,
        commands: proposal.commands,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution failed";
      this.logger.warn(`proposal ${proposal.id} failed: ${message}`);
      outcome = { proposalId: proposal.id, status: "failed", revision: undefined, results: [], message };
    }

    const status = outcome.status === "applied" ? "applied" : "failed";
    this.repository.transition(proposal.id, ["applying"], status, new Date().toISOString(), outcome);
    return outcome;
  }

  reject(runId: string, proposalId: string): void {
    const proposal = this.require(runId, proposalId);
    if (proposal.status !== "proposed") return;
    this.repository.transition(proposal.id, ["proposed"], "rejected", new Date().toISOString());
  }
}

/**
 * Checks references against the latest scene and against objects the same batch
 * creates. Returns one issue per problem so the agent can fix them in one retry.
 */
export function validateAgainstContext(commands: readonly EditorCommand[], context: EditorContext): ProposalIssue[] {
  const known = new Set(context.objects.map((object) => object.id));
  const seenCommandIds = new Set<string>();
  const issues: ProposalIssue[] = [];

  for (const command of commands) {
    if (seenCommandIds.has(command.commandId)) {
      issues.push({ commandId: command.commandId, message: "commandId is used more than once" });
    }
    seenCommandIds.add(command.commandId);

    switch (command.type) {
      case "scene.create_object":
        if (known.has(command.objectId)) issues.push({ commandId: command.commandId, message: "objectId already exists" });
        if (command.parentId !== undefined && !known.has(command.parentId)) {
          issues.push({ commandId: command.commandId, message: "parentId does not exist" });
        }
        known.add(command.objectId);
        break;
      case "geometry.create_primitive":
        if (command.replaceExisting) {
          if (!known.has(command.objectId)) issues.push({ commandId: command.commandId, message: "objectId to replace does not exist" });
        } else {
          if (known.has(command.objectId)) issues.push({ commandId: command.commandId, message: "objectId already exists" });
          known.add(command.objectId);
        }
        break;
      case "scene.transform_object":
      case "scene.delete_object":
        if (!known.has(command.objectId)) issues.push({ commandId: command.commandId, message: "objectId does not exist" });
        if (command.type === "scene.delete_object") known.delete(command.objectId);
        break;
    }
  }
  return issues;
}
