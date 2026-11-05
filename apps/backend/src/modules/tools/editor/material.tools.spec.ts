import { jest } from "@jest/globals";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { EditorToolDependencies } from "./editor.types.js";
import { createEditorTools } from "./editor.tools.js";

it("reads material slots without requesting geometry samples or approval", async () => {
  const getContext = jest.fn<EditorBridge["getContext"]>().mockResolvedValue({
    projectId: "p", revision: 7, activeSceneName: "Scene", selectedObjectIds: [], objects: [],
    meshInspection: { objectId: "mesh", meshPath: [], status: "ok", parts: [], partsTruncated: false, offset: 0,
      vertices: [], edges: [], faces: [], materialSlotCount: 2, materials: [], },
  });
  const dependencies: EditorToolDependencies = { bridge: { assertConnection: jest.fn(), getContext } as unknown as EditorBridge,
    proposals: {} as EditorToolDependencies["proposals"] };
  const tool = createEditorTools(dependencies).find((entry) => entry.name === "editor.inspect_materials");
  if (!tool) throw new Error("Missing material inspection");
  const context = { userId: "u", projectId: "p", clientId: "c" } as AgentRunContext;
  await expect(tool.requiresApproval({ objectId: "mesh" }, context)).resolves.toBe(false);
  await expect(tool.execute({ objectId: "mesh" }, context)).resolves.toMatchObject({ revision: 7, status: "ok", materialSlotCount: 2 });
  expect(getContext).toHaveBeenCalledWith("c", { objectId: "mesh", meshPath: [], offset: 0, limit: 25, materialsOnly: true });
});
