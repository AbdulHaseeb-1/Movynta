import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import { emptyRunProgress } from "../../agent-runs/run-progress.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { ProposalInput, ProposalRun } from "../../editor-bridge/proposals/proposals.types.js";
import type { EditorContext } from "../../../shared/types/editor-context.types.js";
import { createProceduralTools } from "./procedural.tools.js";

it("proposes generated face edits at the inspection revision without echoing component IDs", async () => {
  const snapshot: EditorContext = {
    projectId: "p", revision: 7, activeSceneName: "Main", selectedObjectIds: [],
    objects: [{ id: "box", name: "box", type: "mesh", parentId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
    meshInspection: { objectId: "box", meshPath: [], view: "base", status: "ok", parts: [], partsTruncated: false, offset: 0, vertices: [], edges: [], faces: [], faceMatches: { ids: ["4", "8"], total: 2, offset: 0, hasMore: false } },
  };
  const bridge = {
    assertConnection: () => ({ userId: "u", projectId: "p", clientId: "c" }),
    getContext: () => Promise.resolve(snapshot),
  } as unknown as EditorBridge;
  let received: ProposalInput | undefined;
  const applied: string[] = [];
  const proposals = {
    apply: (_run: ProposalRun, proposalId: string) => {
      applied.push(proposalId);
      return Promise.resolve({ proposalId, status: "applied" as const, revision: 8, results: [], message: undefined });
    },
    propose: (run: ProposalRun, input: ProposalInput) => {
      received = input;
      return Promise.resolve({
        id: "prp_1", runId: run.id, projectId: run.projectId, clientId: run.clientId,
        baseRevision: 7, summary: input.summary, commands: input.commands, requiresApproval: true,
        status: "proposed" as const, result: undefined, createdAt: "", updatedAt: "",
      });
    },
  };
  const events: unknown[] = [];
  const context: AgentRunContext = {
    runId: "run", userId: "u", projectId: "p", clientId: "c", sessionId: "s",
    dimension: undefined, selectedSkillIds: [], progress: emptyRunProgress(), supportsToolImages: false,
    signal: new AbortController().signal,
    events: { emit: (_type: string, payload: unknown) => events.push(payload) } as never,
  };
  const tool = createProceduralTools({ bridge, proposals }).find((entry) => entry.name === "modeling.propose_generated");
  if (!tool) throw new Error("Missing generated proposal tool");
  const result = await tool.execute({
    summary: "Extrude upward faces",
    inspection: { objectId: "box", view: "base", faceQuery: { normal: [0, 1, 0] }, includeSamples: false },
    source: `if (mesh.faceMatches.hasMore) throw Error("partial"); return [{commandId:"e", type:"geometry.extrude", objectId:"box", componentView:"base", kind:"face", ids:mesh.faceMatches.ids, normalDistance:1}];`,
    apply: true,
  }, context);
  // The policy holds this proposal for the user, so asking to apply it in the same call must not apply it.
  expect(applied).toEqual([]);
  expect(received?.expectedRevision).toBe(7);
  expect(received?.commands[0]).toMatchObject({ ids: ["4", "8"], componentView: "base" });
  expect(result).toMatchObject({ proposalId: "prp_1", requiresApproval: true, commandCount: 1, baseRevision: 7 });
  expect(result).not.toHaveProperty("commands");
  expect(events).toHaveLength(1);
});
