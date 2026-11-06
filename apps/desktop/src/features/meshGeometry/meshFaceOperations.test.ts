import { describe, expect, it } from "vitest";
import { BoxGeometry, CylinderGeometry, SphereGeometry } from "three";
import { createPolygonMesh } from "./createPolygonMesh";
import { deleteComponents } from "./meshDelete";
import { flipNormals } from "./meshFlip";
import { checkManifold } from "./meshManifold";
import { readTopology } from "./meshTopology";
import { triangulateFaces } from "./meshTriangulateFaces";
import { measureSurface as measure } from "./meshTestSupport";

/** Two unit squares side by side, then a separate square far away: three faces, two shells. */
function shells() {
  return createPolygonMesh(
    [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0], [5, 0, 0], [6, 0, 0], [6, 1, 0], [5, 1, 0]],
    [[0, 1, 4, 3], [1, 2, 5, 4], [6, 7, 8, 9]],
  );
}

describe("delete components", () => {
  it("removes faces, opens the mesh and reports the new rim", () => {
    const geometry = new BoxGeometry(1, 1, 1), mesh = readTopology(geometry);
    const result = deleteComponents(mesh, "face", ["2"]);
    expect(result.mesh.faces).toHaveLength(5);
    expect(result.mesh.positions).toHaveLength(8);
    expect(result.removedFaces).toBe(1);
    expect(checkManifold(result.mesh).closed).toBe(false);
    expect(result.selection).toHaveLength(4);
    // Surviving faces keep their order.
    expect(result.mesh.faces).toEqual(mesh.faces.filter((_, index) => index !== 2));
  });

  it("takes every face around a vertex and drops the vertex", () => {
    const geometry = new BoxGeometry(1, 1, 1), mesh = readTopology(geometry);
    const result = deleteComponents(mesh, "vertex", ["0"]);
    expect(result.removedFaces).toBe(3);
    expect(result.mesh.positions).toHaveLength(7);
    expect(result.removedVertices).toBe(1);
    expect(() => checkManifold(result.mesh)).not.toThrow();
  });

  it("takes both faces beside an edge", () => {
    const geometry = new BoxGeometry(1, 1, 1), mesh = readTopology(geometry);
    const edge = [...new Set(mesh.faces.flatMap((face) => face.map((from, corner) => { const to = face[(corner + 1) % 4] ?? 0; return from < to ? `${from}_${to}` : `${to}_${from}`; })))][0] ?? "";
    expect(deleteComponents(mesh, "edge", [edge]).removedFaces).toBe(2);
  });

  it("refuses ids that do not exist and a selection that would empty the mesh", () => {
    const geometry = new BoxGeometry(1, 1, 1), mesh = readTopology(geometry);
    expect(() => deleteComponents(mesh, "face", ["99"])).toThrow("does not exist");
    expect(() => deleteComponents(mesh, "vertex", ["99"])).toThrow("does not exist");
    expect(() => deleteComponents(mesh, "edge", ["0_99"])).toThrow(/canonical/);
    const adjacent = new Set(mesh.faces.flatMap((face) => face.map((from, corner) => { const to = face[(corner + 1) % face.length] ?? 0; return from < to ? `${from}_${to}` : `${to}_${from}`; })));
    const missing = [...Array(8).keys()].flatMap((a) => [...Array(8).keys()].filter((b) => b > a).map((b) => `${a}_${b}`)).find((id) => !adjacent.has(id)) ?? "";
    expect(() => deleteComponents(mesh, "edge", [missing])).toThrow("does not exist");
    expect(() => deleteComponents(mesh, "face", mesh.faces.map((_, index) => String(index)))).toThrow("scene.delete_object");
  });

  it("refuses to leave faces touching only at a vertex", () => {
    const geometry = createPolygonMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 1, 0], [2, 2, 0], [1, 2, 0], [0, 2, 0], [-1, 1, 0]], [[0, 1, 2, 3], [3, 2, 6, 7], [2, 4, 5, 6], [0, 3, 8]]);
    const mesh = readTopology(geometry);
    expect(() => deleteComponents(mesh, "face", ["1"])).toThrow("non-manifold vertex");
  });

  it("deletes whole shells independently and keeps the others untouched", () => {
    const geometry = shells(), mesh = readTopology(geometry);
    const result = deleteComponents(mesh, "face", ["2"]);
    expect(result.mesh.faces).toHaveLength(2);
    expect(result.mesh.positions).toHaveLength(6);
    expect(result.mesh.channels?.corners).toHaveLength(2);
  });
});

