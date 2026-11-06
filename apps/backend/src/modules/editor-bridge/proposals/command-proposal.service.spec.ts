import { randomUUID } from "node:crypto";
import { editorCommandListSchema } from "@movynta/editor-protocol";
import { ConflictError, ValidationFailedError } from "../../../common/errors/app-error.js";
import { ApprovalPolicy } from "../../approvals/approval.policy.js";
import { AgentRunRepository } from "../../agent-runs/agent-run.repository.js";
import { SessionsRepository } from "../../sessions/sessions.repository.js";
import { openInMemoryDatabase } from "../../../testing/in-memory-database.js";
import type { EditorCommand } from "../../../shared/types/editor-command.types.js";
import type { EditorContext } from "../../../shared/types/editor-context.types.js";
import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  CommandProposalView,
  EditorBridge,
  EditorConnectionScope,
} from "../editor-bridge.types.js";
import { ProjectScenesService } from "../../projects/project-scenes.service.js";
import { CommandProposalRepository } from "./command-proposal.repository.js";
import { CommandProposalService } from "./command-proposal.service.js";
import type { ProposalRun } from "./proposals.types.js";

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

  captureViews(): Promise<never> {
    return Promise.reject(new Error("Proposals never draw views"));
  }

  executeCommands(_clientId: string, request: CommandExecutionRequest): Promise<CommandExecutionResult> {
    this.executions.push(request);
    if (request.expectedRevision !== this.scene.revision) {
      return Promise.resolve({ proposalId: request.proposalId, status: "revision_conflict", revision: this.scene.revision, results: [], message: undefined });
    }
    return Promise.resolve({
      proposalId: request.proposalId,
      status: "applied",
      revision: this.scene.revision + 1,
      results: request.commands.map((command) => ({ commandId: command.commandId, status: "applied", message: undefined })),
      message: undefined,
    });
  }
}

function setup() {
  const database = openInMemoryDatabase();
  const bridge = new FakeBridge();
  const scenes = new ProjectScenesService(database);
  const service = new CommandProposalService(new CommandProposalRepository(database), new ApprovalPolicy(), bridge, scenes);

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
  return { bridge, service, run, database, scenes };
}

const addBox: EditorCommand = { commandId: "c1", type: "scene.create_object", objectId: "box", name: "Box" };

function sceneObject(id: string, parentId: string | null = null): EditorContext["objects"][number] {
  return { id, name: id, type: "mesh", parentId, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } };
}

