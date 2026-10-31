import { randomUUID } from "node:crypto";
import { ConflictError, ValidationFailedError } from "../../../common/errors/app-error.js";
import { ApprovalPolicy } from "../../approvals/approval.policy.js";
import { AgentRunRepository } from "../../agent-runs/agent-run.repository.js";
import { SessionsRepository } from "../../sessions/sessions.repository.js";
import { openInMemoryDatabase } from "../../../testing/in-memory-database.js";
import type { EditorCommand } from "../../../shared/schemas/editor-command.schema.js";
import type { EditorContext } from "../../../shared/schemas/editor-context.schema.js";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  CommandProposalView,
  EditorBridge,
  EditorConnectionScope,
} from "../editor-bridge.interface.js";
import { CommandProposalRepository } from "./command-proposal.repository.js";
import { CommandProposalService, type ProposalRun } from "./command-proposal.service.js";

/** Scripted bridge: counts executions so tests can prove a batch ran exactly once. */
class FakeBridge implements EditorBridge {
  executions: CommandExecutionRequest[] = [];
  scene: EditorContext = { projectId: "proj-1", revision: 4, activeSceneName: "Main", selectedObjectIds: [], objects: [] };

  assertConnection(userId: string, projectId: string, clientId: string): EditorConnectionScope {
    return { userId, projectId, clientId };
  }

  getContext(): Promise<EditorContext> {
    return Promise.resolve(this.scene);
  }

  proposeCommands(_clientId: string, _proposal: CommandProposalView): Promise<void> {
    return Promise.resolve();
  }

  executeCommands(_clientId: string, request: CommandExecutionRequest): Promise<CommandExecutionResult> {
    this.executions.push(request);
    return Promise.resolve({
      proposalId: request.proposalId,
      status: "applied",
      revision: 5,
      results: request.commands.map((command) => ({ commandId: command.commandId, status: "applied", message: undefined })),
      message: undefined,
    });
  }
}

function setup() {
  const database = openInMemoryDatabase();
  const bridge = new FakeBridge();
  const service = new CommandProposalService(new CommandProposalRepository(database), new ApprovalPolicy(), bridge);

  // Proposals reference a run, which references a session. Create both for the foreign keys.
  const sessionId = randomUUID();
  new SessionsRepository(database).insert({ id: sessionId, userId: "alice", projectId: "proj-1", createdAt: new Date().toISOString() });
  const runId = `run_${randomUUID()}`;
  const now = new Date().toISOString();
  new AgentRunRepository(database).insert({
    id: runId,
    sessionId,
    userId: "alice",
    projectId: "proj-1",
    agentId: "modeling-coordinator",
    editorClientId: "client-1",
    dimension: undefined,
    selectedSkillIds: [],
    input: "make a box",
    now,
  });
  const run: ProposalRun = { id: runId, userId: "alice", projectId: "proj-1", clientId: "client-1" };
  return { bridge, service, run };
}

const addBox: EditorCommand = { commandId: "c1", type: "scene.create_object", objectId: "box", name: "Box" };

describe("command proposals", () => {
  it("validates against the latest scene and records the base revision", async () => {
    const { service, run } = setup();
    const proposal = await service.propose(run, { summary: "Add a box", commands: [addBox] });
    expect(proposal.baseRevision).toBe(4);
    expect(proposal.status).toBe("proposed");
    expect(proposal.requiresApproval).toBe(false);
  });

  it("rejects proposals that reference missing objects before anyone previews them", async () => {
    const { service, run } = setup();
    await expect(
      service.propose(run, {
        summary: "Move a ghost",
        commands: [{ commandId: "t", type: "scene.transform_object", objectId: "ghost", transform: { position: [0, 0, 0] } }],
      }),
    ).rejects.toThrow(ValidationFailedError);
  });

  it("marks destructive proposals as requiring approval", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, objects: [{ id: "old", name: "old", type: "mesh", parentId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }] };
    const proposal = await service.propose(run, {
      summary: "Remove old",
      commands: [{ commandId: "d", type: "scene.delete_object", objectId: "old" }],
    });
    expect(proposal.requiresApproval).toBe(true);
  });

  it("executes an approved proposal exactly once and returns the stored result on repeat calls", async () => {
    const { bridge, service, run } = setup();
    const proposal = await service.propose(run, { summary: "Add a box", commands: [addBox] });

    const first = await service.apply(run, proposal.id);
    const second = await service.apply(run, proposal.id);

    expect(first.status).toBe("applied");
    expect(second).toEqual(first);
    expect(bridge.executions).toHaveLength(1);
    expect(bridge.executions[0]?.idempotencyKey).toBe(proposal.id);
    expect(bridge.executions[0]?.expectedRevision).toBe(4);
  });

  it("refuses to run a proposal that is already being applied", async () => {
    const { service, run } = setup();
    const proposal = await service.propose(run, { summary: "Add a box", commands: [addBox] });

    const [first, second] = await Promise.allSettled([service.apply(run, proposal.id), service.apply(run, proposal.id)]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    if (second.status === "rejected") expect(second.reason).toBeInstanceOf(ConflictError);
  });

  it("does not run a proposal the user rejected", async () => {
    const { bridge, service, run } = setup();
    const proposal = await service.propose(run, { summary: "Add a box", commands: [addBox] });
    service.reject(run.id, proposal.id);

    await expect(service.apply(run, proposal.id)).rejects.toThrow(/rejected/);
    expect(bridge.executions).toHaveLength(0);
  });

  it("does not let a proposal from one run be applied through another run", async () => {
    const { service, run } = setup();
    const proposal = await service.propose(run, { summary: "Add a box", commands: [addBox] });
    await expect(service.apply({ ...run, id: "run_other" }, proposal.id)).rejects.toThrow(/not found/);
  });
});
