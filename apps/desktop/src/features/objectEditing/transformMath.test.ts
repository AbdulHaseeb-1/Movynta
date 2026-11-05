import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { composeTrs, decomposeTrs, hasCollapsedAxis, invertAffine, isExactTrs, multiplyMat4, type Mat4, type Trs, type Vec3 } from "@movynta/editor-protocol";
import { assignLocalMatrix } from "./shearFit";
import { fieldCommitValue, rotationSign } from "./transformMath";
import { PerspectiveCamera } from "three";

/** A small seeded generator, so a failing case can be reproduced. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const between = (next: () => number, low: number, high: number) => low + (high - low) * next();

function randomTrs(next: () => number, scale: "uniform" | "free" | "unit"): Trs {
  const s = between(next, 0.3, 3);
  const scaleValue: Vec3 = scale === "unit" ? [1, 1, 1] : scale === "uniform" ? [s, s, s] : [between(next, 0.3, 3), between(next, 0.3, 3), between(next, 0.3, 3)];
  return {
    position: [between(next, -20, 20), between(next, -20, 20), between(next, -20, 20)],
    rotation: [between(next, -3, 3), between(next, -1.5, 1.5), between(next, -3, 3)],
    scale: scaleValue,
  };
}

function toThree(trs: Trs): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...trs.position),
    new Quaternion().setFromEuler(new Euler(trs.rotation[0], trs.rotation[1], trs.rotation[2], "XYZ")),
    new Vector3(...trs.scale),
  );
}
const asThree = (m: Mat4): Matrix4 => new Matrix4().fromArray([...m]);
function expectClose(actual: readonly number[], expected: readonly number[], tolerance = 1e-9) {
  expect(actual).toHaveLength(16);
  actual.forEach((value, index) => expect(Math.abs(value - (expected[index] ?? NaN))).toBeLessThan(tolerance));
}

describe("transform maths agrees with three.js", () => {
  it("composes position, rotation and scale into the same matrix", () => {
    const next = random(1);
    for (let i = 0; i < 300; i += 1) {
      const trs = randomTrs(next, "free");
      expectClose(composeTrs(trs), toThree(trs).elements);
    }
  });

  it("multiplies in the same order", () => {
    const next = random(2);
    for (let i = 0; i < 200; i += 1) {
      const a = randomTrs(next, "free");
      const b = randomTrs(next, "free");
      expectClose(multiplyMat4(composeTrs(a), composeTrs(b)), new Matrix4().multiplyMatrices(toThree(a), toThree(b)).elements, 1e-8);
    }
  });

  it("inverts, and refuses a scale that has collapsed", () => {
    const next = random(3);
    for (let i = 0; i < 200; i += 1) {
      const trs = randomTrs(next, "free");
      const inverse = invertAffine(composeTrs(trs));
      expect(inverse).toBeDefined();
      expectClose(inverse ?? [], toThree(trs).invert().elements, 1e-8);
      expectClose(multiplyMat4(composeTrs(trs), inverse ?? []), new Matrix4().elements, 1e-8);
    }
    expect(invertAffine(composeTrs({ position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 0, 1] }))).toBeUndefined();
  });

  it("splits a position, rotation and scale matrix back into the same matrix, mirrored and gimbal cases included", () => {
    const next = random(4);
    const cases: Trs[] = [
      { position: [1, 2, 3], rotation: [0.3, Math.PI / 2, 0.2], scale: [1, 2, 3] },
      { position: [0, 0, 0], rotation: [0.5, -Math.PI / 2, 1], scale: [2, 2, 2] },
      { position: [4, 5, 6], rotation: [0.1, 0.2, 0.3], scale: [-1, 2, 1] },
      { position: [4, 5, 6], rotation: [0.1, 0.2, 0.3], scale: [1, -2, 1] },
      ...Array.from({ length: 300 }, () => randomTrs(next, "free")),
    ];
    for (const trs of cases) {
      const matrix = composeTrs(trs);
      expectClose(composeTrs(decomposeTrs(matrix)), matrix, 1e-8);
      const three = { position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3() };
      asThree(matrix).decompose(three.position, three.quaternion, three.scale);
      expect(decomposeTrs(matrix).position).toEqual(three.position.toArray());
      decomposeTrs(matrix).scale.forEach((value, index) => expect(value).toBeCloseTo(three.scale.toArray()[index] ?? NaN, 9));
    }
  });
});

/** What the editor does today with a world-preserving move: store the matrix, or find it sheared. */
function editorShears(local: Mat4): boolean {
  const object = new Object3D();
  assignLocalMatrix(object, asThree(local), false);
  return !object.matrixAutoUpdate;
}

