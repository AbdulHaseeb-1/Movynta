/*
 * BENCH: Work done on every frame while an object is selected
 * TIER: HIGH
 * SUBJECT: apps/desktop/src/features/objectEditing/ObjectGizmo.ts (the per-frame sync), transformMath helpers
 * MEASURES: latency
 * COMPLEXITY: O(1) in the number of objects in the scene and in the parts of the selected model
 * INPUTS: objects 100..1600; parts of the selected imported model 1k..16k; seed 20260402
 * BASELINE: baselines/editor/frame.baseline.json
 * THRESHOLD: fail if median regresses >25% (and beyond 3x the baseline spread) or p95 >40%
 * EXCLUDES: WebGL rendering (see suites/viewport/render.browser.ts), React re-renders
 * NOTES: a frame is 16.6 ms at 60 fps, so everything here must stay in the microseconds. The camera, renderer
 *        and DOM are stubs: the sync never draws, it only looks up and attaches.
 */
import { describe, it } from "vitest";
import { Group, type Object3D, type Scene } from "three";
import { ObjectGizmo } from "@/features/objectEditing/ObjectGizmo";
import { formatNumber, parseNumber, radiansToDegrees, sameTransform, withAxis } from "@/features/objectEditing/transformMath";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";
import { buildEditor, flatModel } from "../../fixtures/scene.fixtures";
import { stubViewport } from "../../fixtures/viewport.fixtures";

// The gizmo listens for keys on the window; in Node there is none, so an event target stands in.
Object.assign(globalThis, {
  window: new EventTarget(),
  // The handles take their colors from the page's theme tokens; the stub has none, so they fall back to white.
  document: { documentElement: {} },
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
});

function selectedGizmo(scene: Scene, editor: import("@/features/assistant/EditorScene").EditorScene, id: string) {
  const { viewport, frame } = stubViewport(scene, (objects: readonly Object3D[]) => consume(objects.length));
  const gizmo = new ObjectGizmo(
    viewport,
    editor,
    { onLiveChange: () => undefined, onCommit: () => undefined },
    { tool: () => "move", enabled: () => true },
  );
  editor.select(id);
  frame();
  return { gizmo, frame };
}

describe("per-frame selection work", () => {
  it("syncs the gizmo in constant time however large the scene is", async () => {
    const cases: BenchCase[] = [100, 200, 400, 800, 1600].map((objects) => {
      const built = buildEditor(objects);
      const { frame } = selectedGizmo(built.scene, built.editor, "obj_0");
      return { name: "ObjectGizmo frame sync", params: { objects }, run: () => frame() };
    });
    const results = await measureCases(cases);
    finishWithGrowth("editor/frame.objects", results, [{ key: "objects", declared: 0, tolerance: 0.4 }]);
  });

  it("syncs the gizmo in constant time however many parts the selected model has", async () => {
    const cases: BenchCase[] = [1000, 4000, 16000].map((parts) => {
      const { scene, editor } = buildEditor(1);
      const model = new Group();
      model.add(flatModel(parts));
      editor.importObject("model", model);
      const { frame } = selectedGizmo(scene, editor, "model");
      return { name: "ObjectGizmo frame sync (model)", params: { parts }, run: () => frame() };
    });
    const results = await measureCases(cases);
    finishWithGrowth("editor/frame.parts", results, [{ key: "parts", declared: 0, tolerance: 0.4 }]);
  });

  it("formats and parses the values the panel shows on every drag event", async () => {
    const transform = { position: [1.2345, -2.5, 0.125], rotation: [0.1, 0.2, 0.3], scale: [1, 1, 1.0001] } as const;
    const moved = { ...transform, position: [1.2346, -2.5, 0.125] } as const;
    const results = await measureCases([
      { name: "formatNumber x9 (one panel render)", params: { calls: 9 }, run: () => {
        let length = 0;
        for (const group of [transform.position, transform.rotation, transform.scale])
          for (const value of group) length += formatNumber(value).length;
        consume(length);
      } },
      { name: "parseNumber", params: { calls: 1 }, run: () => consume(parseNumber(" -12.345 ") ?? 0) },
      { name: "radiansToDegrees", params: { calls: 1 }, run: () => consume(radiansToDegrees([0.1, 0.2, 0.3])[0]) },
      { name: "withAxis", params: { calls: 1 }, run: () => consume(withAxis([1, 2, 3], 1, 9)[1]) },
      { name: "sameTransform", params: { calls: 1 }, run: () => consume(sameTransform({ position: [...transform.position], rotation: [...transform.rotation], scale: [...transform.scale] }, { position: [...moved.position], rotation: [...moved.rotation], scale: [...moved.scale] }) ? 1 : 0) },
    ]);
    finishWithGrowth("editor/frame.helpers", results, []);
  });
});
