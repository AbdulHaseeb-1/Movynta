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
    const tooShort = readTopology(twoTubes(8, {}, 8));
    expect(() => bridgeEdgeLoops(tooShort, [...rim(tooShort, 1), ...rim(tooShort, 2).slice(0, 2)])).toThrow(/closed loop|exactly two/);
  });

  it("refuses loops that existing faces already join, and says so", () => {
    // Bridging a tube's own rims would lay new faces exactly over its side.
    const t = tube([{ y: 0 }, { y: 1 }], 6), mesh = readTopology(createPolygonMesh(t.vertices, t.faces));
    expect(() => bridgeEdgeLoops(mesh, [...rim(mesh, 0), ...rim(mesh, 1)])).toThrow("already joined by existing faces");
  });

  it.each([[8, 6], [6, 8], [12, 3], [3, 12], [7, 5], [5, 5]])("bridges a loop of %i edges to a loop of %i with quads and spread-out triangles", (lowSides, highSides) => {
    const low = tube([{ y: 0 }, { y: 1 }], lowSides), high = tube([{ y: 2 }, { y: 3 }], highSides, 1, low.vertices.length);
    const mesh = readTopology(createPolygonMesh([...low.vertices, ...high.vertices], [...low.faces, ...high.faces]));
    const result = bridgeEdgeLoops(mesh, [...rim(mesh, 1), ...rim(mesh, 2)]);
    const longer = Math.max(lowSides, highSides), shorter = Math.min(lowSides, highSides);
    expect(result.longEdges).toBe(longer);
    expect(result.shortEdges).toBe(shorter);
    expect(result.bridgeFaces).toBe(longer);
    expect(result.quads).toBe(shorter);
    expect(result.triangles).toBe(longer - shorter);
    expect(() => checkManifold(result.mesh)).not.toThrow();
    // Only the two far ends stay open, and nothing was added or moved.
    expect([...topology(result.mesh).edges.values()].filter((incident) => incident.length === 1)).toHaveLength(lowSides + highSides);
    expect(result.mesh.positions).toBe(mesh.positions);
    const added = result.mesh.faces.slice(mesh.faces.length);
    expect(added.filter((face) => face.length === 3)).toHaveLength(longer - shorter);
    for (const face of added) expect(faceAreaNormal(result.mesh, face).length()).toBeGreaterThan(1e-9);
    // The band faces the same way as the tubes it joins.
    const radial = (face: number[]) => face.reduce((sum, v) => sum.add(result.mesh.positions[v]?.clone().setY(0) ?? new Vector3()), new Vector3());
    const outward = (face: number[]) => Math.sign(faceAreaNormal(result.mesh, face).dot(radial(face)));
    const tubeSign = outward(result.mesh.faces[0] ?? []);
    for (const face of added) expect(outward(face)).toBe(tubeSign);
  });

  it("does not put two triangles side by side when the counts differ by less than half", () => {
    const low = tube([{ y: 0 }, { y: 1 }], 12), high = tube([{ y: 2 }, { y: 3 }], 9, 1, low.vertices.length);
    const mesh = readTopology(createPolygonMesh([...low.vertices, ...high.vertices], [...low.faces, ...high.faces]));
    const added = bridgeEdgeLoops(mesh, [...rim(mesh, 1), ...rim(mesh, 2)]).mesh.faces.slice(mesh.faces.length);
    // Faces are made in ring order, so neighbours in the list (and the first and last) are neighbours in the ring.
    added.forEach((face, i) => { if (face.length === 3) expect(added[(i + 1) % added.length]?.length).toBe(4); });
  });

  it("always makes a manifold tube from rings of any size, turn and starting vertex", () => {
    let state = 99;
    const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    for (let round = 0; round < 250; round += 1) {
      const lowSides = 3 + Math.floor(next() * 10), highSides = next() < 0.3 ? lowSides : 3 + Math.floor(next() * 10);
      const turn = next() * 2 / highSides, start = Math.floor(next() * highSides), yHigh = 2 + Math.floor(next() * 4) / 2;
      const low = tube([{ y: 0 }, { y: 1 }], lowSides, 0.5 + next());
      const high = tube([{ y: yHigh, turn, start }, { y: yHigh + 1, turn, start }], highSides, 0.5 + next(), low.vertices.length);
      const mesh = readTopology(createPolygonMesh([...low.vertices, ...high.vertices], [...low.faces, ...high.faces]));
      const result = bridgeEdgeLoops(mesh, [...rim(mesh, 1), ...rim(mesh, yHigh)]);
      expect(() => checkManifold(result.mesh)).not.toThrow();
      expect([...topology(result.mesh).edges.values()].filter((incident) => incident.length === 1)).toHaveLength(lowSides + highSides);
      expect(result.triangles).toBe(Math.abs(lowSides - highSides));
      for (const face of result.mesh.faces.slice(mesh.faces.length)) expect(faceAreaNormal(result.mesh, face).length()).toBeGreaterThan(1e-9);
    }
  });
});
