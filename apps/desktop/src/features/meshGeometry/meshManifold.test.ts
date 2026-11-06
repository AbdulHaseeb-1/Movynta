import { describe, expect, it } from "vitest";
import { BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, Vector3 } from "three";
import { checkManifold } from "./meshManifold";
import { assertManifold, readTopology, topology, type PolygonMesh } from "./meshTopology";
import { validateTopologyEdit } from "./meshTopologyEdit";

/** Small deterministic generator so a failing case can be reproduced from its index. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
const sources = () => [new BoxGeometry(1, 1, 1, 2, 2, 2), new SphereGeometry(1, 8, 6), new CylinderGeometry(1, 1, 2, 8, 2), new TorusGeometry(1, 0.3, 6, 8)];
function copy(mesh: PolygonMesh): PolygonMesh { return { positions: mesh.positions.map((p) => p.clone()), faces: mesh.faces.map((face) => [...face]) }; }
function outcome(run: () => void): string { try { run(); return "ok"; } catch (error) { return error instanceof Error ? error.message : "error"; } }

/** Applies one random defect to a copy of a valid mesh. */
function corrupt(mesh: PolygonMesh, next: () => number): PolygonMesh {
  const result = copy(mesh);
  const face = Math.floor(next() * result.faces.length);
  switch (Math.floor(next() * 6)) {
    case 0: result.faces.splice(face, 1); break; // open a hole
    case 1: result.faces[face] = [...(result.faces[face] ?? [])].reverse(); break; // flip one face
    case 2: result.faces.push([...(result.faces[face] ?? [])].reverse()); break; // back-to-back duplicate
    case 3: { // pinch: weld two distant vertices together
      const a = Math.floor(next() * result.positions.length), b = Math.floor(next() * result.positions.length);
      if (a !== b) result.faces = result.faces.map((f) => f.map((v) => v === b ? a : v)).filter((f) => new Set(f).size === f.length);
      break;
    }
    case 4: { const f = result.faces[face] ?? []; result.faces.push([f[0] ?? 0, f[1] ?? 0, result.positions.length]); result.positions.push(new Vector3(9, 9, 9)); break; } // third face on an edge
    default: result.faces.splice(face, 2); // remove two neighbours
  }
  return result;
}

describe("checkManifold", () => {
  it("agrees with assertManifold on valid and corrupted meshes", () => {
    const next = random(20261106);
    let rejected = 0, accepted = 0;
    for (const geometry of sources()) {
      const mesh = readTopology(geometry);
      for (let round = 0; round < 60; round += 1) {
        const candidate = round === 0 ? copy(mesh) : corrupt(mesh, next);
        const closed = round % 2 === 0;
        const expected = outcome(() => assertManifold(candidate, topology(candidate), closed));
        const actual = outcome(() => { checkManifold(candidate, closed); });
        expect({ round, actual }).toEqual({ round, actual: expected });
        if (expected === "ok") accepted += 1; else rejected += 1;
      }
    }
    expect(rejected).toBeGreaterThan(40);
    expect(accepted).toBeGreaterThan(10);
  });

  it("reports whether a mesh is closed and remembers a passing mesh", () => {
    const closedMesh = readTopology(new BoxGeometry());
    expect(checkManifold(closedMesh)).toEqual({ closed: true });
    const open: PolygonMesh = { ...closedMesh, faces: closedMesh.faces.slice(1) };
    expect(checkManifold(open)).toEqual({ closed: false });
    expect(() => checkManifold(open, true)).toThrow("closed manifold");
    // The remembered answer must still enforce closedness when a later caller asks for it.
    expect(() => checkManifold(open, true)).toThrow("closed manifold");
  });

  it("lets a topology edit open a closed mesh only when it says so", () => {
    const box = readTopology(new BoxGeometry());
    const open: PolygonMesh = { positions: box.positions, faces: box.faces.slice(1) };
    expect(() => validateTopologyEdit(box, open)).toThrow("closed manifold");
    expect(() => validateTopologyEdit(box, open, { allowOpening: true })).not.toThrow();
  });

  it("still rejects defects the face checks catch", () => {
    const box = readTopology(new BoxGeometry());
    const duplicate: PolygonMesh = { positions: box.positions, faces: [...box.faces, [...(box.faces[0] ?? [])].reverse()] };
    expect(() => validateTopologyEdit(box, duplicate)).toThrow();
    const collapsed = copy(box);
    const edge = collapsed.faces[0] ?? [];
    collapsed.positions[edge[1] ?? 0] = collapsed.positions[edge[0] ?? 0]?.clone() ?? new Vector3();
    expect(() => validateTopologyEdit(box, collapsed)).toThrow(/collapse|untriangulatable/);
  });
});
