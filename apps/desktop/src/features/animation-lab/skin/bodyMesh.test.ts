import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { STICKMAN_CHARACTER_CONFIG } from "@/engine/character/SkeletonBuilder";
import { BONE_NAMES } from "@/engine/character/types";
import { buildBodyMeshData } from "./bodyMesh";
import { STROKE_RADIUS } from "./bodyPrimitives";
import { boneIndex, MAX_INFLUENCES } from "./skinWeights";
import { bulgeFor } from "./jointCorrectives";

const config = STICKMAN_CHARACTER_CONFIG;
const started = performance.now();
const data = buildBodyMeshData(config);
const buildMilliseconds = performance.now() - started;
const vertexCount = data.positions.length / 3;
const triangleCount = data.indices.length / 3;

function vertex(i: number): Vector3 {
  return new Vector3(data.positions[i * 3], data.positions[i * 3 + 1], data.positions[i * 3 + 2]);
}

function weightsOf(i: number): Map<string, number> {
  const result = new Map<string, number>();
  for (let slot = 0; slot < MAX_INFLUENCES; slot++) {
    const bone = BONE_NAMES[data.skinIndices[i * MAX_INFLUENCES + slot] ?? 0];
    const weight = data.skinWeights[i * MAX_INFLUENCES + slot] ?? 0;
    if (bone && weight > 0) result.set(bone, (result.get(bone) ?? 0) + weight);
  }
  return result;
}

