import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { meshEdgeDiagnostics } from "./meshDiagnostics";

describe("mesh edge diagnostics", () => {
  it("classifies boundary, inconsistent and non-manifold edges independently", () => {
    const mesh = { positions: Array.from({ length: 7 }, (_, i) => new Vector3(i, i % 2, 0)), faces: [[0, 1, 2], [0, 1, 3], [1, 2, 4], [2, 1, 5], [2, 1, 6]] };
    const result = meshEdgeDiagnostics(mesh);
    expect(result.inconsistent).toEqual(["0_1"]);
    expect(result.nonManifold).toEqual(["1_2"]);
    expect(result.boundary).toHaveLength(9);
    expect(meshEdgeDiagnostics(mesh)).toBe(result);
  });
});
