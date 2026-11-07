import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import { emptyRunProgress, MAX_PLANNED_BATCHES, openWorkReasons, rememberPlannedBatch } from "../../agent-runs/run-progress.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { CommandProposalService } from "../../editor-bridge/proposals/command-proposal.service.js";
import type { ProposalInput } from "../../editor-bridge/proposals/proposals.types.js";
import type { EditorContext } from "../../../shared/types/editor-context.types.js";
import { createEditorTools } from "./editor.tools.js";

const scene: EditorContext = {
  projectId: "p", revision: 4, activeSceneName: "Main", selectedObjectIds: [], supportsRepetition: true,
  objects: [
    { id: "chair", name: "Chair", type: "empty", parentId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    { id: "leg", name: "Leg", type: "mesh", parentId: "chair", transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
  ],
};

function setup(options: { requiresApproval?: boolean; applyStatus?: "applied" | "failed" } = {}) {
  const proposed: ProposalInput[] = [];
  const applied: string[] = [];
  const bridge = {
    assertConnection: () => ({ userId: "u", projectId: "p", clientId: "c" }),
    getContext: () => Promise.resolve(scene),
  } as unknown as EditorBridge;
  const proposals = {
    propose: (_run: unknown, input: ProposalInput) => {
      proposed.push(input);
      return Promise.resolve({ id: `prp_${proposed.length}`, status: "proposed", requiresApproval: options.requiresApproval ?? false,
        commands: input.commands, baseRevision: scene.revision, summary: input.summary });
    },
    apply: (_run: unknown, proposalId: string) => {
      applied.push(proposalId);
      const status = options.applyStatus ?? "applied";
      return Promise.resolve({ proposalId, status, revision: status === "applied" ? 5 : undefined, results: [], message: status === "applied" ? undefined : "No longer fits" });
    },
  } as unknown as CommandProposalService;
  const events: string[] = [];
  const context = {
    runId: "run", userId: "u", projectId: "p", clientId: "c", sessionId: "s", dimension: "3d", selectedSkillIds: [],
    progress: emptyRunProgress(), supportsToolImages: false, signal: new AbortController().signal,
    events: { emit: (type: string) => events.push(type) },
  } as unknown as AgentRunContext;
  const tools = new Map(createEditorTools({ bridge, proposals }).map((tool) => [tool.name, tool]));
  const tool = (name: string) => {
    const found = tools.get(name);
    if (!found) throw new Error(`Missing ${name}`);
    return found;
  };
  return { proposed, applied, events, context, tool };
}

describe("proposing and applying in one call", () => {
  it("proposes a planned batch by its planId and applies it, without the model copying the generated ids", async () => {
    const { proposed, applied, events, context, tool } = setup();
    const plan = await tool("editor.plan_duplicates").execute({ sourceId: "chair", copies: 2, offset: [1, 0, 0] }, context) as { planId: string; commands: unknown[] };
    expect(plan.planId).toBe("batch_1");

    const result = await tool("editor.propose_commands").execute({ summary: "Two more chairs", planId: plan.planId, apply: true }, context);
    expect(proposed[0]?.commands).toEqual(plan.commands);
    expect(proposed[0]?.expectedRevision).toBe(scene.revision);
    expect(applied).toEqual(["prp_1"]);
    expect(result).toMatchObject({ proposalId: "prp_1", status: "applied", revision: 5, rebased: false });
    expect(events).toEqual(["editor.proposal.created"]);
    // The change is tracked exactly as one applied by editor.apply_proposal.
    expect(context.progress.unverifiedChanges).toBe(true);
    expect(context.progress.brief.stale).toBe(true);
    expect(context.progress.quality.changes).toBe(1);
    expect(openWorkReasons(context.progress, () => "applied")).toEqual(["the scene changed after its last check, so run validation.check_scene"]);
  });

  it("only proposes when apply is left out, as before", async () => {
    const { applied, tool, context } = setup();
    const result = await tool("editor.propose_commands").execute({ summary: "Hide", commands: [{ commandId: "h", type: "scene.set_visibility", objectId: "leg", visible: false }] }, context);
    expect(applied).toEqual([]);
    expect(result).toMatchObject({ proposalId: "prp_1", status: "proposed", nextAction: expect.stringContaining("editor.apply_proposal") });
    expect(context.progress.unverifiedChanges).toBe(false);
  });

  it("never applies a proposal the approval policy holds for the user", async () => {
    const { applied, tool, context } = setup({ requiresApproval: true });
    const result = await tool("editor.propose_commands").execute({ summary: "Hide", commands: [{ commandId: "h", type: "scene.set_visibility", objectId: "leg", visible: false }], apply: true }, context);
    expect(applied).toEqual([]);
    expect(result).toMatchObject({ status: "proposed", requiresApproval: true });
  });

  it("tells the model what to do when the batch did not apply", async () => {
    const { tool, context } = setup({ applyStatus: "failed" });
    const result = await tool("editor.propose_commands").execute({ summary: "Hide", commands: [{ commandId: "h", type: "scene.set_visibility", objectId: "leg", visible: false }], apply: true }, context);
    expect(result).toMatchObject({ status: "failed", message: "No longer fits", nextAction: expect.stringMatching(/^Not applied/) });
    expect(context.progress.quality.changes).toBe(0);
  });

  it("refuses an unknown planId, both commands and a planId, and a planId at another revision", async () => {
    const { proposed, tool, context } = setup();
    const propose = tool("editor.propose_commands");
    expect(await propose.execute({ summary: "x", planId: "batch_9" }, context)).toMatchObject({ status: "rejected", availablePlanIds: [] });
    const id = rememberPlannedBatch(context.progress, { tool: "test", sourceRevision: 3, commands: [{ commandId: "h", type: "scene.set_visibility", objectId: "leg", visible: false }] });
    expect(await propose.execute({ summary: "x", planId: id, commands: [{ commandId: "h", type: "scene.set_visibility", objectId: "leg", visible: false }] }, context)).toMatchObject({ status: "rejected" });
    expect(await propose.execute({ summary: "x" }, context)).toMatchObject({ status: "rejected" });
    expect(await propose.execute({ summary: "x", planId: id, expectedRevision: 4 }, context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("revision 3") });
    expect(proposed).toEqual([]);
  });

  it("keeps the latest planned batches only, and never reuses a planId", () => {
    const progress = emptyRunProgress();
    const ids = Array.from({ length: MAX_PLANNED_BATCHES + 2 }, () => rememberPlannedBatch(progress, { tool: "test", sourceRevision: 1, commands: [{}] }));
    expect(new Set(ids).size).toBe(ids.length);
    expect(progress.plannedBatches.map((batch) => batch.id)).toEqual(ids.slice(-MAX_PLANNED_BATCHES));
  });
});
