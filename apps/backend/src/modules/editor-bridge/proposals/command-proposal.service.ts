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

/** What one apply attempt produced, and whether the batch ran on a newer scene than the one it was written for. */
interface ApplyAttempt {
  readonly outcome: CommandExecutionResult;
  readonly rebased: boolean;
}

/**
 * Validates command batches against the editor's latest scene before anyone is
 * asked to approve them, then executes approved proposals exactly once.
 */
@Injectable()
export class CommandProposalService {
  private readonly logger = new Logger(CommandProposalService.name);
  private readonly activeApplications = new Set<string>();

  constructor(
    private readonly repository: CommandProposalRepository,
    private readonly policy: ApprovalPolicy,
    @Inject(EDITOR_BRIDGE) private readonly bridge: EditorBridge,
    private readonly scenes: ProjectScenesService,
  ) {}

  /**
   * Stores a batch for preview. A proposal named in `supersedes` must still be waiting; it is replaced by the
   * new one and can no longer be applied.
   */
  async propose(run: ProposalRun, input: ProposalInput): Promise<CommandProposalRecord> {
    this.bridge.assertConnection(run.userId, run.projectId, run.clientId);
    const previous = input.supersedes === undefined ? undefined : this.require(run.id, input.supersedes);
    if (previous && previous.status !== "proposed") {
      throw new ConflictError("Only a proposal that has not been applied yet can be superseded");
    }
    const context = await this.bridge.getContext(run.clientId);
    if (input.expectedRevision !== undefined && input.expectedRevision !== context.revision) {
      throw new ConflictError("Scene changed since these commands were calculated. Read the scene and regenerate the commands.");
    }
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
      strictRevision: input.expectedRevision !== undefined || input.commands.some((command) => command.type === "geometry.bevel" || command.type === "geometry.extrude" || command.type === "geometry.subdivide_faces" || (command.type === "geometry.subdivide" || command.type === "geometry.set_modifiers")),
      summary: input.summary,
      commands: input.commands,
      requiresApproval: this.policy.requiresApproval(input.commands),
      now: new Date().toISOString(),
    };
    this.repository.insert(proposal);
    if (previous) this.repository.transition(previous.id, ["proposed"], "superseded", proposal.now);

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
    if (proposal.status === "superseded") {
      throw new ConflictError("Proposal was replaced by a newer proposal; apply that one instead");
    }
    if (this.activeApplications.has(proposal.id)) throw new ConflictError("Proposal is already being applied");

