import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import { emptyRunProgress, parseRunProgress, rememberPlannedBatch, serializeRunProgress } from "../../agent-runs/run-progress.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { CommandProposalService } from "../../editor-bridge/proposals/command-proposal.service.js";
import type { ProposalInput } from "../../editor-bridge/proposals/proposals.types.js";
import type { EditorContext } from "@movynta/editor-protocol";
import { createEditorTools } from "./editor.tools.js";
import { chunkRejection, MAX_HAND_WRITTEN_COMMANDS, MAX_UNCHECKED_BATCHES } from "./proposal-flow.js";
import { createValidationTools } from "../validation/validation.tools.js";
import { createModelingTools } from "../modeling/modeling.tools.js";

const scene: EditorContext = {
  projectId: "p", revision: 4, activeSceneName: "Main", selectedObjectIds: [],
  objects: [{ id: "leg", name: "Leg", type: "mesh", parentId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
};

const hide = (n: number) => ({ commandId: `h${n}`, type: "scene.set_visibility" as const, objectId: "leg", visible: false });

function setup() {
  const bridge = { assertConnection: () => undefined, getContext: () => Promise.resolve(scene) } as unknown as EditorBridge;
  let count = 0;
  const proposals = {
    propose: (_run: unknown, input: ProposalInput) => {
      count += 1;
      return Promise.resolve({ id: `prp_${count}`, status: "proposed", requiresApproval: false, commands: input.commands, baseRevision: 4, summary: input.summary });
    },
    apply: (_run: unknown, proposalId: string) => Promise.resolve({ proposalId, status: "applied", revision: 5, results: [] }),
  } as unknown as CommandProposalService;
  const context = {
    runId: "run", userId: "u", projectId: "p", clientId: "c", sessionId: "s", dimension: "3d", selectedSkillIds: [],
    progress: emptyRunProgress(), supportsToolImages: false, signal: new AbortController().signal, events: { emit: () => undefined }, toolOutputs: { save: () => "out_test" },
  } as unknown as AgentRunContext;
  const tools = [...createEditorTools({ bridge, proposals }), ...createValidationTools({ bridge }), ...createModelingTools({ knownToolNames: ["editor.propose_commands"] })];
  const tool = (name: string) => {
    const found = tools.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`Missing ${name}`);
    return found;
  };
  return { context, tool };
}

describe("chunkRejection", () => {
  it("lets work through until the limit, then asks for a check", () => {
    const { context } = setup();
    for (let applied = 0; applied < MAX_UNCHECKED_BATCHES; applied += 1) {
      context.progress.batchesSinceCheck = applied;
      expect(chunkRejection(context, {})).toBeUndefined();
    }
    context.progress.batchesSinceCheck = MAX_UNCHECKED_BATCHES;
    expect(chunkRejection(context, {})).toMatchObject({ status: "rejected", nextAction: expect.stringContaining("validation.check_scene") });
  });

  it("accepts a hand-written batch up to the limit and refuses a larger one with a way forward", () => {
    const { context } = setup();
    expect(chunkRejection(context, { handWrittenCommands: MAX_HAND_WRITTEN_COMMANDS })).toBeUndefined();
    expect(chunkRejection(context, { handWrittenCommands: MAX_HAND_WRITTEN_COMMANDS + 1 })).toMatchObject({
      reason: expect.stringContaining("at most 40"),
      nextAction: expect.stringContaining("editor.plan_duplicates"),
    });
  });
});

describe("working in chunks", () => {
  it("stops proposing after three applied batches until the scene is checked", async () => {
    const { context, tool } = setup();
    const propose = tool("editor.propose_commands");
    for (let batch = 0; batch < MAX_UNCHECKED_BATCHES; batch += 1) {
      expect(await propose.execute({ summary: `chunk part ${batch}`, commands: [hide(batch)], apply: true }, context)).toMatchObject({ status: "applied" });
    }
    expect(context.progress.batchesSinceCheck).toBe(MAX_UNCHECKED_BATCHES);

    const refused = await propose.execute({ summary: "next chunk", commands: [hide(9)], apply: true }, context);
    expect(refused).toMatchObject({ status: "rejected", reason: expect.stringContaining("3 batches have been applied since the scene was last checked") });
    // Nothing was stored, so the run has no stray proposal waiting.
    expect(context.progress.proposals).toHaveLength(MAX_UNCHECKED_BATCHES);

    await tool("validation.check_scene").execute({}, context);
    expect(context.progress.batchesSinceCheck).toBe(0);
    expect(await propose.execute({ summary: "next chunk", commands: [hide(10)], apply: true }, context)).toMatchObject({ status: "applied" });
  });

  it("counts only batches that applied", async () => {
    const { context, tool } = setup();
    await tool("editor.propose_commands").execute({ summary: "proposed only", commands: [hide(1)] }, context);
    expect(context.progress.batchesSinceCheck).toBe(0);
  });

  it("refuses a hand-written batch that is too big, but not a planned one", async () => {
    const { context, tool } = setup();
    const propose = tool("editor.propose_commands");
    const big = Array.from({ length: MAX_HAND_WRITTEN_COMMANDS + 1 }, (_, n) => hide(n));
    expect(await propose.execute({ summary: "everything at once", commands: big }, context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("41 commands") });
    expect(await propose.execute({ summary: "at the limit", commands: big.slice(1) }, context)).toMatchObject({ status: "proposed" });
    const planId = rememberPlannedBatch(context.progress, { tool: "modeling.generate_commands", sourceRevision: 4, commands: big });
    expect(await propose.execute({ summary: "calculated", planId }, context)).toMatchObject({ status: "proposed", commandCount: 41 });
  });

  it("explains the next step after an apply", async () => {
    const { context, tool } = setup();
    const result = await tool("editor.propose_commands").execute({ summary: "one part", commands: [hide(1)], apply: true }, context);
    expect(result).toMatchObject({ nextAction: expect.stringMatching(/verify it before starting the next/) });
  });

  it("keeps the count across a pause for approval, and reads progress saved before the count existed", () => {
    const { context } = setup();
    context.progress.batchesSinceCheck = 2;
    expect(parseRunProgress(serializeRunProgress(context.progress)).batchesSinceCheck).toBe(2);
    const { batchesSinceCheck: _omitted, ...older } = JSON.parse(serializeRunProgress(context.progress)) as Record<string, unknown>;
    expect(parseRunProgress(JSON.stringify(older)).batchesSinceCheck).toBe(0);
  });
});

describe("recording a plan", () => {
  const step = (id: string) => ({ id, title: `Step ${id}`, toolName: "editor.propose_commands", description: "" });

  it("refuses two steps with one id", async () => {
    const { context, tool } = setup();
    const result = await tool("modeling.generate_model_plan").execute({ goal: "A chair", dimension: "3d", steps: [step("legs"), step("seat"), step("legs")] }, context);
    expect(result).toMatchObject({ status: "rejected", duplicateStepIds: ["legs"] });
    expect(context.progress.plans).toHaveLength(0);
  });

  it("records a plan whose steps are distinct", async () => {
    const { context, tool } = setup();
    expect(await tool("modeling.generate_model_plan").execute({ goal: "A chair", dimension: "3d", steps: [step("legs"), step("seat")] }, context)).toMatchObject({ status: "recorded", stepCount: 2 });
  });
});