describe("command proposals", () => {
  it("discards a prepared edit if the durable commit fails", async () => {
    const { service, run, bridge, scenes } = setup();
    bridge.scene = { ...bridge.scene, supportsPreparedCommands: true };
    const phases: string[] = [];
    bridge.executeCommands = (_clientId, request) => {
      phases.push(request.phase ?? "legacy");
      return Promise.resolve({ proposalId: request.proposalId, status: "applied", revision: 5, results: [], message: undefined });
    };
    scenes.appendInTransaction = () => { throw new Error("Disk unavailable"); };
    const proposal = await service.propose(run, { summary: "Add box", commands: [addBox] });
    await expect(service.apply(run, proposal.id)).rejects.toThrow("Disk unavailable");
    expect(phases).toEqual(["prepare", "discard"]);
    expect(service.require(run.id, proposal.id).status).toBe("applying");
  });
  it("rolls back the history and applied status together and retries the same proposal", async () => {
    const { service, run, database, scenes, bridge } = setup();
    database.db.prepare("INSERT INTO projects (id, user_id, name, category, starred, created_at, updated_at, objects_indexed) VALUES (?, ?, ?, ?, 0, ?, ?, 1)")
      .run(run.projectId, run.userId, "Project", "design", new Date().toISOString(), new Date().toISOString());
    const proposal = await service.propose(run, { summary: "Add a box", commands: [addBox] });
    const append = scenes.appendInTransaction.bind(scenes);
    let fail = true;
    scenes.appendInTransaction = (...args) => {
      append(...args);
      if (fail) throw new Error("Simulated storage failure");
    };
    await expect(service.apply(run, proposal.id)).rejects.toThrow("Simulated storage failure");
    expect(service.require(run.id, proposal.id).status).toBe("applying");
    expect(scenes.list(run.projectId)).toEqual([]);
    fail = false;
    expect((await service.apply(run, proposal.id)).status).toBe("applied");
    expect(scenes.list(run.projectId)).toHaveLength(1);
    expect(bridge.executions.map((item) => item.idempotencyKey)).toEqual([proposal.id, proposal.id]);
    expect((await service.apply(run, proposal.id)).status).toBe("applied");
    expect(scenes.list(run.projectId)).toHaveLength(1);
  });

  it("keeps a lost editor response retryable instead of recording a failure", async () => {
    const { service, run, bridge } = setup();
    const proposal = await service.propose(run, { summary: "Add a box", commands: [addBox] });
    const execute = bridge.executeCommands.bind(bridge);
    let lost = true;
    bridge.executeCommands = async (clientId, request) => {
      const result = await execute(clientId, request);
      if (lost) throw new Error("Response lost");
      return result;
    };
    await expect(service.apply(run, proposal.id)).rejects.toThrow("Response lost");
    expect(service.require(run.id, proposal.id).status).toBe("applying");
    lost = false;
    expect((await service.apply(run, proposal.id)).status).toBe("applied");
    expect(bridge.executions.map((item) => item.idempotencyKey)).toEqual([proposal.id, proposal.id]);
  });
  it("automatically permits but refuses to rebase mesh operations even without expectedRevision", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, objects: [sceneObject("mesh")] };
    const proposal = await service.propose(run, { summary: "Subdivide mesh", commands: [{ commandId: "s", type: "geometry.subdivide", objectId: "mesh", meshPath: [], levels: 1 }] });
    expect(proposal.requiresApproval).toBe(false); expect(proposal.strictRevision).toBe(true);
    bridge.scene = { ...bridge.scene, revision: 5 };
    expect((await service.apply(run, proposal.id)).status).toBe("failed");
    expect(bridge.executions).toHaveLength(1);
  });
  it("automatically permits but refuses to rebase face subdivision, like the other base-cage edits", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, objects: [sceneObject("mesh")] };
    const proposal = await service.propose(run, { summary: "Subdivide two faces", commands: [{ commandId: "f", type: "geometry.subdivide_faces", objectId: "mesh", meshPath: [], ids: ["0", "4"] }] });
    expect(proposal.requiresApproval).toBe(false); expect(proposal.strictRevision).toBe(true);
    bridge.scene = { ...bridge.scene, revision: 5 };
    expect((await service.apply(run, proposal.id)).status).toBe("failed");
    expect(bridge.executions).toHaveLength(1);
  });

  it("rejects calculated commands from an obsolete snapshot", async () => {
    const { service, run } = setup();
    await expect(service.propose(run, { summary: "Calculated layout", commands: [addBox], expectedRevision: 3 })).rejects.toThrow(ConflictError);
  });

  it("requires a current inspection revision for an explicit base-cage extrusion", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, objects: [sceneObject("mesh")] };
    const command: EditorCommand = {
      commandId: "ex", type: "geometry.extrude", objectId: "mesh", meshPath: [],
      kind: "face", ids: ["0"], componentView: "base", normalDistance: 1,
    };
    const input = { summary: "Extrude a base face", commands: [command] };
    await expect(service.propose(run, input)).rejects.toThrow("require expectedRevision");
    await expect(service.propose(run, { ...input, expectedRevision: 3 })).rejects.toThrow(ConflictError);
    await expect(service.propose(run, { ...input, expectedRevision: 4 })).resolves.toMatchObject({
      strictRevision: true, requiresApproval: false,
    });
  });
  it("requires a current revision for hierarchy copies and never rebases their source", async () => {
    const { bridge, service, run } = setup(); bridge.scene = { ...bridge.scene, supportsRepetition: true, objects: [sceneObject("mesh")] };
    const commands = editorCommandListSchema.parse([{ commandId: "copy", type: "scene.duplicate_hierarchy", sourceId: "mesh", copies: [{ objectId: "copy", descendants: [] }], offset: [2, 0, 0] }]);
    await expect(service.propose(run, { summary: "Copy", commands })).rejects.toThrow("require expectedRevision");
    const proposal = await service.propose(run, { summary: "Copy", commands, expectedRevision: 4 });
    expect(proposal).toMatchObject({ strictRevision: true, requiresApproval: false }); bridge.scene = { ...bridge.scene, revision: 5 };
    expect((await service.apply(run, proposal.id)).status).toBe("failed");
  });
  it.each([
    { type: "material.set_properties", slot: 0, properties: { color: "#ff0000" } },
    { type: "material.add_slot", slot: 1 }, { type: "material.replace_slot", slot: 0 }, { type: "material.assign", slot: 0, ids: ["0"] },
  ])("requires a current revision for $type and applies automatically", async (edit) => {
    const { bridge, service, run } = setup(); bridge.scene = { ...bridge.scene, objects: [sceneObject("mesh")] };
    const commands = editorCommandListSchema.parse([{ ...edit, commandId: "material", objectId: "mesh" }]);
    await expect(service.propose(run, { summary: "Material edit", commands })).rejects.toThrow("require expectedRevision");
    const proposal = await service.propose(run, { summary: "Material edit", commands, expectedRevision: 4 });
    expect(proposal).toMatchObject({ strictRevision: true, requiresApproval: false });
    bridge.scene = { ...bridge.scene, revision: 5 };
    expect((await service.apply(run, proposal.id)).status).toBe("failed");
  });
  it.each([
    { type: "geometry.merge_vertices", ids: ["0", "1"] },
    { type: "geometry.merge_by_distance", ids: ["0", "1"], distance: 0.01 },
    { type: "geometry.remove_duplicate_faces" },
    { type: "geometry.correct_normals", mode: "outward" },
    { type: "geometry.knife_chord", face: "0", start: { edge: "0_1", factor: 0.5 }, end: { edge: "2_3", factor: 0.5 } },
    { type: "geometry.knife_path", segments: [{ face: "0", start: { vertex: "0" }, end: { vertex: "2" } }] },
    { type: "geometry.dissolve_edges", ids: ["0_1"] },
    { type: "geometry.loop_cut", edge: "0_1" },
    { type: "geometry.bisect", plane: { axis: "y", offset: 0.5 } },
    { type: "geometry.bisect", plane: { point: [0, 0, 0], normal: [1, 0, 0] }, space: "world", keep: "positive", fill: true },
    { type: "geometry.delete_components", kind: "face", ids: ["0"] },
    { type: "geometry.flip_normals" },
    { type: "geometry.set_shading", mode: "smooth", angle: 35 },
    { type: "geometry.separate_faces", ids: ["0", "1"], newObjectId: "part" },
    { type: "geometry.bridge_edge_loops", ids: ["0_1", "1_2", "0_2", "3_4", "4_5", "3_5"] },
    { type: "geometry.triangulate_faces", ids: ["0", "1"] },
    { type: "geometry.slide_edges", ids: ["0_1"], rails: [{ vertex: "0", toward: "2" }, { vertex: "1", toward: "3" }], factor: 0.25 },
  ])("requires a base inspection revision for $type and applies automatically", async (edit) => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, objects: [sceneObject("mesh")] };
    const command = editorCommandListSchema.parse([{ ...edit, commandId: "edit", objectId: "mesh" }]);
    await expect(service.propose(run, { summary: "Edit mesh", commands: command })).rejects.toThrow("require expectedRevision");
    const proposal = await service.propose(run, { summary: "Edit mesh", commands: command, expectedRevision: 4 });
    expect(proposal).toMatchObject({ requiresApproval: false, strictRevision: true });
    bridge.scene = { ...bridge.scene, revision: 5 };
    expect((await service.apply(run, proposal.id)).status).toBe("failed");
  });
  it("requires an inspection revision for vertex/edge transforms and never rebases them", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, objects: [sceneObject("mesh")] };
    const command: EditorCommand = { commandId: "move", type: "geometry.transform_components", objectId: "mesh", meshPath: [],
      kind: "edge", ids: ["0_1"], componentView: "base", space: "world", transform: { position: [0, 0.1, 0] } };
    await expect(service.propose(run, { summary: "Move edge", commands: [command] })).rejects.toThrow("require expectedRevision");
    const proposal = await service.propose(run, { summary: "Move edge", commands: [command], expectedRevision: 4 });
    expect(proposal).toMatchObject({ strictRevision: true, requiresApproval: false });
    bridge.scene = { ...bridge.scene, revision: 5 };
    expect((await service.apply(run, proposal.id)).status).toBe("failed");
  });

  it("persists strict revisions and refuses to rebase calculated layouts", async () => {
    const { bridge, service, run } = setup();
    const proposal = await service.propose(run, { summary: "Calculated layout", commands: [addBox], expectedRevision: 4 });
    expect(service.require(run.id, proposal.id).strictRevision).toBe(true);
    bridge.scene = { ...bridge.scene, revision: 5 };
    const result = await service.apply(run, proposal.id);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Regenerate");
    expect(bridge.executions).toHaveLength(1);
  });
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

  it("automatically permits destructive proposals", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, objects: [{ id: "old", name: "old", type: "mesh", parentId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }] };
    const proposal = await service.propose(run, {
      summary: "Remove old",
      commands: [{ commandId: "d", type: "scene.delete_object", objectId: "old" }],
    });
    expect(proposal.requiresApproval).toBe(false);
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

  it("runs a batch again on a newer scene when its commands still fit, and says so", async () => {
    const { bridge, service, run } = setup();
    const proposal = await service.propose(run, { summary: "Add a box", commands: [addBox] });
    bridge.scene = { ...bridge.scene, revision: 9 };

    const result = await service.apply(run, proposal.id);

    expect(result.status).toBe("applied");
    expect(result.rebased).toBe(true);
    expect(bridge.executions.map((request) => request.expectedRevision)).toEqual([4, 9]);
  });

  it("fails a batch whose commands no longer fit the newer scene, so it has to be proposed again", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, objects: [sceneObject("old")] };
    const proposal = await service.propose(run, {
      summary: "Move old",
      commands: [{ commandId: "t", type: "scene.transform_object", objectId: "old", transform: { position: [1, 0, 0] } }],
    });
    bridge.scene = { ...bridge.scene, revision: 9, objects: [] };

    const result = await service.apply(run, proposal.id);

    expect(result.status).toBe("failed");
    expect(result.message).toContain("no longer fits");
    expect(bridge.executions).toHaveLength(1);
  });

  it("replaces a waiting proposal with a newer one, and the replaced one can no longer be applied", async () => {
    const { service, run } = setup();
    const first = await service.propose(run, { summary: "Add a box", commands: [addBox] });
    const second = await service.propose(run, {
      summary: "Add a second box",
      commands: [{ ...addBox, commandId: "c2", objectId: "box2" }],
      supersedes: first.id,
    });

    expect(service.require(run.id, first.id).status).toBe("superseded");
    await expect(service.apply(run, first.id)).rejects.toThrow(/replaced/);
    expect((await service.apply(run, second.id)).status).toBe("applied");
  });

  it("refuses to supersede a proposal that was already applied", async () => {
    const { service, run } = setup();
    const first = await service.propose(run, { summary: "Add a box", commands: [addBox] });
    await service.apply(run, first.id);

    await expect(
      service.propose(run, { summary: "Again", commands: [{ ...addBox, commandId: "c3", objectId: "box3" }], supersedes: first.id }),
    ).rejects.toThrow(ConflictError);
  });

  it("checks renames, visibility and parent changes against the scene and the batch so far", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, objects: [sceneObject("a"), sceneObject("b", "a")] };

    await expect(
      service.propose(run, { summary: "Rename ghost", commands: [{ commandId: "r", type: "scene.rename_object", objectId: "ghost", name: "Ghost" }] }),
    ).rejects.toThrow(ValidationFailedError);
    await expect(
      service.propose(run, { summary: "Hide ghost", commands: [{ commandId: "v", type: "scene.set_visibility", objectId: "ghost", visible: false }] }),
    ).rejects.toThrow(ValidationFailedError);
    // "b" hangs below "a", so "a" cannot be placed under "b".
    await expect(
      service.propose(run, { summary: "Loop", commands: [{ commandId: "p", type: "scene.set_parent", objectId: "a", parentId: "b" }] }),
    ).rejects.toThrow(ValidationFailedError);
    // Moving "b" to the top first makes the later move of "a" under "b" valid.
    const valid = await service.propose(run, {
      summary: "Swap",
      commands: [
        { commandId: "p1", type: "scene.set_parent", objectId: "b", parentId: null },
        { commandId: "p2", type: "scene.set_parent", objectId: "a", parentId: "b" },
      ],
    });
    expect(valid.status).toBe("proposed");
    // Once "a" is under "b" in the batch, moving "b" under "a" would make a cycle.
    await expect(
      service.propose(run, {
        summary: "Cycle",
        commands: [
          { commandId: "q1", type: "scene.set_parent", objectId: "a", parentId: "b" },
          { commandId: "q2", type: "scene.set_parent", objectId: "b", parentId: "a" },
        ],
      }),
    ).rejects.toThrow(ValidationFailedError);
  });

  it("asks for approval only for destructive or very large batches", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, objects: [sceneObject("box")] };
    const renames = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        commandId: `r${index}`,
        type: "scene.rename_object" as const,
        objectId: "box",
        name: `Box ${index}`,
      }));

    expect((await service.propose(run, { summary: "Rename", commands: renames(25) })).requiresApproval).toBe(false);
    expect((await service.propose(run, { summary: "Rename many", commands: renames(101) })).requiresApproval).toBe(false);
  });
});

