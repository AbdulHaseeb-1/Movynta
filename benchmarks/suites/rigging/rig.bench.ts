/*
 * BENCH: Showing and posing a rig
 * TIER: HIGH
 * SUBJECT: apps/desktop/src/features/rigging/ ikSolver.ts#solveChain, boneWorld.ts#BoneWorld.update, RigOverlay.ts (the per-frame update),
 *          boneHit.ts#pickBone, poseCommands.ts#restoreBatches, and EditorScene#applyUserPose
 * MEASURES: latency
 * COMPLEXITY: O(bones) for the joints, the overlay and picking a bone; O(1) in the number of bones to pose one
 * INPUTS: bones 25..400, built by apps/desktop/src/features/rigging/rigFixture.ts (a binary tree of bones)
 * BASELINE: baselines/rigging/rig.baseline.json
 * THRESHOLD: fail if median regresses >25% (and beyond 3x the baseline spread) or p95 >40%
 * EXCLUDES: WebGL rendering and uploading the buffers to the GPU (see suites/viewport/render.browser.ts)
 * NOTES: the joints and the overlay run on every frame while a rig is shown, so they must stay well under a
 *        millisecond for the biggest rigs people import (a few hundred bones). The camera, renderer and DOM are
 *        stubs: nothing is drawn.
 */
import { describe, it } from "vitest";
import { Scene, Vector2, Vector3 } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { pickBone } from "@/features/rigging/boneHit";
import { BoneWorld } from "@/features/rigging/boneWorld";
import { chainAbove, solveChain } from "@/features/rigging/ikSolver";
import { restoreBatches } from "@/features/rigging/poseCommands";
import { RigOverlay } from "@/features/rigging/RigOverlay";
import { rigOf, type Rig } from "@/features/rigging/rig";
import { buildRiggedModel } from "@/features/rigging/rigFixture";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";
import { stubViewport } from "../../fixtures/viewport.fixtures";

const BONE_COUNTS = [25, 50, 100, 200, 400];

function rigWith(boneCount: number): Rig {
  const rig = rigOf(buildRiggedModel(boneCount));
  if (!rig) throw new Error("the fixture has bones");
  return rig;
}

describe("rig work on every frame", () => {
  it("finds the joints and redraws the overlay in time that follows the number of bones", async () => {
    const cases: BenchCase[] = BONE_COUNTS.flatMap((bones) => {
      const rig = rigWith(bones);
      const world = new BoneWorld(rig);
      const scene = new Scene();
      const { viewport, frame } = stubViewport(scene);
      const overlay = new RigOverlay(viewport, () => true);
      overlay.setRigs(new Map([["rig", rig]]));
      return [
        { name: "BoneWorld.update", params: { bones }, run: () => { world.update(); consume(world.positions[bones * 3 - 1] ?? 0); } },
        { name: "RigOverlay frame", params: { bones }, run: () => frame() },
      ];
    });
    const results = await measureCases(cases);
    finishWithGrowth("rigging/rig.frame", results, [
      { key: "bones", declared: 1, tolerance: 0.4, label: "BoneWorld.update", where: (result) => result.name === "BoneWorld.update" },
      { key: "bones", declared: 1, tolerance: 0.4, label: "RigOverlay frame", where: (result) => result.name === "RigOverlay frame" },
    ]);
  });

  it("picks the bone under a click in time that follows the number of bones", async () => {
    const view = stubViewport(new Scene()).viewport.camera;
    view.position.set(0, 1, 6);
    view.lookAt(0, 1, 0);
    view.updateMatrixWorld(true);
    const cases: BenchCase[] = BONE_COUNTS.flatMap((bones) => {
      const rig = rigWith(bones);
      const world = new BoneWorld(rig);
      world.update();
      return [
        { name: "pickBone (hit)", params: { bones }, run: () => consume(pickBone(rig, world.positions, view, new Vector2(0, -0.2), 800, 600) ?? -1) },
        { name: "pickBone (miss)", params: { bones }, run: () => consume(pickBone(rig, world.positions, view, new Vector2(0.95, 0.95), 800, 600) ?? -1) },
      ];
    });
    const results = await measureCases(cases);
    finishWithGrowth("rigging/rig.pick", results, [
      { key: "bones", declared: 1, tolerance: 0.4, label: "pickBone", where: () => true },
    ]);
  });
});

describe("pulling a joint", () => {
  it("bends a chain toward the pointer in time that follows the chain length", async () => {
    const rig = rigWith(400);
    // The deepest bone of the binary tree, so a chain of up to eight bones lies above it.
    const tip = rig.bones.length - 1;
    const effector = rig.bones[tip];
    if (!effector) throw new Error("the fixture has bones");
    const target = new Vector3();
    let step = 0;
    const cases: BenchCase[] = [1, 2, 4, 8].map((length) => {
      const chain = chainAbove(rig, tip, length);
      return {
        name: "solveChain",
        params: { chain: length },
        run: () => {
          step += 1;
          target.set(((step % 40) - 20) / 20, 3 + (step % 7) / 10, ((step % 13) - 6) / 10);
          consume(solveChain(effector, chain, target));
        },
      };
    });
    const results = await measureCases(cases);
    // Each bone turned moves everything below it, so a longer chain touches larger parts of the rig.
    finishWithGrowth("rigging/rig.ik", results, [{ key: "chain", declared: 1, tolerance: 0.8 }]);
  });
});

describe("posing", () => {
  it("poses one bone in time that does not depend on how many bones the rig has", async () => {
    const cases: BenchCase[] = BONE_COUNTS.map((bones) => {
      const editor = new EditorScene(new Scene(), "prj_bench");
      editor.importObject("rig", buildRiggedModel(bones));
      let turn = 0;
      return {
        name: "applyUserPose",
        params: { bones },
        run: () => {
          turn += 1;
          consume(editor.applyUserPose("rig", bones - 1, { position: [0, 0.5, 0], rotation: [0, 0, (turn % 100) / 100], scale: [1, 1, 1] }).applied ? 1 : 0);
        },
      };
    });
    const results = await measureCases(cases);
    finishWithGrowth("rigging/rig.pose", results, [{ key: "bones", declared: 0, tolerance: 0.4 }]);
  });

  it("plans putting a whole pose back in time that follows the number of bones", async () => {
    const cases: BenchCase[] = BONE_COUNTS.map((bones) => {
      const rig = rigWith(bones);
      for (const bone of rig.bones) bone.rotation.z = 0.3;
      return { name: "restoreBatches", params: { bones }, run: () => consume(restoreBatches("rig", rig).length) };
    });
    const results = await measureCases(cases);
    finishWithGrowth("rigging/rig.restore", results, [{ key: "bones", declared: 1, tolerance: 0.4 }]);
  });
});
