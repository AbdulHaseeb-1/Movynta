/*
 * BENCH: The scene outline: reading the objects, building the tree, and flattening it into lines
 * TIER: HIGH
 * SUBJECT: apps/desktop/src/features/assistant/EditorScene.ts#outline, and
 *          apps/desktop/src/features/designWorkspace/sceneTree.ts#buildSceneTree, #flattenTree, #canMoveUnder, #visibleRange
 * MEASURES: latency
 * COMPLEXITY: outline, buildSceneTree and flattenTree O(objects); canMoveUnder O(depth); visibleRange O(1)
 * INPUTS: objects 100..2000 (the app caps a scene at 2000), arranged as a tree with 8 children per parent (a
 *         figure of groups, parts and sub-parts) and, for the worst case for depth, as one chain
 * BASELINE: none yet; record one on the reference machine with BENCH_UPDATE_BASELINE=1. The growth claims below
 *           hold on any machine and are checked on every run.
 * THRESHOLD: growth exponent within the declared one plus the shared tolerance
 * EXCLUDES: React rendering, the drawn window of lines (it is a fixed number of lines whatever the scene), saving
 * NOTES: the outline is rebuilt once per change of the scene and never for a selection. Flattening is the part
 *        that also runs when a group is opened or closed. Both must stay far below a frame at the 2000-object cap,
 *        and neither may be quadratic: a chain of thousands of nested objects is walked with a stack, not recursion.
 */
import { describe, it } from "vitest";
import type { CollectionEntry, OutlineEntry } from "@/features/assistant/EditorScene";
import { buildSceneTree, canMoveUnder, flattenTree, visibleRange } from "@/features/designWorkspace/sceneTree";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";
import { buildEditor } from "../../fixtures/scene.fixtures";

const OBJECT_COUNTS = [100, 200, 400, 800, 1600, 2000];
const BRANCHING = 8;

/** Objects numbered in creation order, each under the one at index (n - 1) / 8, like a figure of nested groups. */
function branching(count: number): OutlineEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `o${index}`,
    collectionId: null,
    name: `Part.${String(index).padStart(3, "0")}`,
    kind: index % BRANCHING === 0 ? "empty" : "mesh",
    parentId: index === 0 ? null : `o${Math.floor((index - 1) / BRANCHING)}`,
    visible: index % 17 !== 0,
  }));
}

/** A tenth as many collections as objects, nested four deep, with the objects spread across them. */
function collected(count: number): { entries: OutlineEntry[]; collections: CollectionEntry[] } {
  const groups = Math.max(1, Math.floor(count / 10));
  const collections: CollectionEntry[] = Array.from({ length: groups }, (_, index) => ({
    id: `k${index}`, name: `Collection ${index}`, parentId: index < 4 ? null : `k${Math.floor((index - 4) / 4)}`, visible: index % 7 !== 0,
  }));
  const entries = branching(count).map((entry, index) => ({ ...entry, collectionId: `k${index % groups}` }));
  return { entries, collections };
}

function chain(count: number): OutlineEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`, name: `Link.${index}`, kind: "empty" as const, parentId: index === 0 ? null : `c${index - 1}`, visible: true, collectionId: null,
  }));
}

describe("scene outline", () => {
  it("reads the objects of the scene in time linear in the scene", async () => {
    const cases: BenchCase[] = OBJECT_COUNTS.map((objects) => {
      const built = buildEditor(objects);
      return { name: "outline", params: { objects }, run: () => consume(built.editor.outline().length) };
    });
    const results = await measureCases(cases);
    finishWithGrowth("editor/outline.read", results, [{ key: "objects", declared: 1, tolerance: 0.4 }]);
  });

  it("builds the tree and flattens it in time linear in the scene", async () => {
    const cases: BenchCase[] = OBJECT_COUNTS.flatMap((objects) => {
      const list = branching(objects);
      const tree = buildSceneTree(list);
      const collapsed = new Set(list.filter((_, index) => index > 0 && index % 5 === 0).map((entry) => entry.id));
      return [
        { name: "buildSceneTree", params: { objects }, run: () => consume(buildSceneTree(list).roots.length) },
        { name: "flattenTree", params: { objects }, run: () => consume(flattenTree(tree, new Set()).length) },
        { name: "flattenTree(collapsed)", params: { objects }, run: () => consume(flattenTree(tree, collapsed).length) },
      ];
    });
    const results = await measureCases(cases);
    finishWithGrowth(
      "editor/outline.tree",
      results,
      ["buildSceneTree", "flattenTree", "flattenTree(collapsed)"].map((name) => ({
        key: "objects", declared: 1, tolerance: 0.4, label: name, where: (result: { name: string }) => result.name === name,
      })),
    );
  });

  it("builds and flattens a tree with collections in time linear in the scene", async () => {
    const cases: BenchCase[] = OBJECT_COUNTS.flatMap((objects) => {
      const { entries, collections } = collected(objects);
      const tree = buildSceneTree(entries, collections);
      return [
        { name: "buildSceneTree(collections)", params: { objects }, run: () => consume(buildSceneTree(entries, collections).roots.length) },
        { name: "flattenTree(collections)", params: { objects }, run: () => consume(flattenTree(tree, new Set()).length) },
      ];
    });
    const results = await measureCases(cases);
    finishWithGrowth(
      "editor/outline.collections",
      results,
      ["buildSceneTree(collections)", "flattenTree(collections)"].map((name) => ({
        key: "objects", declared: 1, tolerance: 0.4, label: name, where: (result: { name: string }) => result.name === name,
      })),
    );
  });

  it("walks a chain of nested objects without growing faster than the chain", async () => {
    const cases: BenchCase[] = OBJECT_COUNTS.map((objects) => {
      const tree = buildSceneTree(chain(objects));
      const deepest = `c${objects - 1}`;
      return [
        { name: "flattenTree(chain)", params: { objects }, run: () => consume(flattenTree(tree, new Set()).length) },
        // A drop is judged by walking up from the target: as long as the chain, once.
        { name: "canMoveUnder(chain)", params: { objects }, run: () => consume(canMoveUnder(tree, "c0", deepest) ? 1 : 0) },
      ];
    }).flat();
    const results = await measureCases(cases);
    finishWithGrowth("editor/outline.chain", results, [
      { key: "objects", declared: 1, tolerance: 0.4, label: "flattenTree(chain)", where: (result) => result.name === "flattenTree(chain)" },
      { key: "objects", declared: 1, tolerance: 0.4, label: "canMoveUnder(chain)", where: (result) => result.name === "canMoveUnder(chain)" },
    ]);
  });

  it("finds the lines to draw in constant time whatever the scene", async () => {
    const cases: BenchCase[] = OBJECT_COUNTS.map((objects) => ({
      name: "visibleRange", params: { objects }, run: () => consume(visibleRange(objects * 14, 280, 28, objects).end),
    }));
    const results = await measureCases(cases);
    finishWithGrowth("editor/outline.window", results, [{ key: "objects", declared: 0, tolerance: 0.5 }]);
  });
});
