import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { bridgeEdgeLoops } from "./meshBridge";
import { createPolygonMesh } from "./createPolygonMesh";
import { checkManifold } from "./meshManifold";
import { faceAreaNormal, readTopology, topology, type PolygonMesh } from "./meshTopology";
import { measureSurface } from "./meshTestSupport";

/** Vertices and faces of an open tube: a ring at each height, side quads wound the same way every time. */
function tube(rings: readonly { y: number; turn?: number; start?: number }[], sides: number, radius = 1, offset = 0) {
  const vertices: number[][] = [], faces: number[][] = [];
  rings.forEach(({ y, turn = 0, start = 0 }) => {
    for (let i = 0; i < sides; i += 1) {
      const angle = ((((i + start) % sides) / sides) * 2 + turn) * Math.PI;
      vertices.push([radius * Math.cos(angle), y, radius * Math.sin(angle)]);
    }
  });
  for (let r = 0; r + 1 < rings.length; r += 1) for (let i = 0; i < sides; i += 1) {
    const a = offset + r * sides + i, b = offset + r * sides + ((i + 1) % sides), c = offset + (r + 1) * sides + ((i + 1) % sides), d = offset + (r + 1) * sides + i;
    faces.push([a, b, c, d]);
  }
  return { vertices, faces };
}
/** The edges of the boundary loop whose vertices all lie at height `y`. */
function rim(mesh: PolygonMesh, y: number): string[] {
  const at = (vertex: number) => Math.abs((mesh.positions[vertex]?.y ?? Number.NaN) - y) < 1e-9;
  return [...topology(mesh).edges].filter(([, incident]) => incident.length === 1 && incident.every((half) => at(half.from) && at(half.to))).map(([id]) => id);
}
/** Two separate tubes, one above the other. */
function twoTubes(sides: number, upper: { turn?: number; start?: number } = {}, upperSides = sides) {
  const low = tube([{ y: 0 }, { y: 1 }], sides);
  const high = tube([{ y: 2, ...upper }, { y: 3, ...upper }], upperSides, 1, low.vertices.length);
  return createPolygonMesh([...low.vertices, ...high.vertices], [...low.faces, ...high.faces]);
}