describe("isExactTrs agrees with the editor's own shear test", () => {
  it("accepts a move under a parent scaled the same on every axis, whatever the rotation", () => {
    const next = random(5);
    for (let i = 0; i < 500; i += 1) {
      const parent = composeTrs(randomTrs(next, "uniform"));
      const child = composeTrs(randomTrs(next, "free"));
      const local = multiplyMat4(invertAffine(parent) ?? [], child);
      expect(isExactTrs(local)).toBe(true);
      expect(editorShears(local)).toBe(false);
    }
  });

  it("decides like the editor under parents scaled differently on different axes", () => {
    const next = random(6);
    let sheared = 0;
    let stored = 0;
    for (let i = 0; i < 2000; i += 1) {
      const aligned = next() < 0.3;
      const parentTrs = randomTrs(next, "free");
      // An aligned child is turned like its parent, so nothing is sheared; the others are turned freely.
      const childTrs = aligned ? { ...randomTrs(next, "free"), rotation: parentTrs.rotation } : randomTrs(next, "free");
      const local = multiplyMat4(invertAffine(composeTrs(parentTrs)) ?? [], composeTrs(childTrs));
      const exact = isExactTrs(local);
      expect(exact).toBe(!editorShears(local));
      if (exact) stored += 1;
      else sheared += 1;
    }
    // The comparison means something only if both outcomes were really tried.
    expect(sheared).toBeGreaterThan(500);
    expect(stored).toBeGreaterThan(300);
  });

  it("treats a matrix with no length on an axis as not storable, because the editor would flatten the mesh", () => {
    const flat = composeTrs({ position: [0, 0, 0], rotation: [0.4, 0.2, 0.1], scale: [1, 0, 1] });
    expect(hasCollapsedAxis(flat)).toBe(true);
    expect(isExactTrs(flat)).toBe(false);
    expect(editorShears(flat)).toBe(true);
    expect(hasCollapsedAxis(composeTrs({ position: [0, 0, 0], rotation: [0.4, 0.2, 0.1], scale: [1, 0.01, 1] }))).toBe(false);
  });
});

describe("rotationSign", () => {
  const cameraAt = (z: number) => {
    const camera = new PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, z);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    return camera;
  };
  const screen = (point: Vector3, camera: PerspectiveCamera) => point.clone().project(camera);

  it.each([5, -5])("turns the object the way a clockwise pointer drag goes on screen, with the camera at z=%d", (z) => {
    const camera = cameraAt(z);
    const axis = new Vector3(0, 0, 1);
    // A point to the right of the pivot on screen, then a pointer dragged clockwise (right to below).
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const start = { x: 1, y: 0 };
    const current = { x: 0, y: 1 }; // screen y grows downward
    const angle = -Math.atan2(start.x * current.y - start.y * current.x, start.x * current.x + start.y * current.y) * rotationSign(axis, camera);
    const turned = right.clone().applyAxisAngle(axis, angle);
    expect(screen(turned, camera).y).toBeLessThan(screen(right, camera).y - 0.1); // NDC y falls as the point goes down
  });

  it("is 1 for an axis toward the viewer and -1 for one pointing away", () => {
    expect(rotationSign(new Vector3(0, 0, 1), cameraAt(5))).toBe(1);
    expect(rotationSign(new Vector3(0, 0, 1), cameraAt(-5))).toBe(-1);
  });
});

describe("fieldCommitValue", () => {
  it("leaves a value with more decimals alone when the displayed text was not edited", () => {
    expect(fieldCommitValue("30", 30.000000057)).toBeUndefined();
    expect(fieldCommitValue("1.235", 1.23456)).toBeUndefined();
  });
  it("saves an edit, and ignores one that was cancelled or is not a number", () => {
    expect(fieldCommitValue("99", 30)).toBe(99);
    expect(fieldCommitValue("99", 30, { cancelled: true })).toBeUndefined();
    expect(fieldCommitValue("abc", 30)).toBeUndefined();
  });
  it("keeps the result at or above a minimum", () => {
    expect(fieldCommitValue("-2", 1, { min: 0.001 })).toBe(0.001);
    expect(fieldCommitValue("0", 1, { min: 0.001 })).toBe(0.001);
  });
});
