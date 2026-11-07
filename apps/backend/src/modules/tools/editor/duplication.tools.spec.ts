import { emptyRunProgress } from "../../agent-runs/run-progress.js";
import { jest } from "@jest/globals";
import { z } from "zod";
import { editorCommandListSchema, validateAgainstContext, type EditorContext } from "@movynta/editor-protocol";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { EditorToolDependencies } from "./editor.types.js";
import { createDuplicationTool } from "./duplication.tools.js";

const context = { userId: "u", projectId: "p", clientId: "c", progress: emptyRunProgress() } as AgentRunContext;
function setup() {
  const scene: EditorContext = { projectId: "p", revision: 4, activeSceneName: "Scene", selectedObjectIds: [], supportsRepetition: true,
    objects: ["root", "child"].map((id) => ({ id, name: id, type: "empty", parentId: id === "child" ? "root" : null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } })),
  };
  const tool = createDuplicationTool({ bridge: { assertConnection: jest.fn(), getContext: () => Promise.resolve(scene) } as unknown as EditorBridge,
    proposals: {} as EditorToolDependencies["proposals"] });
  return { tool, scene };
}
it("plans fresh mapped hierarchy copies at the source revision without applying", async () => {
  const { tool, scene } = setup();
  const plan = z.object({ sourceRevision: z.number(), commands: editorCommandListSchema }).parse(await tool.execute({ sourceId: "root", copies: 3, offset: [2, 0, 0] }, context));
  expect(plan.sourceRevision).toBe(4); expect(validateAgainstContext(plan.commands, scene)).toEqual([]);
  const command = plan.commands[0]; if (command?.type !== "scene.duplicate_hierarchy") throw new Error("Missing duplication");
  expect(command.copies).toHaveLength(3);
  expect(new Set(command.copies.flatMap((copy) => [copy.objectId, ...copy.descendants.map((entry) => entry.objectId)])).size).toBe(6);
  expect(command.copies.every((copy) => copy.descendants[0]?.sourceId === "child")).toBe(true);
});
it("rejects stale editor capabilities, missing source and excessive copy counts", async () => {
  const { tool, scene } = setup();
  await expect(tool.execute({ sourceId: "ghost", copies: 1, offset: [0, 0, 0] }, context)).rejects.toThrow("Source");
  scene.supportsRepetition = false;
  await expect(tool.execute({ sourceId: "root", copies: 1, offset: [0, 0, 0] }, context)).rejects.toThrow("Update");
  expect(tool.parameters.safeParse({ sourceId: "root", copies: 64, offset: [1, 0, 0] }).success).toBe(false);
});
