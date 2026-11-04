import { describe, expect, it } from "vitest";
import { BoxGeometry, CylinderGeometry, SphereGeometry, Vector3, type BufferGeometry } from "three";
import { extrudeRegion, writeExtrudedGeometry } from "./meshExtrude";
import { writeShadedGeometry } from "./meshOutput";
import { subdivideFaces } from "./meshSubdivideFaces";
import { assertManifold, point, readTopology, topology, type PolygonMesh } from "./meshTopology";

/** Seeded, so a failure reproduces exactly. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}
function surfaceArea(mesh: PolygonMesh): number {
  let total = 0;
  for (const face of mesh.faces) {
    const origin = point(mesh, face[0]);
    for (let i = 1; i + 1 < face.length; i += 1) {
      total += point(mesh, face[i]).clone().sub(origin).cross(point(mesh, face[i + 1]).clone().sub(origin)).length() / 2;
    }
  }
  return total;
}
function isClosed(mesh: PolygonMesh): boolean {
  try {
    assertManifold(mesh, topology(mesh), true);
    return true;
  } catch {
    return false;
  }
}
const SHAPES: [string, () => BufferGeometry, boolean][] = [
  ["box", () => new BoxGeometry(2, 2, 2), true],
  ["segmented box", () => new BoxGeometry(2, 1, 3, 2, 1, 2), true],
  ["cylinder", () => new CylinderGeometry(1, 1, 2, 8, 1, false), true],
  ["sphere", () => new SphereGeometry(1, 8, 6), true],
];

describe("mesh properties under random face selections", () => {
  for (const [name, make, planar] of SHAPES) {
    it(`keeps a closed ${name} closed, writable, and (for planar shapes) the same area after subdividing`, () => {
      const next = random(name.length * 7919);
      for (let trial = 0; trial < 60; trial += 1) {
        const source = make();
        const cage = readTopology(source);
        const picked = new Set<number>();
        const count = 1 + Math.floor(next() * Math.min(5, cage.faces.length));
        while (picked.size < count) picked.add(Math.floor(next() * cage.faces.length));
        const ids = [...picked].map(String);
        const subdivided = subdivideFaces(cage, ids);
        expect(isClosed(subdivided.mesh)).toBe(true);
        expect(subdivided.selection).toHaveLength([...picked].reduce((sum, face) => sum + (cage.faces[face]?.length ?? 0), 0));
        if (planar) expect(Math.abs(surfaceArea(subdivided.mesh) - surfaceArea(cage))).toBeLessThan(1e-6);
        expect(() => writeShadedGeometry(make(), subdivided.mesh)).not.toThrow();
        const offset = new Vector3(next() - 0.5, 1 + next(), next() - 0.5);
        const extruded = extrudeRegion(cage, "face", ids, offset);
        expect(isClosed(extruded.mesh)).toBe(true);
        expect(() => writeExtrudedGeometry(make(), extruded)).not.toThrow();
      }
    });
  }
});
