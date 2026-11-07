import { emptyRunProgress } from "../../agent-runs/run-progress.js";
import { jest } from "@jest/globals";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { EditorContext } from "../../../shared/types/editor-context.types.js";
import type { EditorToolDependencies } from "./editor.types.js";
import { createPlacementTool } from "./placement.tools.js";
import { createEditorTools } from "./editor.tools.js";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const context = { userId: "u", projectId: "p", clientId: "c", progress: emptyRunProgress() } as AgentRunContext;
function setup() {
  const objects: EditorContext["objects"] = ["a", "b", "c", "parent"].map((id) => ({ id, name: id, type: "mesh", parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }));
  const snapshot: EditorContext = { projectId: "p", activeSceneName: "Main", revision: 5, selectedObjectIds: [], objects };
  const ranges: Record<string, [number, number]> = { a: [0, 2], b: [3, 5], c: [10, 14] };
  let inverse: number[] | null = identity;
  let revision = 5;
  const bridge = {
    assertConnection: jest.fn(),
    getContext: jest.fn((_client: string, _inspection: unknown, request?: { target: { objectId: string } }) => {
      if (!request) return Promise.resolve(snapshot);
      const [min, max] = ranges[request.target.objectId] ?? [0, 1];
      return Promise.resolve({ ...snapshot, revision, measurement: { status: "ok", data: {
        kind: "dimensions", space: "world", bounds: { min: [min, 0, 0], max: [max, 2, 2] },
        size: [max - min, 2, 2], center: [(min + max) / 2, 1, 1], parentWorldInverse: inverse,
      } } });
    }),
  } as unknown as EditorBridge;
  const dependencies: EditorToolDependencies = { bridge, proposals: {} as EditorToolDependencies["proposals"], getUnits: () => ({ display: "cm", metersPerSceneUnit: 2 }) };
  return { tool: createPlacementTool(dependencies), snapshot, dependencies,
    setInverse: (value: number[] | null) => { inverse = value; }, setRevision: (value: number) => { revision = value; } };
}

it("aligns selected bounds to a separate reference", async () => {
  const { tool } = setup();
  expect(await tool.execute({ request: { kind: "align", objectIds: ["a"], referenceId: "c", axes: ["x"], sourceAnchor: "min", referenceAnchor: "max" } }, context))
    .toMatchObject({ sourceRevision: 5, commands: [{ type: "scene.move_object", objectId: "a", delta: [14, 0, 0] }] });
});
it("converts calibrated lengths and world deltas into rotated/scaled parent axes", async () => {
  const { tool, setInverse } = setup();
  setInverse([0, -0.5, 0, 0, 0.5, 0, 0, 0, 0, 0, 1, 0, 100, 200, 0, 1]);
  expect(await tool.execute({ request: { kind: "gap", objectIds: ["a"], referenceId: "c", axis: "x", gap: 100, unit: "cm" } }, context))
    .toMatchObject({ commands: [{ delta: [0, -7.25, 0] }] });
});
it("places on the negative side of the reference", async () => {
  expect(await setup().tool.execute({ request: { kind: "gap", objectIds: ["c"], referenceId: "a", axis: "x", side: "negative", gap: 1 } }, context))
    .toMatchObject({ commands: [{ delta: [-15, 0, 0] }] });
});
it("distributes unequal widths while preserving endpoint positions", async () => {
  expect(await setup().tool.execute({ request: { kind: "distribute", objectIds: ["a", "b", "c"], axis: "x" } }, context))
    .toMatchObject({ commands: [{ objectId: "b", delta: [2, 0, 0] }] });
  expect(await setup().tool.execute({ request: { kind: "distribute", objectIds: ["a", "b", "c"], axis: "x", mode: "centers" } }, context))
    .toMatchObject({ commands: [{ objectId: "b", delta: [2.5, 0, 0] }] });
});
it("rejects stale measurements, singular parents and related targets", async () => {
  const test = setup();
  const args = { request: { kind: "align", objectIds: ["a"], referenceId: "c", axes: ["x"] } };
  test.setRevision(6);
  await expect(test.tool.execute(args, context)).rejects.toThrow("Scene changed");
  test.setRevision(5); test.setInverse(null);
  await expect(test.tool.execute(args, context)).rejects.toThrow("singular");
  const object = test.snapshot.objects[0];
  if (object) object.parentId = "c";
  await expect(test.tool.execute(args, context)).rejects.toThrow("ancestors");
});
it("snaps a measured world point and refuses stale point coordinates", async () => {
  const { tool } = setup();
  const request = { kind: "snap", objectIds: ["a"], from: [1, 2, 3], to: [4, 6, 8], expectedRevision: 5 };
  expect(await tool.execute({ request }, context)).toMatchObject({ commands: [{ delta: [3, 4, 5] }] });
  await expect(tool.execute({ request: { ...request, expectedRevision: 4 } }, context)).rejects.toThrow("Scene changed");
});
it("skips no-op movements and rejects duplicate targets and reversed distribution", async () => {
  const { tool } = setup();
  expect(await tool.execute({ request: { kind: "align", objectIds: ["a"], referenceId: "c", axes: ["y"] } }, context)).toMatchObject({ status: "already_placed", commands: [] });
  await expect(tool.execute({ request: { kind: "align", objectIds: ["a"], referenceId: "a", axes: ["x"] } }, context)).rejects.toThrow("separate");
  await expect(tool.execute({ request: { kind: "distribute", objectIds: ["c", "b", "a"], axis: "x" } }, context)).rejects.toThrow("spatial order");
});
it("never pauses apply calls for approval, including old and unknown proposals", async () => {
  const tool = createEditorTools(setup().dependencies).find((entry) => entry.name === "editor.apply_proposal");
  if (!tool) throw new Error("Missing apply tool");
  await expect(tool.requiresApproval({ proposalId: "old_or_unknown" }, context)).resolves.toBe(false);
});
it("refuses physical gaps without authoritative calibration", async () => {
  const { dependencies } = setup();
  const tool = createPlacementTool({ ...dependencies, getUnits: () => null });
  await expect(tool.execute({ request: { kind: "gap", objectIds: ["a"], referenceId: "c", axis: "x", gap: 10, unit: "cm" } }, context)).rejects.toThrow("Calibrate");
});
