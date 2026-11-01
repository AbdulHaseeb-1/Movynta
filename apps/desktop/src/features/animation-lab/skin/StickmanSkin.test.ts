import { describe, expect, it } from "vitest";
import { MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { CharacterRig } from "@/engine/character/CharacterRig";
import { Pose } from "@/engine/character/Pose";
import { STICKMAN_CHARACTER_CONFIG } from "@/engine/character/SkeletonBuilder";
import { BONE_NAMES, createBoneMap, type BoneName } from "@/engine/character/types";
import { DEG, quatFromEuler } from "@/engine/core/math";
import { STROKE_RADIUS } from "./bodyPrimitives";
import { StickmanSkin } from "./StickmanSkin";

const config = STICKMAN_CHARACTER_CONFIG;

function createSkin(): StickmanSkin {
  const rig = new CharacterRig(config);
  const parents = createBoneMap((name) => rig.definitions[name].parent);
  return new StickmanSkin(config, new MeshStandardMaterial(), parents);
}

/** Poses a fresh rig with joint Euler angles in degrees and feeds it to the skin. */
function pose(skin: StickmanSkin, angles: Partial<Record<BoneName, readonly [number, number, number]>>): CharacterRig {
  const rig = new CharacterRig(config);
  const p = new Pose(rig.restPelvisPosition);
  for (const name of BONE_NAMES) {
    const euler = angles[name];
    if (euler) quatFromEuler(p.rotations[name], euler[0] * DEG, euler[1] * DEG, euler[2] * DEG);
  }
  rig.updateWorld(p);
  skin.update(rig.worldPosition, rig.worldRotation);
  return rig;
}

interface RingMeasure {
  /** Width of the joint ring in the bend plane, perpendicular to the bisector (the dimension skinning collapses). */
  readonly inPlane: number;
  /** Width along the bend axis (should stay at the stroke diameter). */
  readonly alongAxis: number;
}

/** Skins the vertices of the ring around a joint and measures how thick the limb stays there. */
function measureRing(skin: StickmanSkin, rig: CharacterRig, bones: { upper: BoneName; joint: BoneName; lower: BoneName }, withCorrectives: boolean): RingMeasure {
  const bind = skin.data.bindPose;
  const axisInBind = bind.positions[bones.lower].clone().sub(bind.positions[bones.upper]).normalize();
  const center = bind.positions[bones.joint];
  const points: Vector3[] = [];
  for (let i = 0; i < skin.data.positions.length / 3; i++) {
    const p = new Vector3(skin.data.positions[i * 3], skin.data.positions[i * 3 + 1], skin.data.positions[i * 3 + 2]).sub(center);
    const along = p.dot(axisInBind);
    const radial = p.clone().addScaledVector(axisInBind, -along).length();
    if (Math.abs(along) < 0.0075 && radial < 0.06) points.push(skin.skinnedVertex(i, new Vector3(), withCorrectives));
  }
  const upperDir = rig.worldPosition[bones.joint].clone().sub(rig.worldPosition[bones.upper]).normalize();
  const lowerDir = rig.worldPosition[bones.lower].clone().sub(rig.worldPosition[bones.joint]).normalize();
  const bisector = upperDir.clone().add(lowerDir).normalize();
  const bendAxis = upperDir.clone().cross(lowerDir).normalize();
  const inPlaneDirection = bisector.clone().cross(bendAxis).normalize();
  const extent = (direction: Vector3): number => {
    const values = points.map((p) => p.dot(direction));
    return Math.max(...values) - Math.min(...values);
  };
  return { inPlane: extent(inPlaneDirection), alongAxis: extent(bendAxis) };
}

const DIAMETER = 2 * STROKE_RADIUS;

describe("stickman skin at extreme bends", () => {
  const skin = createSkin();

  it.each([
    ["left elbow at 148 degrees", { forearm_l: [-148, 0, 0] }, { upper: "upper_arm_l", joint: "forearm_l", lower: "hand_l" }],
    ["right elbow at 148 degrees", { forearm_r: [-148, 0, 0] }, { upper: "upper_arm_r", joint: "forearm_r", lower: "hand_r" }],
    ["left knee at 140 degrees", { shin_l: [140, 0, 0] }, { upper: "thigh_l", joint: "shin_l", lower: "foot_l" }],
    ["right knee at 140 degrees", { shin_r: [140, 0, 0] }, { upper: "thigh_r", joint: "shin_r", lower: "foot_r" }],
  ] as const)("%s keeps its thickness only with the corrective", (_name, angles, bones) => {
    const rig = pose(skin, angles);
    const plain = measureRing(skin, rig, bones, false);
    const corrected = measureRing(skin, rig, bones, true);
    // Plain linear skinning collapses the ring in the bend plane...
    expect(plain.inPlane).toBeLessThan(DIAMETER * 0.5);
    // ...the corrective brings most of it back without ballooning past the stroke width...
    expect(corrected.inPlane).toBeGreaterThan(plain.inPlane + DIAMETER * 0.25);
    expect(corrected.inPlane).toBeGreaterThan(DIAMETER * 0.7);
    expect(corrected.inPlane).toBeLessThan(DIAMETER * 1.15);
    // ...and the direction that skinning keeps intact is not touched.
    expect(Math.abs(corrected.alongAxis - plain.alongAxis)).toBeLessThan(DIAMETER * 0.05);
    expect(corrected.alongAxis).toBeGreaterThan(DIAMETER * 0.85);
  });

  it("does not change a limb that is not bent", () => {
    pose(skin, {});
    let moved = 0;
    for (let i = 0; i < skin.data.positions.length / 3; i += 7) {
      const a = skin.skinnedVertex(i, new Vector3(), false);
      const b = skin.skinnedVertex(i, new Vector3(), true);
      if (a.distanceTo(b) > 0.004) moved++;
    }
    expect(moved).toBe(0);
  });

  it("never moves a vertex far from plain skinning, and keeps every vertex finite, at the joint limits", () => {
    pose(skin, {
      forearm_l: [-152, 0, 0],
      shin_r: [152, 0, 0],
      upper_arm_l: [-185, 0, 0],
      thigh_l: [-125, 0, 0],
      thigh_r: [56, 0, 0],
      spine_lower: [45, 0, 0],
    });
    let worst = 0;
    for (let i = 0; i < skin.data.positions.length / 3; i++) {
      const plain = skin.skinnedVertex(i, new Vector3(), false);
      const corrected = skin.skinnedVertex(i, new Vector3(), true);
      expect(Number.isFinite(corrected.x + corrected.y + corrected.z)).toBe(true);
      worst = Math.max(worst, plain.distanceTo(corrected));
    }
    expect(worst).toBeLessThanOrEqual(STROKE_RADIUS * 1.0);
  });

  it("tracks the simulated bones: the bone tree mirrors the rig's names and parents", () => {
    const rig = pose(skin, { thigh_l: [-40, 0, 0], shin_l: [60, 0, 0] });
    skin.mesh.updateMatrixWorld(true);
    for (const name of ["pelvis", "thigh_l", "shin_l", "foot_l", "hand_r", "head"] as const) {
      const bone = skin.bones[name];
      const world = new Vector3().setFromMatrixPosition(bone.matrixWorld);
      expect(world.distanceTo(rig.worldPosition[name])).toBeLessThan(1e-5);
      const worldRotation = new Quaternion().setFromRotationMatrix(bone.matrixWorld);
      expect(Math.abs(worldRotation.dot(rig.worldRotation[name]))).toBeGreaterThan(1 - 1e-6);
    }
    expect(skin.skeleton.bones.length).toBe(23);
  });
});
