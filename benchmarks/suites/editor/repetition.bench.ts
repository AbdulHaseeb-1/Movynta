import { it } from "vitest";
import { SphereGeometry } from "three";
import { repeatGeometry } from "@/features/meshGeometry/repetitionModifiers";
import { buildEditor } from "../../fixtures/scene.fixtures";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishSuite } from "../../lib/report";
import { consume } from "../../lib/sink";

// Includes attribute output and normal generation for modifiers; duplication includes isolated scene clones.
// Excludes WebGL, source construction and persistence/network.
it("measures bounded arrays, symmetry and hierarchy duplication", async () => {
  const source = new SphereGeometry(1, 24, 12), editors = [10, 100].map((count) => ({ count, built: buildEditor(count) }));
  const cases: BenchCase[] = [4, 16].map((count) => ({ name: "live array", params: { count }, run: () => {
    const output = repeatGeometry(source, { id: "array", kind: "array", enabled: true, count, offset: [3, 0, 0] }, true);
    consume(output.index?.count); output.dispose();
  } }));
  cases.push({ name: "live mirror", params: { sourceTriangles: (source.index?.count ?? 0) / 3 }, run: () => {
    const output = repeatGeometry(source, { id: "mirror", kind: "mirror", enabled: true, axis: "x", origin: 0, bisect: true, keepSide: "positive", mergeDistance: 1e-6 }, true);
    consume(output.index?.count); output.dispose();
  } });
  for (const { count, built } of editors) cases.push({ name: "hierarchy copy preview", params: { sceneObjects: count, copies: 4 }, run: () => built.editor.withProposalPreview("copy-preview", built.editor.currentRevision, [{
    commandId: "copy", type: "scene.duplicate_hierarchy", sourceId: "obj_0", copies: Array.from({ length: 4 }, (_, i) => ({ objectId: `copy_${i}`, descendants: [] })), offset: [3, 0, 0],
  }], (_scene, candidate) => consume(candidate.currentRevision)) });
  try { finishSuite("editor/repetition", await measureCases(cases)); }
  finally { source.dispose(); for (const { built } of editors) built.editor.reset(); }
});