describe("bridge edge loops", () => {
  it("joins two openings of separate tubes into one", () => {
    const geometry = twoTubes(8), mesh = readTopology(geometry), before = measureSurface(mesh);
    const result = bridgeEdgeLoops(mesh, [...rim(mesh, 1), ...rim(mesh, 2)]);
    expect(result.bridgeFaces).toBe(8);
    expect(result.mesh.faces).toHaveLength(mesh.faces.length + 8);
    expect(result.mesh.positions).toBe(mesh.positions);
    expect(result.mesh.faces.slice(0, mesh.faces.length)).toEqual(mesh.faces);
    expect(() => checkManifold(result.mesh)).not.toThrow();
    // One tube again: only the two far ends are still open.
    expect([...topology(result.mesh).edges.values()].filter((incident) => incident.length === 1)).toHaveLength(16);
    // The band is a straight 1-unit wall, so it adds 8 rectangles of the tube's own side.
    const side = measureSurface({ ...mesh, faces: mesh.faces.slice(0, 8) }).area / 1;
    expect(measureSurface(result.mesh).area - before.area).toBeCloseTo(side, 6);
    // The band faces the same way as the tubes it joins.
    const radial = (face: number[]) => face.reduce((sum, v) => sum.add(result.mesh.positions[v]?.clone().setY(0) ?? new Vector3()), new Vector3());
    const outward = (index: number) => faceAreaNormal(result.mesh, result.mesh.faces[index] ?? []).dot(radial(result.mesh.faces[index] ?? []));
    const tubeSign = Math.sign(outward(0));
    for (let i = mesh.faces.length; i < result.mesh.faces.length; i += 1) expect(Math.sign(outward(i))).toBe(tubeSign);
  });

  it("pairs the loops by position, not by how their vertices are numbered", () => {
    // The upper ring is rotated by 3 vertices and a quarter of a vertex: the nearest pairing is still the straight one.
    const geometry = twoTubes(8, { start: 3 }), mesh = readTopology(geometry);
    const result = bridgeEdgeLoops(mesh, [...rim(mesh, 1), ...rim(mesh, 2)]);
    expect(() => checkManifold(result.mesh)).not.toThrow();
    const lengths = result.mesh.faces.slice(mesh.faces.length).map((face) => result.mesh.positions[face[0] ?? 0]?.distanceTo(result.mesh.positions[face[3] ?? 0] ?? new Vector3()) ?? NaN);
    for (const length of lengths) expect(length).toBeCloseTo(1, 6);
  });

  it("lets the caller twist the pairing", () => {
    const geometry = twoTubes(8), mesh = readTopology(geometry), edges = [...rim(mesh, 1), ...rim(mesh, 2)];
    const connectors = (twist: number) => {
      const bridged = bridgeEdgeLoops(mesh, edges, twist).mesh;
      expect(() => checkManifold(bridged)).not.toThrow();
      return bridged.faces.slice(mesh.faces.length).map((face) => bridged.positions[face[0] ?? 0]?.distanceTo(bridged.positions[face[3] ?? 0] ?? new Vector3()) ?? Number.NaN);
    };
    // Straight, every connector is the 1-unit height of the gap; turned one edge, each also crosses a chord.
    for (const length of connectors(0)) expect(length).toBeCloseTo(1, 6);
    for (const length of connectors(1)) expect(length).toBeGreaterThan(1.1);
    expect(() => bridgeEdgeLoops(mesh, edges, 1.5)).toThrow("whole number");
  });

  it("explains each way a selection cannot be bridged", () => {
    const mesh = readTopology(twoTubes(8)), lower = rim(mesh, 1), upper = rim(mesh, 2);
    expect(() => bridgeEdgeLoops(mesh, lower)).toThrow("exactly two boundary loops");
    expect(() => bridgeEdgeLoops(mesh, [...lower.slice(1), ...upper])).toThrow("closed loop");
    expect(() => bridgeEdgeLoops(mesh, ["9_3"])).toThrow("canonical");
    expect(() => bridgeEdgeLoops(mesh, ["0_47"])).toThrow(/does not exist|canonical/);
    const inner = [...topology(mesh).edges].find(([, incident]) => incident.length === 2)?.[0] ?? "0_1";
    expect(() => bridgeEdgeLoops(mesh, [...lower, ...upper, inner])).toThrow("open boundary");
    const uneven = readTopology(twoTubes(8, {}, 6));
    expect(() => bridgeEdgeLoops(uneven, [...rim(uneven, 1), ...rim(uneven, 2)])).toThrow("8 and 6");
  });

  it("refuses loops that existing faces already join, and says so", () => {
    // Bridging a tube's own rims would lay new faces exactly over its side.
    const t = tube([{ y: 0 }, { y: 1 }], 6), mesh = readTopology(createPolygonMesh(t.vertices, t.faces));
    expect(() => bridgeEdgeLoops(mesh, [...rim(mesh, 0), ...rim(mesh, 1)])).toThrow("already joined by existing faces");
  });

  it("always makes a manifold tube from rings of any size, turn and starting vertex", () => {
    let state = 99;
    const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    for (let round = 0; round < 150; round += 1) {
      const sides = 3 + Math.floor(next() * 10), turn = next() * 2 / sides, start = Math.floor(next() * sides);
      const low = tube([{ y: 0 }, { y: 1 }], sides, 0.5 + next());
      const high = tube([{ y: 2 + next(), turn, start }, { y: 3 + next(), turn, start }], sides, 0.5 + next(), low.vertices.length);
      const mesh = readTopology(createPolygonMesh([...low.vertices, ...high.vertices], [...low.faces, ...high.faces]));
      const result = bridgeEdgeLoops(mesh, [...rim(mesh, 1), ...[...topology(mesh).edges].filter(([, incident]) => incident.length === 1 && incident.every((half) => (mesh.positions[half.from]?.y ?? 0) >= 2 && (mesh.positions[half.from]?.y ?? 0) < 3 && (mesh.positions[half.to]?.y ?? 0) === (mesh.positions[half.from]?.y ?? -1) && half.from >= low.vertices.length && half.from < low.vertices.length + sides)).map(([id]) => id)]);
      expect(() => checkManifold(result.mesh)).not.toThrow();
      expect([...topology(result.mesh).edges.values()].filter((incident) => incident.length === 1)).toHaveLength(2 * sides);
      for (const face of result.mesh.faces.slice(mesh.faces.length)) expect(faceAreaNormal(result.mesh, face).length()).toBeGreaterThan(1e-9);
    }
  });
});