    const now = new Date().toISOString();
    if (proposal.status === "proposed" && !this.repository.transition(proposal.id, ["proposed"], "applying", now)) {
      throw new ConflictError("Proposal is already being applied");
    }
    this.activeApplications.add(proposal.id);
    try {
      const context = await this.bridge.getContext(run.clientId);
      if (context.supportsPreparedCommands) return await this.applyPrepared(run, proposal, context);
      const { outcome, rebased } = await this.attempt(run, proposal);
      const stored: CommandExecutionResult = rebased ? { ...outcome, rebased: true } : outcome;
      if (outcome.status === "applied") {
        this.repository.commitApplied(proposal.id, stored, () => this.scenes.appendInTransaction(
          this.repository.connection, proposal.projectId, proposal.id, proposal.commands,
        ));
      } else {
        this.repository.transition(proposal.id, ["applying"], "failed", new Date().toISOString(), stored);
      }
      return stored;
    } finally {
      this.activeApplications.delete(proposal.id);
    }
  }

  private async applyPrepared(run: ProposalRun, proposal: CommandProposalRecord, context: EditorContext): Promise<CommandExecutionResult> {
    const rebased = context.revision !== proposal.baseRevision;
    const issues = validateAgainstContext(proposal.commands, context);
    if ((rebased && proposal.strictRevision) || issues.length > 0) {
      const result = failedOutcome(proposal.id, "Scene changed; regenerate and propose again", context.revision);
      this.repository.transition(proposal.id, ["applying"], "failed", new Date().toISOString(), result);
      return result;
    }
    const prepared = await this.execute(run, proposal, context.revision, "prepare");
    if (prepared.status !== "applied") {
      this.repository.transition(proposal.id, ["applying"], "failed", new Date().toISOString(), prepared);
      return prepared;
    }
    const stored = { ...prepared, rebased };
    try {
      this.repository.commitApplied(proposal.id, stored, () => this.scenes.appendInTransaction(
        this.repository.connection, proposal.projectId, proposal.id, proposal.commands,
      ), true);
    } catch (error) {
      try { await this.execute(run, proposal, context.revision, "discard"); }
      catch { /* Connection close discards the uncommitted candidate. */ }
      throw error;
    }
    try {
      const delivered = await this.execute(run, proposal, context.revision, "commit");
      if (delivered.status === "applied") this.repository.markDelivered(proposal.id);
    } catch {
      // The durable project is authoritative. A new authenticated connection restores it.
    }
    return stored;
  }

  reject(runId: string, proposalId: string): void {
    const proposal = this.require(runId, proposalId);
    if (proposal.status !== "proposed") return;
    this.repository.transition(proposal.id, ["proposed"], "rejected", new Date().toISOString());
  }

  /** Runs the batch for the revision it was written against. If the scene has moved on, see {@link rebase}. */
  private async attempt(run: ProposalRun, proposal: CommandProposalRecord): Promise<ApplyAttempt> {
    const outcome = await this.execute(run, proposal, proposal.baseRevision);
    if (outcome.status !== "revision_conflict") return { outcome, rebased: false };
    if (proposal.strictRevision) {
      return { outcome: failedOutcome(proposal.id, "Scene changed since these commands were calculated. Regenerate and propose again."), rebased: false };
    }
    return this.rebase(run, proposal);
  }

  /**
   * The scene changed after the proposal was written. When every command still fits the current scene, the
   * batch runs again on that scene; otherwise the proposal fails and the assistant has to propose again.
   */
  private async rebase(run: ProposalRun, proposal: CommandProposalRecord): Promise<ApplyAttempt> {
    let current: EditorContext;
    try {
      this.bridge.assertConnection(run.userId, run.projectId, proposal.clientId);
      current = await this.bridge.getContext(proposal.clientId);
    } catch {
      return { outcome: failedOutcome(proposal.id, "The editor could not be reached to check this proposal again"), rebased: false };
    }

    const issues = validateAgainstContext(proposal.commands, current);
    if (issues.length > 0) {
      const reasons = issues.map((item) => item.message).join("; ");
      const message = `The scene changed after this proposal was made, and it no longer fits: ${reasons}. Propose again.`;
      return { outcome: failedOutcome(proposal.id, message, current.revision), rebased: false };
    }

    const outcome = await this.execute(run, proposal, current.revision);
    return { outcome, rebased: outcome.status === "applied" };
  }

  /** Sends the batch to the editor at `expectedRevision`. A failure to reach the editor becomes a failed outcome. */
  private async execute(run: ProposalRun, proposal: CommandProposalRecord, expectedRevision: number, phase?: "prepare" | "commit" | "discard"): Promise<CommandExecutionResult> {
    try {
      this.bridge.assertConnection(run.userId, run.projectId, proposal.clientId);
      return await this.bridge.executeCommands(proposal.clientId, {
        proposalId: proposal.id,
        idempotencyKey: proposal.id,
        expectedRevision,
        commands: proposal.commands,
        ...(phase ? { phase } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution failed";
      this.logger.warn(`proposal ${proposal.id} failed: ${message}`);
      // The editor might have applied the batch before its response was lost. Keep it
      // retryable with the same idempotency key instead of recording a false failure.
      throw error;
    }
  }
}

function failedOutcome(proposalId: string, message: string, revision?: number): CommandExecutionResult {
  return { proposalId, status: "failed", revision, results: [], message };
}

/**
 * Checks references against the latest scene and against objects the same batch
 * creates, moves or deletes, in order. Returns one issue per problem, each saying how to fix it, so the
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
  const modifiers = commands.filter((command) => command.type === "geometry.bevel" || (command.type === "geometry.subdivide" || command.type === "geometry.set_modifiers"));
  const cageEdits = commands.filter((command) => command.type === "geometry.extrude" || command.type === "geometry.subdivide_faces");
  if (modifiers.length > 0 && (modifiers.length !== commands.length || commands.length > 20)) {
    return [{ commandId: commands[0]?.commandId ?? "batch", message: "Geometry batches accept only bevel/subdivision commands, at most 20; create/transform in separate proposals" }];
  }
  if (cageEdits.length > 0 && (cageEdits.length !== commands.length || commands.length > 20)) {
    return [{ commandId: commands[0]?.commandId ?? "batch", message: "Component edit batches accept only extrude and subdivide_faces commands, at most 20; create or transform objects in a separate proposal" }];
  }
  const issue = (commandId: string, message: string) => issues.push({ commandId, message });
  const missing = (commandId: string, objectId: string) =>
    issue(commandId, `objectId "${objectId}" does not exist; create it first or use an id from editor.get_context`);

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
      case "geometry.bevel":
      case "geometry.subdivide":
      case "geometry.set_modifiers":
      case "geometry.extrude":
      case "geometry.subdivide_faces":
      case "scene.rename_object":
      case "scene.set_visibility":
        if (!parents.has(command.objectId)) missing(command.commandId, command.objectId);
        break;
      case "scene.set_parent": {
        if (!parents.has(command.objectId)) {
          missing(command.commandId, command.objectId);
          break;
        }
        if (command.parentId !== null && !parents.has(command.parentId)) {
          issue(
            command.commandId,
            `parentId "${command.parentId}" does not exist; create the parent in an earlier command or use an id from editor.get_context`,
          );
          break;
        }
        if (command.parentId !== null && isWithinBranch(command.parentId, command.objectId, parents)) {
          issue(
            command.commandId,
            `"${command.objectId}" cannot be placed under "${command.parentId}": that would put it under itself or under something that hangs below it`,
          );
          break;
        }
        // Later commands of the batch see the object under its new parent.
        const previousParent = parents.get(command.objectId);
        if (previousParent && childrenOf) childrenOf.get(previousParent)?.delete(command.objectId);
        parents.set(command.objectId, command.parentId);
        link(command.objectId, command.parentId);
        break;
      }
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

/**
 * Whether `candidate` is `id` itself or hangs below it, judged by the parents as the batch leaves them. Placing
 * `id` under such a candidate would make a cycle.
 */
function isWithinBranch(candidate: string, id: string, parents: ReadonlyMap<string, string | null>): boolean {
  const seen = new Set<string>();
  let current: string | null | undefined = candidate;
  while (current && !seen.has(current)) {
    if (current === id) return true;
    seen.add(current);
    current = parents.get(current);
  }
  return false;
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
