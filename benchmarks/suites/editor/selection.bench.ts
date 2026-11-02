/*
 * BENCH: Selecting and changing many objects at once
 * TIER: HIGH
 * SUBJECT: apps/desktop/src/features/objectEditing/ groupTransform.ts#GroupTransform.update, boxSelect.ts#idsInRect,
 *          and EditorScene#selectMany, #selectAll, #applyUserTransforms, #deleteCommandsFor
 * MEASURES: latency
 * COMPLEXITY: O(selected objects) per drag step and to apply or delete them; O(objects) for a rectangle and select all
 * INPUTS: objects 100..1600 (all selected for the group drag and the batch), built by fixtures/scene.fixtures.ts
 * BASELINE: baselines/editor/selection.baseline.json
 * THRESHOLD: fail if median regresses >25% (and beyond 3x the baseline spread) or p95 >40%
 * EXCLUDES: pointer events, drawing the rectangle, React re-renders, saving to the backend
 * NOTES: a group drag step runs on every pointer move, so at 1600 selected objects it must stay far below a frame.
 *        A rectangle measures each object's bounds once, when it is released, so it only has to be quick enough
 *        not to be felt.
 */
import { describe, it } from "vitest";
import { Object3D, PerspectiveCamera } from "three";
import type { ObjectTransform } from "@/features/assistant/EditorScene";
import { idsInRect, rectBetween } from "@/features/objectEditing/boxSelect";
import { GroupTransform } from "@/features/objectEditing/groupTransform";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";
import { buildEditor } from "../../fixtures/scene.fixtures";

const OBJECT_COUNTS = [100, 200, 400, 800, 1600];

describe("selecting and changing many objects", () => {
  it("steps a group drag in time that follows the number of selected objects", async () => {
    const cases: BenchCase[] = OBJECT_COUNTS.map((objects) => {
      const { editor, ids, scene } = buildEditor(objects);
      scene.updateMatrixWorld(true);
      const targets = ids.flatMap((id) => editor.getObject(id) ?? []);
      const pivot = new Object3D();
      const group = new GroupTransform();
      group.begin(pivot, targets);
      let step = 0;
      return {
        name: "GroupTransform.update",
        params: { objects },
        run: () => {
          step += 1;
          pivot.position.set((step % 50) / 50, 0, 0);
          pivot.rotation.y = (step % 100) / 100;
          group.update(pivot);
          consume(targets[objects - 1]?.position.x ?? 0);
        },
      };
    });
    const results = await measureCases(cases);
    finishWithGrowth("editor/selection.group", results, [{ key: "objects", declared: 1, tolerance: 0.4 }]);
  });

  it("selects with a rectangle in time that follows the number of objects in the scene", async () => {
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 1000);
    camera.position.set(0, 0, 6);
    camera.updateMatrixWorld(true);
    const cases: BenchCase[] = OBJECT_COUNTS.map((objects) => {
      const { editor, scene } = buildEditor(objects);
      scene.updateMatrixWorld(true);
      return {
        name: "idsInRect",
        params: { objects },
        run: () => consume(idsInRect(editor.entries(), camera, rectBetween(-0.5, -0.5, 0.5, 0.5)).length),
      };
    });
    const results = await measureCases(cases);
    finishWithGrowth("editor/selection.rect", results, [{ key: "objects", declared: 1, tolerance: 0.4 }]);
  });

  it("selects, changes and deletes many objects in time that follows how many there are", async () => {
    const cases: BenchCase[] = OBJECT_COUNTS.flatMap((objects) => {
      const { editor, ids } = buildEditor(objects);
      const changes = ids.slice(0, 50).map((id, index) => {
        const transform: ObjectTransform = { position: [index, 0, 0], rotation: [0, 0.5, 0], scale: [1, 1, 1] };
        return { id, transform };
      });
      return [
        { name: "selectAll", params: { objects }, run: () => { editor.select(null); editor.selectAll(); consume(editor.selectedIds.length); } },
        { name: "selectMany (every other object)", params: { objects }, run: () => { editor.select(null); editor.selectMany(ids.filter((_, at) => at % 2 === 0)); consume(editor.selectedIds.length); } },
        { name: "deleteCommandsFor (all)", params: { objects }, run: () => consume(editor.deleteCommandsFor(ids).length) },
        // A batch of 50 is the most one save holds, however many objects are selected.
        { name: "applyUserTransforms (50)", params: { objects }, run: () => consume(editor.applyUserTransforms(changes).applied ? 1 : 0) },
      ];
    });
    const results = await measureCases(cases);
    finishWithGrowth("editor/selection.edit", results, [
      { key: "objects", declared: 1, tolerance: 0.5, label: "selectAll", where: (result) => result.name === "selectAll" },
      { key: "objects", declared: 1, tolerance: 0.5, label: "selectMany", where: (result) => result.name.startsWith("selectMany") },
      { key: "objects", declared: 1, tolerance: 0.5, label: "deleteCommandsFor", where: (result) => result.name.startsWith("deleteCommandsFor") },
      { key: "objects", declared: 0, tolerance: 0.5, label: "applyUserTransforms", where: (result) => result.name.startsWith("applyUserTransforms") },
    ]);
  });
});
