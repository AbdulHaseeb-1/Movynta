import { describe, expect, it } from "vitest";
import { Bone, Group, Vector3 } from "three";
import { chainAbove, solveChain } from "./ikSolver";
import { rigOf, type Rig } from "./rig";

/** A straight arm: four bones, each one unit above the one before it, so the joints are at y = 0, 1, 2 and 3. */
function arm(): { model: Group; bones: Bone[]; rig: Rig } {
  const model = new Group();
  const bones: Bone[] = [];
  for (let index = 0; index < 4; index += 1) {
    const bone = new Bone();
    bone.position.y = index === 0 ? 0 : 1;
    bones[index - 1]?.add(bone);
    bones.push(bone);
  }
  const first = bones[0];
  if (first) model.add(first);
  model.updateMatrixWorld(true);
  const rig = rigOf(model);
  if (!rig) throw new Error("expected a rig");
  return { model, bones, rig };
}

function joint(bone: Bone | undefined): Vector3 {
  if (!bone) throw new Error("expected a bone");
  return bone.getWorldPosition(new Vector3());
}

describe("the bones that bend with a joint", () => {
  it("are the ones above it, nearest first, as many as the chain length allows", () => {
    const { bones, rig } = arm();
    expect(chainAbove(rig, 3, 2)).toEqual([bones[2], bones[1]]);
    expect(chainAbove(rig, 3, 8)).toEqual([bones[2], bones[1], bones[0]]);
    expect(chainAbove(rig, 1, 5)).toEqual([bones[0]]);
  });

  it("are none for a joint dragged alone, or at the top of its hierarchy", () => {
    const { rig } = arm();
    expect(chainAbove(rig, 3, 0)).toEqual([]);
    expect(chainAbove(rig, 0, 4)).toEqual([]);
  });
});

describe("pulling a joint", () => {
  it("brings the joint to a target within reach, bending the bones above it", () => {
    const { bones } = arm();
    const [, b1, b2, tip] = bones;
    if (!b1 || !b2 || !tip) throw new Error("expected bones");
    const target = new Vector3(1.2, 1.5, 0.4);
    const remaining = solveChain(tip, [b2, b1], target);
    expect(remaining).toBeLessThan(1e-3);
    expect(joint(tip).distanceTo(target)).toBeLessThan(1e-3);
  });

  it("keeps the bones the length they were, and the top of the chain where it was", () => {
    const { bones } = arm();
    const [root, b1, b2, tip] = bones;
    if (!root || !b1 || !b2 || !tip) throw new Error("expected bones");
    const anchor = joint(b1);
    solveChain(tip, [b2, b1], new Vector3(-0.8, 1.6, 1));
    expect(joint(b1).distanceTo(anchor)).toBeLessThan(1e-9);
    expect(joint(b1).distanceTo(joint(b2))).toBeCloseTo(1, 6);
    expect(joint(b2).distanceTo(joint(tip))).toBeCloseTo(1, 6);
    // The bone below the chain is not touched at all.
    expect(root.quaternion.angleTo(root.quaternion.clone().identity())).toBe(0);
  });

  it("stretches the chain straight toward a target out of reach, without losing its length", () => {
    const { bones } = arm();
    const [, b1, b2, tip] = bones;
    if (!b1 || !b2 || !tip) throw new Error("expected bones");
    const target = new Vector3(10, 1, 0);
    const before = joint(tip).distanceTo(target);
    const remaining = solveChain(tip, [b2, b1], target);
    expect(remaining).toBeLessThan(before);
    expect(Number.isFinite(remaining)).toBe(true);
    // Two bones above the tip reach two units from the joint at y = 1.
    expect(joint(tip).distanceTo(joint(b1))).toBeCloseTo(2, 5);
    expect(joint(tip).y).toBeCloseTo(1, 3);
  });

  it("works when the model is moved, turned and scaled, as the target is in the world", () => {
    const { model, bones } = arm();
    const [, b1, b2, tip] = bones;
    if (!b1 || !b2 || !tip) throw new Error("expected bones");
    model.position.set(4, -1, 2);
    model.rotation.set(0.4, 1.2, -0.3);
    model.scale.setScalar(1.5);
    model.updateMatrixWorld(true);
    const target = joint(b1).add(new Vector3(0.9, 0.4, -0.7));
    solveChain(tip, [b2, b1], target);
    expect(joint(tip).distanceTo(target)).toBeLessThan(1e-3);
  });

  it("does nothing with no bones to bend, or when the joint is already there", () => {
    const { bones } = arm();
    const [, b1, b2, tip] = bones;
    if (!b1 || !b2 || !tip) throw new Error("expected bones");
    const start = joint(tip);
    expect(solveChain(tip, [], new Vector3(3, 3, 3))).toBeCloseTo(start.distanceTo(new Vector3(3, 3, 3)), 9);
    expect(joint(tip).distanceTo(start)).toBe(0);
    solveChain(tip, [b2, b1], start);
    expect(joint(tip).distanceTo(start)).toBeLessThan(1e-9);
    expect(b2.quaternion.angleTo(b2.quaternion.clone().identity())).toBeLessThan(1e-9);
  });

  it("copes with a target on the joint of a bone in the chain", () => {
    const { bones } = arm();
    const [, b1, b2, tip] = bones;
    if (!b1 || !b2 || !tip) throw new Error("expected bones");
    const remaining = solveChain(tip, [b2, b1], joint(b2));
    expect(Number.isFinite(remaining)).toBe(true);
    for (const bone of [b1, b2, tip]) expect(Number.isFinite(bone.quaternion.length())).toBe(true);
  });
});