describe("names the editor gave objects", () => {
  it("keeps the name each command ended up with, in the result and in the stored result", async () => {
    const { service, run, bridge } = setup();
    bridge.executeCommands = (_clientId, request) => Promise.resolve({
      proposalId: request.proposalId,
      status: "applied",
      revision: 5,
      results: request.commands.map((command) => ({ commandId: command.commandId, status: "applied", message: undefined, name: "Box.001" })),
      message: undefined,
    });
    const proposal = await service.propose(run, { summary: "Add a box", commands: [addBox] });
    const applied = await service.apply(run, proposal.id);
    expect(applied.results[0]?.name).toBe("Box.001");
    // A second apply returns what was stored, read back from the database.
    expect((await service.apply(run, proposal.id)).results[0]?.name).toBe("Box.001");
  });

  it("refuses a proposal that uses the new creator fields on an editor that predates them", async () => {
    const { service, run } = setup();
    const named: EditorCommand = { commandId: "n1", type: "geometry.create_primitive", objectId: "torso", primitive: "box", size: 1, replaceExisting: false, name: "Torso" };
    await expect(service.propose(run, { summary: "Torso", commands: [named] })).rejects.toBeInstanceOf(ValidationFailedError);
  });
});

describe("relative moves", () => {
  const move: EditorCommand = { commandId: "m", type: "scene.move_object", objectId: "g", delta: [0, 2, 0] };

  it("run again as they are on a newer scene, so a change made in between is kept", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, supportsSceneGraph: true, objects: [sceneObject("g")] };
    const proposal = await service.propose(run, { summary: "Raise the group", commands: [move] });
    // The user changes the scene after the proposal was written.
    bridge.scene = { ...bridge.scene, revision: 9 };
    const result = await service.apply(run, proposal.id);
    expect(result.status).toBe("applied");
    expect(result.rebased).toBe(true);
    expect(bridge.executions.map((request) => request.expectedRevision)).toEqual([4, 9]);
    // The editor was sent the same distance both times, not a position worked out from the old scene.
    expect(bridge.executions.map((request) => request.commands)).toEqual([[move], [move]]);
  });

  it("are refused for an editor that does not advertise them", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, objects: [sceneObject("g")] };
    await expect(service.propose(run, { summary: "Raise the group", commands: [move] })).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it("refuse a re-parenting that would shear a part, before anything is stored", async () => {
    const { bridge, service, run } = setup();
    const group = { ...sceneObject("group"), transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1] } } as EditorContext["objects"][number];
    const part = { ...sceneObject("part"), transform: { position: [0, 0, 0], rotation: [0, 0.6, 0], scale: [1, 1, 1] } } as EditorContext["objects"][number];
    bridge.scene = { ...bridge.scene, supportsSceneGraph: true, objects: [group, part] };
    const command: EditorCommand = { commandId: "s", type: "scene.set_parent", objectId: "part", parentId: "group" };
    const failure = await service.propose(run, { summary: "Attach", commands: [command] }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ValidationFailedError);
    // The assistant is shown the issues, which say how to avoid the problem.
    const issues = failure instanceof ValidationFailedError ? JSON.stringify(failure.details?.["issues"]) : "";
    expect(issues).toContain("shearing");
    expect(issues).toContain("parentId");
    expect(bridge.executions).toHaveLength(0);
  });
});