describe("flip normals", () => {
  it("reverses a closed solid so its volume changes sign", () => {
    const geometry = new SphereGeometry(1, 12, 8), mesh = readTopology(geometry), before = measure(mesh);
    const result = flipNormals(mesh);
    expect(measure(result.mesh).volume).toBeCloseTo(-before.volume, 8);
    expect(result.flippedFaces).toBe(mesh.faces.length);
    expect(result.mesh.faces.map((face) => face.length)).toEqual(mesh.faces.map((face) => face.length));
    expect(() => checkManifold(result.mesh, true)).not.toThrow();
  });

  it("flips only the shell a listed face belongs to", () => {
    const geometry = shells(), mesh = readTopology(geometry);
    const result = flipNormals(mesh, ["2"]);
    expect(result.flippedFaces).toBe(1);
    expect(result.mesh.faces[2]).toEqual([...(mesh.faces[2] ?? [])].reverse());
    expect(result.mesh.faces[0]).toEqual(mesh.faces[0]);
    // A face standing for its shell flips the whole shell.
    const both = flipNormals(mesh, ["0"]);
    expect(both.flippedFaces).toBe(2);
    expect(both.mesh.faces[1]).toEqual([...(mesh.faces[1] ?? [])].reverse());
  });

  it("keeps the corner attributes aligned with the reversed corners", () => {
    const geometry = shells(), mesh = readTopology(geometry);
    const result = flipNormals(mesh);
    const corners = mesh.channels?.corners[2] ?? [];
    expect(result.mesh.channels?.corners[2]).toEqual([...corners].reverse());
  });

  it("rejects a face that does not exist", () => {
    const geometry = shells(), mesh = readTopology(geometry);
    expect(() => flipNormals(mesh, ["7"])).toThrow("does not exist");
  });
});

describe("triangulate faces", () => {
  it("splits every polygon of a cube into triangles without changing the surface", () => {
    const geometry = new BoxGeometry(1, 1, 1), mesh = readTopology(geometry), before = measure(mesh);
    const result = triangulateFaces(mesh);
    expect(result.mesh.faces).toHaveLength(12);
    expect(result.mesh.faces.every((face) => face.length === 3)).toBe(true);
    expect(result.triangulatedFaces).toBe(6);
    expect(measure(result.mesh).volume).toBeCloseTo(before.volume, 8);
    expect(measure(result.mesh).area).toBeCloseTo(before.area, 8);
    expect(() => checkManifold(result.mesh, true)).not.toThrow();
  });

  it("splits chosen faces in place and keeps the rest", () => {
    const geometry = new CylinderGeometry(1, 1, 2, 8, 1), mesh = readTopology(geometry);
    const big = mesh.faces.findIndex((face) => face.length > 4);
    expect(big).toBeGreaterThanOrEqual(0);
    const result = triangulateFaces(mesh, [String(big)]);
    expect(result.mesh.faces).toHaveLength(mesh.faces.length + (mesh.faces[big]?.length ?? 0) - 3);
    expect(result.mesh.faces.slice(0, big)).toEqual(mesh.faces.slice(0, big));
    expect(result.mesh.channels?.materials).toHaveLength(result.mesh.faces.length);
  });

  it("explains when there is nothing to split", () => {
    const geometry = new SphereGeometry(1, 6, 4), mesh = readTopology(geometry);
    const triangles = mesh.faces.findIndex((face) => face.length === 3);
    expect(() => triangulateFaces(mesh, [String(triangles)])).toThrow("already a triangle");
    expect(() => triangulateFaces(mesh, ["9999"])).toThrow("does not exist");
  });
});
