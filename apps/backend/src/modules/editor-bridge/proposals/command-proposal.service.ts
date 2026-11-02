import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConflictError, NotFoundError, ValidationFailedError } from "../../../common/errors/app-error.js";
import { ApprovalPolicy } from "../../approvals/approval.policy.js";
import type { EditorCommand } from "../../../shared/types/editor-command.types.js";
import type { EditorContext } from "../../../shared/types/editor-context.types.js";
import { EDITOR_BRIDGE } from "../editor-bridge.tokens.js";
import type { CommandExecutionResult, EditorBridge } from "../editor-bridge.types.js";
import { ProjectScenesService } from "../../projects/project-scenes.service.js";
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
    private readonly scenes: ProjectScenesService,
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
    // The project keeps what was applied, so its scene can be rebuilt when it is reopened.
    if (status === "applied") this.scenes.append(proposal.projectId, proposal.id, proposal.commands);
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
 * creates or deletes, in order. Returns one issue per problem, each saying how to fix it, so the
 * agent can correct everything in one retry.
 */
export function validateAgainstContext(commands: readonly EditorCommand[], context: EditorContext): ProposalIssue[] {
  /** Every object that exists at this point of the batch, mapped to its parent. */
  const parents = new Map<string, string | null>();
  for (const object of context.objects) parents.set(object.id, object.parentId);
  /**
   * What hangs below each object, built the first time a delete needs it and then kept up to date as the
   * batch goes, so a delete never scans the scene and a batch without deletes pays nothing for it.
   */
  let childrenOf: Map<string, Set<string>> | undefined;
  const link = (child: string, parent: string | null | undefined) => {
    if (!childrenOf || !parent) return;
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.add(child);
    else childrenOf.set(parent, new Set([child]));
  };
  const children = (): Map<string, Set<string>> => {
    if (childrenOf) return childrenOf;
    childrenOf = new Map();
    for (const [id, parent] of parents) link(id, parent);
    return childrenOf;
  };
  const createdInBatch = new Set<string>();
  const seenCommandIds = new Set<string>();
  const issues: ProposalIssue[] = [];
  const issue = (commandId: string, message: string) => issues.push({ commandId, message });

  for (const command of commands) {
    if (seenCommandIds.has(command.commandId)) {
      issue(command.commandId, "commandId is used more than once; every command needs its own commandId");
    }
    seenCommandIds.add(command.commandId);

    switch (command.type) {
      case "scene.create_object":
        if (parents.has(command.objectId)) {
          issue(command.commandId, existsMessage(command.objectId, createdInBatch, "scene.create_object"));
        }
        if (command.parentId !== undefined && !parents.has(command.parentId)) {
          issue(
            command.commandId,
            `parentId "${command.parentId}" does not exist; create the parent in an earlier command or use an id from editor.get_context`,
          );
        }
        parents.set(command.objectId, command.parentId ?? null);
        link(command.objectId, command.parentId);
        createdInBatch.add(command.objectId);
        break;
      case "geometry.create_primitive":
        if (command.replaceExisting) {
          if (!parents.has(command.objectId)) {
            issue(
              command.commandId,
              `objectId "${command.objectId}" cannot be replaced because it does not exist; set replaceExisting to false to create it`,
            );
          }
        } else {
          if (parents.has(command.objectId)) {
            issue(command.commandId, existsMessage(command.objectId, createdInBatch, "geometry.create_primitive"));
          }
          parents.set(command.objectId, null);
          createdInBatch.add(command.objectId);
        }
        break;
      case "scene.transform_object":
        if (!parents.has(command.objectId)) {
          issue(command.commandId, `objectId "${command.objectId}" does not exist; create it first or use an id from editor.get_context`);
        }
        break;
      case "scene.delete_object": {
        if (!parents.has(command.objectId)) {
          issue(command.commandId, `objectId "${command.objectId}" does not exist, so it cannot be deleted`);
          break;
        }
        const below = [...(children().get(command.objectId) ?? [])];
        if (below.length > 0) {
          issue(
            command.commandId,
            `objectId "${command.objectId}" still has children (${below.slice(0, 5).join(", ")}); delete the children first, in earlier commands`,
          );
        }
        const parent = parents.get(command.objectId);
        if (parent) children().get(parent)?.delete(command.objectId);
        children().delete(command.objectId);
        parents.delete(command.objectId);
        break;
      }
    }
  }
  return issues;
}

/** The fix depends on whether the id was taken by this same batch (a common mix-up) or already in the scene. */
function existsMessage(objectId: string, createdInBatch: ReadonlySet<string>, commandType: EditorCommand["type"]): string {
  if (createdInBatch.has(objectId)) {
    return commandType === "geometry.create_primitive"
      ? `objectId "${objectId}" was already created earlier in this batch. A primitive is its own object, so drop the scene.create_object and position it with scene.transform_object, or set replaceExisting to true to give that object the shape`
      : `objectId "${objectId}" is created more than once in this batch; use a different objectId`;
  }
  return `objectId "${objectId}" already exists in the scene; use a different objectId${
    commandType === "geometry.create_primitive" ? ", or set replaceExisting to true to replace its shape" : ""
  }`;
}