describe("collections in proposals", () => {
  const make: EditorCommand = { commandId: "c", type: "scene.create_collection", collectionId: "set", name: "Set" };

  it("are refused for an editor that predates them, and accepted for one that has them", async () => {
    const { bridge, service, run } = setup();
    await expect(service.propose(run, { summary: "Make a collection", commands: [make] })).rejects.toBeInstanceOf(ValidationFailedError);
    bridge.scene = { ...bridge.scene, supportsCollections: true };
    expect((await service.propose(run, { summary: "Make a collection", commands: [make] })).status).toBe("proposed");
  });

  it("do not need approval to make, move, hide or delete a collection, since nothing is lost", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, supportsCollections: true, collections: [{ id: "set", name: "Set", parentId: null, visible: true }] };
    const commands: EditorCommand[] = [
      { commandId: "h", type: "scene.set_collection_visibility", collectionId: "set", visible: false },
      { commandId: "d", type: "scene.delete_collection", collectionId: "set" },
    ];
    expect((await service.propose(run, { summary: "Tidy", commands })).requiresApproval).toBe(false);
  });

  it("keeps the name the editor gave a collection in the result", async () => {
    const { bridge, service, run } = setup();
    bridge.scene = { ...bridge.scene, supportsCollections: true };
    bridge.executeCommands = (_clientId, request) => Promise.resolve({
      proposalId: request.proposalId, status: "applied", revision: 5, message: undefined,
      results: request.commands.map((command) => ({ commandId: command.commandId, status: "applied", message: undefined, name: "Set.001" })),
    });
    const proposal = await service.propose(run, { summary: "Make a collection", commands: [make] });
    expect((await service.apply(run, proposal.id)).results[0]?.name).toBe("Set.001");
  });
});
