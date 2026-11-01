import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { DEG, quatFromEuler } from "../core/math";
import { CharacterRig } from "./CharacterRig";
import { clampToLimits, isWithinLimits } from "./JointLimits";
import { Pose, UPPER_BODY_MASK, blendPoses } from "./Pose";
import { BONE_MASS, DEFAULT_PROPORTIONS, scaleProportions } from "./SkeletonBuilder";
import { BONE_NAMES, legBones, type BoneName } from "./types";

function restRig(): { rig: CharacterRig; pose: Pose } {
  const rig = new CharacterRig();
  const pose = new Pose(rig.restPelvisPosition);
  rig.updateWorld(pose);
  return { rig, pose };
}

describe("skeleton integrity", () => {
  it("contains every required joint exactly once", () => {
    const required: BoneName[] = [
      "root", "pelvis", "spine_lower", "spine_mid", "spine_upper", "neck", "head",
      "clavicle_l", "clavicle_r", "upper_arm_l", "upper_arm_r", "forearm_l", "forearm_r", "hand_l", "hand_r",
      "thigh_l", "thigh_r", "shin_l", "shin_r", "foot_l", "foot_r", "toe_l", "toe_r",
    ];
    expect([...BONE_NAMES].sort()).toEqual([...required].sort());
    expect(new Set(BONE_NAMES).size).toBe(BONE_NAMES.length);
  });

  it("has a single root and parents that always precede their children", () => {
    const { rig } = restRig();
    const roots = BONE_NAMES.filter((name) => rig.definitions[name].parent === null);
    expect(roots).toEqual(["root"]);
    BONE_NAMES.forEach((name, index) => {
      const parent = rig.definitions[name].parent;
      if (parent !== null) expect(BONE_NAMES.indexOf(parent)).toBeLessThan(index);
    });
  });

  it("wires the expected chains", () => {
    const { rig } = restRig();
    const parentOf = (name: BoneName) => rig.definitions[name].parent;
    expect(parentOf("pelvis")).toBe("root");
    expect(parentOf("spine_lower")).toBe("pelvis");
    expect(parentOf("head")).toBe("neck");
    expect(parentOf("clavicle_l")).toBe("spine_upper");
    expect(parentOf("hand_r")).toBe("forearm_r");
    for (const side of ["l", "r"] as const) {
      const leg = legBones(side);
      expect(parentOf(leg.thigh)).toBe("pelvis");
      expect(parentOf(leg.shin)).toBe(leg.thigh);
      expect(parentOf(leg.foot)).toBe(leg.shin);
      expect(parentOf(leg.toe)).toBe(leg.foot);
    }
  });

  it("stands on the ground with symmetric left and right sides", () => {
    const { rig } = restRig();
    const leg = legBones("l");
    const sole = rig.footPoint("l", "heel", new Vector3());
    expect(sole.y).toBeCloseTo(0, 6);
    expect(rig.worldPosition[leg.toe].y).toBeCloseTo(0, 6);
    for (const [l, r] of [["thigh_l", "thigh_r"], ["upper_arm_l", "upper_arm_r"], ["foot_l", "foot_r"]] as const) {
      expect(rig.worldPosition[l].x).toBeCloseTo(-rig.worldPosition[r].x, 9);
      expect(rig.worldPosition[l].y).toBeCloseTo(rig.worldPosition[r].y, 9);
    }
    expect(rig.worldPosition.thigh_l.x).toBeGreaterThan(0);
  });

  it("keeps bone lengths constant under any rotation", () => {
    const { rig, pose } = restRig();
    const before = new Map(BONE_NAMES.map((n) => [n, rig.boneLength(n)] as const));
    const measure = (name: BoneName): number => {
      const parent = rig.definitions[name].parent;
      return parent === null ? 0 : rig.worldPosition[name].distanceTo(rig.worldPosition[parent]);
    };
    const restLengths = new Map(BONE_NAMES.map((n) => [n, measure(n)] as const));
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 50; i++) {
      for (const name of BONE_NAMES) quatFromEuler(pose.rotations[name], rand() * 0.8, rand() * 0.5, rand() * 0.5);
      rig.updateWorld(pose);
      for (const name of BONE_NAMES) {
        if (name === "pelvis") continue;
        expect(measure(name)).toBeCloseTo(restLengths.get(name) ?? 0, 9);
      }
    }
    for (const name of BONE_NAMES) expect(rig.boneLength(name)).toBeCloseTo(before.get(name) ?? 0, 12);
  });

  it("moves descendants when a parent rotates", () => {
    const { rig, pose } = restRig();
    const handBefore = rig.worldPosition.hand_l.clone();
    quatFromEuler(pose.rotations.spine_lower, 30 * DEG, 0, 0);
    rig.updateWorld(pose);
    expect(rig.worldPosition.hand_l.distanceTo(handBefore)).toBeGreaterThan(0.05);
    expect(rig.worldPosition.thigh_l.distanceTo(new Vector3(0.09, rig.hipHeight, 0))).toBeLessThan(1e-9);
  });

  it("applies root heading to the whole body", () => {
    const { rig, pose } = restRig();
    rig.setRootTransform(new Vector3(3, 0, -2), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));
    rig.updateWorld(pose);
    // A +90 degree yaw sends +Z forward to +X, so the left side (+X) now faces -Z.
    const toe = rig.worldPosition.toe_l;
    const foot = rig.worldPosition.foot_l;
    expect(toe.x - foot.x).toBeCloseTo(rig.config.proportions.ballForward, 6);
    expect(rig.worldPosition.thigh_l.z).toBeCloseTo(-2 - 0.09, 6);
  });

  it("scales to other bodies without code changes", () => {
    const rig = new CharacterRig({ proportions: scaleProportions(DEFAULT_PROPORTIONS, 0.5), limbRadius: 0.02 });
    expect(rig.hipHeight).toBeCloseTo(0.5 * (0.44 + 0.43 + 0.08), 9);
  });

  it("uses mass fractions that sum to one", () => {
    expect(Object.values(BONE_MASS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("reports no issues for the rest pose and flags broken data", () => {
    const { rig, pose } = restRig();
    expect(rig.validate(pose)).toEqual([]);
    pose.rotations.head.set(Number.NaN, 0, 0, 1);
    expect(rig.validate(pose).some((i) => i.bone === "head")).toBe(true);
  });
});

describe("joint limits", () => {
  it("keeps the knee from hyperextending and allows flexion", () => {
    const q = new Quaternion();
    quatFromEuler(q, -30 * DEG, 0, 0);
    expect(isWithinLimits("shin_l", q)).toBe(false);
    expect(clampToLimits("shin_l", q)).toBe(true);
    expect(isWithinLimits("shin_l", q)).toBe(true);
    quatFromEuler(q, 100 * DEG, 0, 0);
    expect(isWithinLimits("shin_l", q)).toBe(true);
  });

  it("mirrors twist and abduction limits to the right side", () => {
    const q = new Quaternion();
    quatFromEuler(q, 0, 0, 40 * DEG);
    expect(isWithinLimits("thigh_l", q)).toBe(true);
    expect(isWithinLimits("thigh_r", q)).toBe(false);
    quatFromEuler(q, 0, 0, -40 * DEG);
    expect(isWithinLimits("thigh_r", q)).toBe(true);
  });

  it("clamping is idempotent and leaves a unit quaternion", () => {
    const q = new Quaternion();
    quatFromEuler(q, 3, 0.2, 0.2);
    clampToLimits("spine_mid", q);
    const once = q.clone();
    expect(clampToLimits("spine_mid", q)).toBe(false);
    expect(q.angleTo(once)).toBeLessThan(1e-6);
    expect(q.length()).toBeCloseTo(1, 9);
  });
});

describe("pose blending", () => {
  it("interpolates on the shortest arc without Euler wrap jumps", () => {
    const a = new Pose();
    const b = new Pose();
    quatFromEuler(a.rotations.spine_mid, 170 * DEG, 0, 0);
    // The same orientation reached through the opposite quaternion sign must blend identically.
    const sign = a.rotations.spine_mid;
    b.rotations.spine_mid.set(-sign.x, -sign.y, -sign.z, -sign.w);
    const out = new Pose();
    blendPoses(out, a, b, 0.5);
    expect(out.rotations.spine_mid.angleTo(a.rotations.spine_mid)).toBeLessThan(1e-6);
  });

  it("applies the mask so lower-body bones are untouched", () => {
    const a = new Pose();
    const b = new Pose();
    quatFromEuler(b.rotations.spine_lower, 0.5, 0, 0);
    quatFromEuler(b.rotations.thigh_l, -0.5, 0, 0);
    b.pelvisPosition.set(0, 2, 0);
    const out = new Pose();
    blendPoses(out, a, b, 1, UPPER_BODY_MASK);
    expect(out.rotations.spine_lower.angleTo(b.rotations.spine_lower)).toBeLessThan(1e-6);
    expect(out.rotations.thigh_l.angleTo(a.rotations.thigh_l)).toBeLessThan(1e-6);
    expect(out.pelvisPosition.y).toBe(0);
  });
});
