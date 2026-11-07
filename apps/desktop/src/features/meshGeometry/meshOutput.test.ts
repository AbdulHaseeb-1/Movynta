import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { createPolygonMesh } from "./createPolygonMesh";
import { triangulate } from "./meshOutput";
import { faceNormal, readTopology, type PolygonMesh } from "./meshTopology";

/** One polygon in the plane z = 0, wound counter-clockwise seen from +z. */
function polygon(points: readonly (readonly [number, number])[]): PolygonMesh {
  return readTopology(createPolygonMesh(points.map(([x, y]) => [x, y, 0]), [points.map((_, index) => index)]));
}

function areas(mesh: PolygonMesh, triangles: number[][]): number[] {
  const face = mesh.faces[0] ?? [];
  return triangles.map((triangle) => {
    const [a, b, c] = triangle.map((corner) => mesh.positions[face[corner] ?? -1]);
    return a && b && c ? b.clone().sub(a).cross(c.clone().sub(a)).dot(new Vector3(0, 0, 1)) / 2 : NaN;
  });
}

describe("triangulate", () => {
  it("splits a polygon into n-2 triangles that cover it once and keep its winding", () => {
    const hexagon = polygon([[1, 0], [0.5, 0.87], [-0.5, 0.87], [-1, 0], [-0.5, -0.87], [0.5, -0.87]]);
    const face = hexagon.faces[0] ?? [];
    const triangles = triangulate(hexagon, face);
    expect(triangles).toHaveLength(4);
    const sizes = areas(hexagon, triangles);
    expect(sizes.every((size) => size > 0)).toBe(true);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(2.61, 2);
    expect(faceNormal(hexagon, face).z).toBeGreaterThan(0);
  });

  it("leaves no flat triangle when a vertex lies on a straight edge, as a bevel leaves on a neighbouring face", () => {
    // A square with a vertex in the middle of its bottom edge: three triangles, none of them flat.
    const square = polygon([[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1]]);
    const triangles = triangulate(square, square.faces[0] ?? []);
    expect(triangles).toHaveLength(3);
    const sizes = areas(square, triangles);
    expect(Math.min(...sizes)).toBeGreaterThan(0.1);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1, 12);
  });

  it("leaves no flat triangle in the cap of a cylinder whose seam was bevelled", () => {
    // The 8-sided cap of a cylinder with one vertical seam beveled: the bevel put a vertex exactly on each of the two
    // straight edges beside the seam (found by interpolating along the edge, as the bevel does), and ear clipping used to
    // cut each of them off as a triangle with no area.
    const r = 0.3, corner = [r * Math.SQRT1_2, r * Math.SQRT1_2] as const, t = 0.8695;
    const lerp = (a: readonly number[], b: readonly number[], at: number) => [(a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * at, (a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * at] as const;
    const ring = Array.from({ length: 8 }, (_, k) => [r * Math.cos((k * Math.PI) / 4), r * Math.sin((k * Math.PI) / 4)] as const);
    const cap = polygon([
      corner, lerp(corner, ring[2] ?? corner, 1 - t), ring[2] ?? corner, ring[3] ?? corner, ring[4] ?? corner, ring[5] ?? corner, ring[6] ?? corner, ring[7] ?? corner, ring[0] ?? corner, lerp(ring[0] ?? corner, corner, t),
    ]);
    const triangles = triangulate(cap, cap.faces[0] ?? []);
    expect(triangles).toHaveLength(8);
    expect(Math.min(...areas(cap, triangles))).toBeGreaterThan(1e-4);
    // Every corner is still used and the triangles still cover the polygon exactly once.
    expect(new Set(triangles.flat()).size).toBe(10);
    const octagonArea = 2 * Math.SQRT2 * r * r;
    expect(areas(cap, triangles).reduce((sum, size) => sum + size, 0)).toBeCloseTo(octagonArea, 6);
  });

  it("handles several vertices on straight edges", () => {
    const cap = polygon([[0.3, 0], [0.2, 0.1], [0.1, 0.2], [0, 0.3], [-0.3, 0], [-0.2, -0.2], [0, -0.3]]);
    const triangles = triangulate(cap, cap.faces[0] ?? []);
    expect(triangles).toHaveLength(5);
    expect(Math.min(...areas(cap, triangles))).toBeGreaterThan(1e-4);
  });

  it("treats vertices that are on the line only to within rounding the same way", () => {
    const noisy = polygon([[0, 0], [0.5, 1e-13], [1, 0], [1, 1], [0, 1]]);
    const triangles = triangulate(noisy, noisy.faces[0] ?? []);
    expect(triangles).toHaveLength(3);
    expect(Math.min(...areas(noisy, triangles))).toBeGreaterThan(0.1);
  });
});
