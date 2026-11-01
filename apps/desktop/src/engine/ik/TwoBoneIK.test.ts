import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CharacterRig } from "../character/CharacterRig";
import { Pose } from "../character/Pose";
import { legBones } from "../character/types";
import { DEG, eulerFromQuat } from "../core/math";
import { createLegTarget, solveLegs, type LegSolveReport } from "./LegIK";
import { createTwoBoneSolution, solveTwoBone } from "./TwoBoneIK";

describe("solveTwoBone", () => {
  it("reaches any target inside the leg's range exactly", () => {
    const out = createTwoBoneSolution();
    const hip = new Vector3(0.1, 1, 0);
    for (const target of [new Vector3(0.1, 0.2, 0.3), new Vector3(0.1, 0.5, -0.4), new Vector3(0.3, 0.3, 0.2), new Vector3(0.1, 0.14, 0)]) {
      solveTwoBone(hip, target, 0.44, 0.43, new Vector3(0, 0, 1), out);
      expect(out.ankle.distanceTo(target)).toBeLessThan(1e-9);
      expect(out.knee.distanceTo(hip)).toBeCloseTo(0.44, 9);
      expect(out.knee.distanceTo(out.ankle)).toBeCloseTo(0.43, 9);
    }
  });

  it("pulls unreachable targets in without producing NaN", () => {
    const out = createTwoBoneSolution();
    solveTwoBone(new Vector3(0, 1, 0), new Vector3(0, -5, 0), 0.44, 0.43, new Vector3(0, 0, 1), out);
    expect(Number.isFinite(out.knee.x + out.knee.y + out.knee.z)).toBe(true);
    expect(out.reachRatio).toBeGreaterThan(1);
    expect(out.ankle.distanceTo(new Vector3(0, 1, 0))).toBeLessThanOrEqual(0.87);
  });

  it("copes with a target directly on the hip and a bulge parallel to the leg", () => {
    const out = createTwoBoneSolution();
    solveTwoBone(new Vector3(), new Vector3(), 0.44, 0.43, new Vector3(0, 1, 0), out);
    expect(Number.isFinite(out.thighRotation.x + out.shinRotation.w)).toBe(true);
    solveTwoBone(new Vector3(), new Vector3(0, -0.6, 0), 0.44, 0.43, new Vector3(0, -1, 0), out);
    expect(Number.isFinite(out.thighRotation.x + out.shinRotation.w)).toBe(true);
  });
});

describe("solveLegs on the rig", () => {
  it("hits the foot targets and bends the knee only forward as a pure hinge", () => {
    const rig = new CharacterRig();
    const pose = new Pose(rig.restPelvisPosition);
    pose.pelvisPosition.y -= 0.12;
    const targets = { l: createLegTarget(), r: createLegTarget() };
    const reports: Record<"l" | "r", LegSolveReport> = {
      l: { reachRatio: 0, kneeAngle: 0, ankleError: 0 },
      r: { reachRatio: 0, kneeAngle: 0, ankleError: 0 },
    };
    const euler = new Vector3();
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      for (const [side, sign] of [["l", 1], ["r", -1]] as const) {
        const t = targets[side];
        t.ankle.set(sign * 0.1 + (rand() - 0.5) * 0.3, 0.08 + rand() * 0.35, (rand() - 0.5) * 0.7);
        t.footRotation.setFromAxisAngle(new Vector3(0, 1, 0), (rand() - 0.5) * 0.6);
        t.kneeDirection.set((rand() - 0.5) * 0.3, 0, 1).normalize();
      }
      solveLegs(rig, pose, targets, reports);
      for (const side of ["l", "r"] as const) {
        expect(reports[side].ankleError).toBeLessThan(1e-6);
        const shin = eulerFromQuat(pose.rotations[legBones(side).shin], euler);
        expect(shin.x).toBeGreaterThanOrEqual(-1e-6);
        expect(Math.abs(shin.y)).toBeLessThan(1e-3);
        expect(Math.abs(shin.z)).toBeLessThan(1e-3);
        expect(rig.worldPosition[legBones(side).foot].distanceTo(targets[side].ankle)).toBeLessThan(1e-6);
        expect(rig.worldRotation[legBones(side).foot].angleTo(targets[side].footRotation)).toBeLessThan(1e-3);
      }
    }
    expect(DEG).toBeGreaterThan(0);
    expect(new Quaternion().length()).toBe(1);
  });
});