describe("stickman skinned body geometry", () => {
  it("is a reasonably sized, finite mesh built quickly", () => {
    expect(vertexCount).toBeGreaterThan(5_000);
    expect(triangleCount).toBeLessThan(120_000);
    expect(Array.from(data.positions).every(Number.isFinite)).toBe(true);
    expect(Array.from(data.normals).every(Number.isFinite)).toBe(true);
    // One-time cost at load; the lab caches it per character config.
    expect(buildMilliseconds).toBeLessThan(5_000);
  });

  it("is one closed surface: every edge is shared by exactly two triangles", () => {
    const counts = new Map<number, number>();
    for (let f = 0; f < data.indices.length; f += 3) {
      for (let e = 0; e < 3; e++) {
        const a = data.indices[f + e] ?? 0;
        const b = data.indices[f + ((e + 1) % 3)] ?? 0;
        const key = Math.min(a, b) * vertexCount + Math.max(a, b);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const bad = Array.from(counts.values()).filter((n) => n !== 2).length;
    expect(bad).toBe(0);
  });

  it("is a single connected piece (no floating fragments or gaps at joints)", () => {
    const parent = Array.from({ length: vertexCount }, (_, i) => i);
    const find = (x: number): number => {
      let root = x;
      while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
      return root;
    };
    for (let f = 0; f < data.indices.length; f += 3) {
      const a = find(data.indices[f] ?? 0);
      const b = find(data.indices[f + 1] ?? 0);
      const c = find(data.indices[f + 2] ?? 0);
      parent[b] = a;
      parent[c] = a;
    }
    const roots = new Set(Array.from({ length: vertexCount }, (_, i) => find(i)));
    expect(roots.size).toBe(1);
  });

  it("winds triangles outward and has unit normals", () => {
    let outward = 0;
    for (let f = 0; f < data.indices.length; f += 3) {
      const a = vertex(data.indices[f] ?? 0);
      const b = vertex(data.indices[f + 1] ?? 0);
      const c = vertex(data.indices[f + 2] ?? 0);
      const face = b.clone().sub(a).cross(c.clone().sub(a));
      const n = new Vector3(data.normals[(data.indices[f] ?? 0) * 3], data.normals[(data.indices[f] ?? 0) * 3 + 1], data.normals[(data.indices[f] ?? 0) * 3 + 2]);
      if (face.dot(n) > 0) outward++;
    }
    expect(outward / triangleCount).toBeGreaterThan(0.999);
    for (let i = 0; i < vertexCount; i += 97) {
      const n = new Vector3(data.normals[i * 3], data.normals[i * 3 + 1], data.normals[i * 3 + 2]);
      expect(n.length()).toBeCloseTo(1, 3);
    }
  });

  it("keeps the limb thickness of the original figure", () => {
    const upperArm = data.primitives.find((p) => p.name === "upper_arm-forearm_l");
    expect(upperArm).toBeDefined();
    if (!upperArm) return;
    const middle = upperArm.a.clone().lerp(upperArm.b, 0.5);
    const axis = upperArm.b.clone().sub(upperArm.a).normalize();
    // Surface vertices near the middle of the upper arm, measured by distance from its axis.
    const radii: number[] = [];
    for (let i = 0; i < vertexCount; i++) {
      const p = vertex(i).sub(middle);
      if (Math.abs(p.dot(axis)) < 0.01) {
        const radial = p.clone().addScaledVector(axis, -p.dot(axis)).length();
        if (radial < 0.056) radii.push(radial);
      }
    }
    expect(radii.length).toBeGreaterThan(20);
    for (const r of radii) expect(Math.abs(r - STROKE_RADIUS)).toBeLessThan(0.0035);
  });

  it("keeps the head a sphere of the configured radius", () => {
    const head = data.primitives.find((p) => p.name === "head");
    expect(head).toBeDefined();
    if (!head) return;
    const above = Array.from({ length: vertexCount }, (_, i) => vertex(i)).filter((p) => p.y > head.a.y);
    for (const p of above) expect(Math.abs(p.distanceTo(head.a) - head.radius)).toBeLessThan(0.004);
  });
});

describe("skin weights", () => {
  it("are normalized, non-negative and use at most four bones per vertex", () => {
    for (let i = 0; i < vertexCount; i++) {
      let sum = 0;
      for (let slot = 0; slot < MAX_INFLUENCES; slot++) {
        const weight = data.skinWeights[i * MAX_INFLUENCES + slot] ?? 0;
        expect(weight).toBeGreaterThanOrEqual(0);
        sum += weight;
        expect(data.skinIndices[i * MAX_INFLUENCES + slot] ?? 0).toBeLessThan(BONE_NAMES.length);
      }
      expect(Math.abs(sum - 1)).toBeLessThan(1e-4);
    }
  });

  // Rings of surface vertices at the joint plane must be split between the two bones, not owned by one of them.
  const jointBlend = (parentBone: "upper_arm_l" | "thigh_l" | "forearm_l" | "shin_l", childBone: "forearm_l" | "shin_l" | "hand_l" | "foot_l") => {
    const center = data.bindPose.positions[childBone];
    const axis = data.bindPose.positions[childBone].clone().sub(data.bindPose.positions[parentBone]).normalize();
    let count = 0;
    let mixed = 0;
    for (let i = 0; i < vertexCount; i++) {
      const p = vertex(i).sub(center);
      const along = p.dot(axis);
      const radial = p.clone().addScaledVector(axis, -along).length();
      if (Math.abs(along) < 0.0075 && radial < 0.06) {
        count++;
        const w = weightsOf(i);
        const a = w.get(parentBone) ?? 0;
        const b = w.get(childBone) ?? 0;
        if (a > 0.25 && b > 0.25) mixed++;
      }
    }
    return { count, share: mixed / Math.max(count, 1) };
  };

  it.each([
    ["elbow", "upper_arm_l", "forearm_l"],
    ["wrist", "forearm_l", "hand_l"],
    ["knee", "thigh_l", "shin_l"],
    ["ankle", "shin_l", "foot_l"],
  ] as const)("split the %s ring between the two bones", (_name, parentBone, childBone) => {
    const { count, share } = jointBlend(parentBone, childBone);
    expect(count).toBeGreaterThan(10);
    expect(share).toBeGreaterThan(0.9);
  });

  it("let the head and the middle of the shin follow a single bone", () => {
    const head = data.primitives.find((p) => p.name === "head");
    const shin = data.primitives.find((p) => p.name === "shin-foot_l");
    if (!head || !shin) throw new Error("primitives missing");
    const headWeight = Math.max(...Array.from({ length: vertexCount }, (_, i) => (vertex(i).distanceTo(head.a) < head.radius * 1.02 && vertex(i).y > head.a.y + 0.05 ? (weightsOf(i).get("head") ?? 0) : 0)));
    expect(headWeight).toBeGreaterThan(0.99);
    const middle = shin.a.clone().lerp(shin.b, 0.5);
    const near = Array.from({ length: vertexCount }, (_, i) => i).filter((i) => Math.abs(vertex(i).y - middle.y) < 0.01 && vertex(i).x > 0 === middle.x > 0 && vertex(i).distanceTo(middle) < 0.07);
    expect(near.length).toBeGreaterThan(5);
    for (const i of near) expect(weightsOf(i).get("shin_l") ?? 0).toBeGreaterThan(0.99);
  });

  it("keep the two sides mirrored", () => {
    const pairs = [
      ["upper_arm_l", "upper_arm_r"],
      ["forearm_l", "forearm_r"],
      ["thigh_l", "thigh_r"],
      ["shin_l", "shin_r"],
    ] as const;
    for (const [leftBone, rightBone] of pairs) {
      const left = boneIndex(leftBone);
      const right = boneIndex(rightBone);
      let l = 0;
      let r = 0;
      for (let i = 0; i < vertexCount; i++) {
        for (let slot = 0; slot < MAX_INFLUENCES; slot++) {
          const index = data.skinIndices[i * MAX_INFLUENCES + slot];
          const w = data.skinWeights[i * MAX_INFLUENCES + slot] ?? 0;
          if (index === left) l += w;
          if (index === right) r += w;
        }
      }
      expect(Math.abs(l - r) / Math.max(l, r)).toBeLessThan(0.03);
    }
  });
});

describe("joint correctives", () => {
  it("grow with the bend and stop growing at the cap", () => {
    expect(bulgeFor(0)).toBe(0);
    expect(bulgeFor(1)).toBeGreaterThan(bulgeFor(0.5));
    expect(bulgeFor(2)).toBeGreaterThan(bulgeFor(1));
    expect(bulgeFor(3.1)).toBeCloseTo(bulgeFor(2.6), 6);
    expect(bulgeFor(3.1)).toBeLessThanOrEqual(STROKE_RADIUS * 1.0);
  });

  it("mark only vertices near the elbows, knees, shoulders and hips", () => {
    let marked = 0;
    for (let i = 0; i < vertexCount; i++) if ((data.jointInfluence[i * 2 + 1] ?? 0) > 0.05) marked++;
    expect(marked).toBeGreaterThan(300);
    expect(marked / vertexCount).toBeLessThan(0.45);
  });
});
