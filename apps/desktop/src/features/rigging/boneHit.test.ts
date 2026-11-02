import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector2, Vector3 } from "three";
import { BoneWorld } from "./boneWorld";
import { JOINT_RADIUS_PX, STICK_RADIUS_PX, pickBone } from "./boneHit";
import { rigOf, type Rig } from "./rig";
import { buildRiggedModel } from "./rigFixture";

const WIDTH = 800;
const HEIGHT = 600;

function camera(): PerspectiveCamera {
  const view = new PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 100);
  view.position.set(0, 1, 6);
  view.lookAt(0, 1, 0);
  view.updateMatrixWorld(true);
  return view;
}

function rigAndJoints(boneCount: number) {
  const model = buildRiggedModel(boneCount);
  const rig = rigOf(model);
  if (!rig) throw new Error("expected a rig");
  const world = new BoneWorld(rig);
  world.update();
  return { rig, joints: world.positions };
}

/** The point of the view, in normalized device coordinates, that a world point is drawn at. */
function ndcOf(view: PerspectiveCamera, x: number, y: number, z: number, dx = 0, dy = 0): Vector2 {
  const projected = new Vector3(x, y, z).project(view);
  return new Vector2(projected.x + (dx / WIDTH) * 2, projected.y - (dy / HEIGHT) * 2);
}

function jointAt(joints: Float64Array, bone: number): [number, number, number] {
  return [joints[bone * 3] ?? 0, joints[bone * 3 + 1] ?? 0, joints[bone * 3 + 2] ?? 0];
}

function pick(rig: Rig, joints: Float64Array, view: PerspectiveCamera, ndc: Vector2) {
  return pickBone(rig, joints, view, ndc, WIDTH, HEIGHT);
}

describe("picking a bone with a click", () => {
  it("picks the bone whose joint the click lands on", () => {
    const { rig, joints } = rigAndJoints(7);
    const view = camera();
    for (let bone = 0; bone < rig.bones.length; bone += 1)
      expect(pick(rig, joints, view, ndcOf(view, ...jointAt(joints, bone)))).toBe(bone);
  });

  it("still picks it a few pixels away, and nothing a long way off", () => {
    const { rig, joints } = rigAndJoints(7);
    const view = camera();
    const root = jointAt(joints, 0);
    expect(pick(rig, joints, view, ndcOf(view, ...root, JOINT_RADIUS_PX - 2, 0))).toBe(0);
    expect(pick(rig, joints, view, ndcOf(view, ...root, 0, -(WIDTH / 4)))).toBeUndefined();
  });

  it("picks the bone a stick hangs from when the click lands on the stick", () => {
    const { rig, joints } = rigAndJoints(3);
    const view = camera();
    // Bone 1 hangs from bone 0, so the stick between them belongs to bone 0.
    const [ax, ay, az] = jointAt(joints, 0);
    const [bx, by, bz] = jointAt(joints, 1);
    const middle = ndcOf(view, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    expect(pick(rig, joints, view, middle)).toBe(0);
  });

  it("prefers a joint to the stick that runs into it, so the dots are easy to hit", () => {
    const { rig, joints } = rigAndJoints(3);
    const view = camera();
    // Just off bone 1's joint, along its stick: both are within reach, and the joint wins.
    const [ax, ay, az] = jointAt(joints, 0);
    const [bx, by, bz] = jointAt(joints, 1);
    const near = ndcOf(view, bx + (ax - bx) * 0.02, by + (ay - by) * 0.02, bz + (az - bz) * 0.02);
    expect(pick(rig, joints, view, near)).toBe(1);
    expect(STICK_RADIUS_PX).toBeLessThanOrEqual(JOINT_RADIUS_PX);
  });

  it("ignores bones behind the camera", () => {
    const { rig, joints } = rigAndJoints(3);
    const view = camera();
    view.position.set(0, 1, -6);
    view.lookAt(0, 1, -20);
    view.updateMatrixWorld(true);
    expect(pick(rig, joints, view, new Vector2(0, 0))).toBeUndefined();
  });

  it("copes with rigs of different sizes one after another", () => {
    const view = camera();
    const small = rigAndJoints(3);
    const large = rigAndJoints(40);
    expect(pick(large.rig, large.joints, view, ndcOf(view, ...jointAt(large.joints, 39)))).toBe(39);
    expect(pick(small.rig, small.joints, view, ndcOf(view, ...jointAt(small.joints, 2)))).toBe(2);
  });
});
