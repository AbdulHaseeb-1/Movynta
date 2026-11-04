/*
 * BENCH: Mesh paths into an imported model: inspecting its parts, and following a path by name or by index
 * TIER: MEDIUM
 * SUBJECT: apps/desktop/src/features/meshGeometry/meshInspection.ts#inspectMesh, #meshAtPath, and
 *          packages/editor-protocol/src/mesh-path.ts#resolveMeshPath, #stableSteps, #stableMeshPath
 * MEASURES: latency
 * COMPLEXITY: a path by index O(depth); by name O(children of each part on the way); stableSteps O(children);
 *             inspectMesh O(parts of the model) to list the first 100 parts; a batch that creates and moves objects
 *             while a Boolean uses one part of the model O(parts), as it has to look at every mesh to find the operand
 * INPUTS: parts 1000..16000 in one flat group (the worst case for a name lookup), each with a distinct name; seed 20260402
 * BASELINE: none yet; record one on the reference machine with BENCH_UPDATE_BASELINE=1. The growth claims below
 *           hold on any machine and are checked on every run.
 * THRESHOLD: growth exponent within the declared one plus the shared tolerance
 * EXCLUDES: reading the mesh's topology, which inspectMesh does after finding the part (see faceQuery)
 * NOTES: a name lookup walks the children of each part on the way to find the one with that name, so in a flat
 *        model of thousands of parts it costs the number of parts. It runs once per command and once per Boolean
 *        modifier that names an operand, never per vertex, so it has to stay far below a frame at 16000 parts.
 */
import { describe, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene } from "three";
import { resolveMeshPath, stableMeshPath, stableSteps } from "../../../packages/editor-protocol/src/mesh-path";
import { meshInspectionRequestSchema } from "../../../packages/editor-protocol/src/mesh.schema";
import { EditorScene } from "@/features/assistant/EditorScene";
import { ensureManifold } from "@/features/meshGeometry/meshBoolean";
import { meshAtPath, inspectMesh } from "@/features/meshGeometry/meshInspection";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

const PART_COUNTS = [1000, 2000, 4000, 8000, 16000];

/** One group with `parts` meshes that share a geometry, each with its own name, like an exported scene of many small meshes. */
function namedModel(parts: number): Group {
  const geometry = new BoxGeometry(0.2, 0.2, 0.2);
  const material = new MeshStandardMaterial();
  const model = new Group();
  for (let index = 0; index < parts; index += 1) {
    const mesh = new Mesh(geometry, material);
    mesh.name = `Part_${index}`;
    model.add(mesh);
  }
  return model;
}

describe("mesh paths", () => {
  it("follows a path to the last of many parts, by index in constant time and by name in time linear in the parts", async () => {
    const cases: BenchCase[] = PART_COUNTS.flatMap((parts) => {
      const model = namedModel(parts);
      const byIndex = [parts - 1];
      const byName = [`Part_${parts - 1}`];
      return [
        { name: "resolve by index", params: { parts }, run: () => consume(resolveMeshPath(model, byIndex) ? 1 : 0) },
        { name: "resolve by name", params: { parts }, run: () => consume(resolveMeshPath(model, byName) ? 1 : 0) },
        { name: "meshAtPath by name", params: { parts }, run: () => consume(meshAtPath(model, byName).name.length) },
      ];
    });
    const results = await measureCases(cases);
    finishWithGrowth("editor/meshPath.resolve", results, [
      { key: "parts", declared: 0, tolerance: 0.5, label: "resolve by index", where: (result) => result.name === "resolve by index" },
      { key: "parts", declared: 1, tolerance: 0.4, label: "resolve by name", where: (result) => result.name === "resolve by name" },
      { key: "parts", declared: 1, tolerance: 0.4, label: "meshAtPath by name", where: (result) => result.name === "meshAtPath by name" },
    ]);
  });

  it("works out the stable steps of a wide group in time linear in its children, not their square", async () => {
    const cases: BenchCase[] = PART_COUNTS.flatMap((parts) => {
      const model = namedModel(parts);
      // Half the parts share a name, so most steps carry a count.
      model.children.forEach((child, index) => (child.name = `Part_${index % (parts / 2)}`));
      return [
        { name: "stableSteps", params: { parts }, run: () => consume(stableSteps(model).length) },
        { name: "stableMeshPath", params: { parts }, run: () => consume(stableMeshPath(model, [parts - 1]).length) },
      ];
    });
    const results = await measureCases(cases);
    finishWithGrowth("editor/meshPath.stable", results, [
      { key: "parts", declared: 1, tolerance: 0.4, label: "stableSteps", where: (result) => result.name === "stableSteps" },
      { key: "parts", declared: 1, tolerance: 0.4, label: "stableMeshPath", where: (result) => result.name === "stableMeshPath" },
    ]);
  });

  it("lists the parts of an imported model, with their stable paths, in time linear in the parts", async () => {
    const cases: BenchCase[] = PART_COUNTS.map((parts) => {
      const model = namedModel(parts);
      const request = meshInspectionRequestSchema.parse({ objectId: "model", includeSamples: false });
      return { name: "inspectMesh parts", params: { parts }, run: () => consume(inspectMesh(model, request).parts.length) };
    });
    const results = await measureCases(cases);
    finishWithGrowth("editor/meshPath.inspect", results, [{ key: "parts", declared: 1, tolerance: 0.5 }]);
  });

  it("runs a batch that creates and moves objects while a Boolean uses a part of a large model, in time linear in the parts", async () => {
    await ensureManifold();
    const cases: BenchCase[] = PART_COUNTS.map((parts) => {
      const editor = new EditorScene(new Scene(), "prj_bench");
      const model = namedModel(parts);
      const cutter = model.children[1];
      if (cutter) cutter.position.set(0.5, 0.5, 0.5);
      editor.importObject("model", model);
      const apply = (commands: unknown[]) => {
        const result = editor.execute(`bench-${editor.currentRevision}`, editor.currentRevision, commands);
        if (result.status !== "applied") throw new Error(`The fixture batch was rejected: ${JSON.stringify(result)}`);
      };
      apply([{ commandId: "box", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 1, replaceExisting: false }]);
      apply([{
        commandId: "cut", type: "geometry.set_modifiers", objectId: "box",
        modifiers: [{ id: "cut", kind: "boolean", enabled: true, operation: "difference", operandObjectId: "model", operandMeshPath: ["Part_1"] }],
      }]);
      let runs = 0;
      return {
        name: "create and move with a Boolean on a part",
        params: { parts },
        run: () => {
          runs += 1;
          // Staged: creating and moving in one batch. Then the new object goes again, so the scene keeps its size.
          apply([
            { commandId: "n", type: "geometry.create_primitive", objectId: "n", primitive: "box", size: 1, replaceExisting: false },
            { commandId: "t", type: "scene.transform_object", objectId: "n", transform: { position: [runs, 0, 0] } },
          ]);
          apply([{ commandId: "d", type: "scene.delete_object", objectId: "n" }]);
          consume(runs);
        },
      };
    });
    const results = await measureCases(cases);
    finishWithGrowth("editor/meshPath.staged", results, [{ key: "parts", declared: 1, tolerance: 0.5 }]);
  });
});
