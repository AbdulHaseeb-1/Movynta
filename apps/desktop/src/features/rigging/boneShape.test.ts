import { describe, expect, it } from "vitest";
import { SEGMENT_FLOATS, SEGMENT_VERTICES, writeBoneSegment } from "./boneShape";

/** Joints as the shape writer reads them: x, y, z for each bone. */
function joints(...points: [number, number, number][]): Float64Array {
  return Float64Array.from(points.flat());
}

function vertices(out: Float32Array): [number, number, number][] {
  const list: [number, number, number][] = [];
  for (let at = 0; at < out.length; at += 3) list.push([out[at] ?? 0, out[at + 1] ?? 0, out[at + 2] ?? 0]);
  return list;
}

function draw(head: [number, number, number], tail: [number, number, number]) {
  const out = new Float32Array(SEGMENT_FLOATS);
  writeBoneSegment(out, 0, joints(head, tail), 0, 1);
  return vertices(out);
}

describe("the shape of a bone", () => {
  it("is twelve edges of an octahedron from the head joint to the tail joint", () => {
    const shape = draw([0, 0, 0], [0, 2, 0]);
    expect(shape).toHaveLength(SEGMENT_VERTICES);
    // Each of the four sides is three edges: head to corner, corner to tail, corner to the next corner.
    for (let side = 0; side < 4; side += 1) {
      expect(shape[side * 6]).toEqual([0, 0, 0]);
      expect(shape[side * 6 + 3]).toEqual([0, 2, 0]);
      expect(shape[side * 6 + 1]).toEqual(shape[side * 6 + 2]);
      expect(shape[side * 6 + 1]).toEqual(shape[side * 6 + 4]);
    }
  });

  it("has its waist a tenth of the way along, a tenth of the length wide", () => {
    const shape = draw([1, 1, 1], [1, 11, 1]);
    for (let side = 0; side < 4; side += 1) {
      const corner = shape[side * 6 + 1] ?? [0, 0, 0];
      expect(corner[1]).toBeCloseTo(2, 5);
      expect(Math.hypot(corner[0] - 1, corner[2] - 1)).toBeCloseTo(1, 5);
    }
  });

  it("is a closed ring: the four corners are one quarter turn apart", () => {
    const shape = draw([0, 0, 0], [3, 4, 0]);
    const corners: [number, number, number][] = [0, 1, 2, 3].map((side) => shape[side * 6 + 1] ?? [0, 0, 0]);
    const center = corners.reduce<[number, number, number]>(
      (sum, c) => [sum[0] + c[0] / 4, sum[1] + c[1] / 4, sum[2] + c[2] / 4],
      [0, 0, 0],
    );
    const radii = corners.map((c) => Math.hypot(c[0] - center[0], c[1] - center[1], c[2] - center[2]));
    for (const radius of radii) expect(radius).toBeCloseTo(0.5, 5);
    const first = corners[0] ?? [0, 0, 0];
    const second = corners[1] ?? [0, 0, 0];
    const dot = (first[0] - center[0]) * (second[0] - center[0]) + (first[1] - center[1]) * (second[1] - center[1]) + (first[2] - center[2]) * (second[2] - center[2]);
    expect(dot).toBeCloseTo(0, 5);
  });

  it("never produces a number that is not finite, whichever way the bone points", () => {
    const directions: [number, number, number][] = [
      [0, 1, 0],
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, -1],
      [0.01, 1, 0.01],
      [1, 1, 1],
    ];
    for (const direction of directions)
      for (const value of draw([5, 5, 5], [5 + direction[0], 5 + direction[1], 5 + direction[2]]).flat())
        expect(Number.isFinite(value)).toBe(true);
  });

  it("collapses to a point for a bone with no length, so the buffer stays valid", () => {
    const shape = draw([2, 3, 4], [2, 3, 4]);
    for (const vertex of shape) expect(vertex).toEqual([2, 3, 4]);
  });

  it("writes at the offset it is given and leaves the rest alone", () => {
    const out = new Float32Array(SEGMENT_FLOATS * 2).fill(-7);
    writeBoneSegment(out, SEGMENT_FLOATS, joints([0, 0, 0], [0, 1, 0]), 0, 1);
    expect(out.slice(0, SEGMENT_FLOATS).every((value) => value === -7)).toBe(true);
    expect(out.slice(SEGMENT_FLOATS).every((value) => Number.isFinite(value) && value !== -7)).toBe(true);
  });
});
