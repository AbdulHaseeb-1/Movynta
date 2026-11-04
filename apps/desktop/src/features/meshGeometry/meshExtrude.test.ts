import { describe, expect, it } from "vitest";
import { BoxGeometry, DoubleSide, FrontSide, Mesh, MeshStandardMaterial, PlaneGeometry, Scene, SphereGeometry, Vector3, type BufferGeometry } from "three";
import { EditorScene } from "../assistant/EditorScene";
import { isEditableTarget } from "./meshInspection";
import { fillHole } from "./meshFillHole";
import { commitStack, evaluateStack, modifierStack } from "./modifierStack";
import { checkExtrudeSelection, extrudeAlongRegionNormal, extrudeRegion, writeExtrudedGeometry, ZeroAreaWallError, type ExtrudeResult } from "./meshExtrude";
import { hardCageVertices, triangulate, writeGeometry, writeShadedGeometry } from "./meshOutput";
import { assertManifold, cageKey, edgeKey, faceNormal, point, readTopology, topology, type PolygonMesh } from "./meshTopology";
import { basis } from "./meshWeights";

function top(mesh: PolygonMesh): number {
  const index = mesh.faces.findIndex((face) => faceNormal(mesh, face).y > 0.9);
  if (index < 0) throw new Error("Cube has no top face");
  return index;
}
function signedVolume(mesh: PolygonMesh): number {
  let sum = 0;
  for (const face of mesh.faces) for (const triangle of triangulateSafe(face)) {
    const cornerA = corner(face, triangle[0]);
    const cornerB = corner(face, triangle[1]);
    const cornerC = corner(face, triangle[2]);
    const pa = point(mesh, cornerA);
    const pb = point(mesh, cornerB);
    const pc = point(mesh, cornerC);
    sum += pa.dot(pb.clone().cross(pc));
  }
  return sum / 6;
}
function corner(face: readonly number[], index: number | undefined): number {
  const value = index === undefined ? undefined : face[index];
  if (value === undefined) throw new Error("Broken triangle");
  return value;
}
function triangulateSafe(face: readonly number[]): number[][] {
  if (face.length === 4) return [[0, 1, 2], [0, 2, 3]];
  if (face.length === 3) return [[0, 1, 2]];
  throw new Error(`Unexpected face with ${face.length} corners`);
}

/** Every corner of a flat-shaded triangle carries that triangle's normal. */
function expectFlat(geometry: BufferGeometry): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  if (!index) throw new Error("Missing index");
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const pa = new Vector3().fromBufferAttribute(position, a);
    const face = new Vector3().fromBufferAttribute(position, b).sub(pa).cross(new Vector3().fromBufferAttribute(position, c).sub(pa)).normalize();
    for (const vertex of [a, b, c]) expect(new Vector3().fromBufferAttribute(normal, vertex).dot(face)).toBeGreaterThan(0.99);
  }
}
/** First render index of each cage face in a smooth write, where every face corner gets its own vertex. */
function renderStarts(mesh: PolygonMesh): number[] {
  const starts: number[] = [];
  let next = 0;
  for (const face of mesh.faces) {
    starts.push(next);
    next += face.length;
  }
  return starts;
}
function uvArea(uv: { getX(index: number): number; getY(index: number): number }, a: number, b: number, c: number): number {
  return Math.abs((uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getX(c) - uv.getX(a)) * (uv.getY(b) - uv.getY(a))) / 2;
}
function expectTexturedWalls(source: BufferGeometry, result: ExtrudeResult): void {
  const uv = writeExtrudedGeometry(source, result).getAttribute("uv");
  const starts = renderStarts(result.mesh);
  expect(result.walls.length).toBeGreaterThan(0);
  for (const wall of result.walls) {
    const first = starts[wall] ?? Number.NaN;
    expect(uvArea(uv, first, first + 1, first + 2)).toBeGreaterThan(1e-3);
    expect(uvArea(uv, first, first + 2, first + 3)).toBeGreaterThan(1e-3);
  }
}

describe("extrude region", () => {
  it("offsets shared vertices along their normals without splitting adjacent faces", () => {
    const cage = readTopology(new BoxGeometry(2, 2, 2));
    const upper = top(cage);
    const side = cage.faces.findIndex((face) => faceNormal(cage, face).x > 0.9);
    const shared = (cage.faces[upper] ?? []).find((vertex) => cage.faces[side]?.includes(vertex));
    const sharedCorner = cage.faces[upper]?.indexOf(shared ?? -1) ?? -1;
    const result = extrudeAlongRegionNormal(cage, [String(upper), String(side)], 0.25, { normalMode: "vertex" });
    const moved = result.mesh.faces[upper]?.[sharedCorner];
    expect(result.mesh.faces[side]).toContain(moved);
    const delta = point(result.mesh, moved).clone().sub(point(cage, shared));
    expect(delta.length()).toBeCloseTo(0.25);
    expect(delta.x).toBeCloseTo(0.25 / Math.SQRT2);
    expect(delta.y).toBeCloseTo(0.25 / Math.SQRT2);
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
  });

  it("raises a cube face and keeps the result a closed manifold", () => {
    const cage = readTopology(new BoxGeometry(2, 2, 2));
    const before = signedVolume(cage);
    const result = extrudeRegion(cage, "face", [String(top(cage))], new Vector3(0, 1, 0));
    expect(result.mesh.faces).toHaveLength(10);
    expect(result.selection).toEqual([String(top(cage))]);
    expect(Math.max(...result.mesh.positions.map((position) => position.y))).toBeCloseTo(2);
    expect(signedVolume(result.mesh)).toBeCloseTo(before + 4);
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
    const written = readTopology(writeGeometry(new BoxGeometry(2, 2, 2), result.mesh, false));
    expect(written.faces).toHaveLength(10);
  });

  it("moves adjacent faces as one region", () => {
    const cage = readTopology(new BoxGeometry(2, 2, 2));
    const graph = topology(cage);
    const shared = [...graph.edges.values()].find((incident) => incident.length === 2);
    const first = shared?.[0]?.face;
    const second = shared?.[1]?.face;
    if (first === undefined || second === undefined) throw new Error("Missing adjacent faces");
    // An oblique offset: an axis-aligned one runs parallel to a vertical boundary edge and leaves a zero-area wall.
    const result = extrudeRegion(cage, "face", [String(first), String(second)], new Vector3(0.3, 1, 0.2));
    expect(result.mesh.faces).toHaveLength(12);
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
  });

  it("translates the whole cage when every face is selected", () => {
    const cage = readTopology(new BoxGeometry(2, 2, 2));
    const result = extrudeRegion(cage, "face", cage.faces.map((_, index) => String(index)), new Vector3(0, 1, 0));
    expect(result.mesh.faces).toHaveLength(6);
    expect(Math.min(...result.mesh.positions.map((position) => position.y))).toBeCloseTo(0);
    expect(Math.max(...result.mesh.positions.map((position) => position.y))).toBeCloseTo(2);
  });

  it("grows a quad from a boundary edge and a third face from an interior edge", () => {
    const plane = readTopology(new PlaneGeometry(1, 1));
    const boundary = [...topology(plane).edges.values()].find((incident) => incident.length === 1)?.[0];
    if (!boundary) throw new Error("Missing boundary");
    const sheet = extrudeRegion(plane, "edge", [edgeKey(boundary.from, boundary.to)], new Vector3(0, 0, 1));
    expect(sheet.mesh.faces).toHaveLength(2);
    expect(Math.max(...sheet.mesh.positions.map((position) => position.z))).toBeCloseTo(1);
    const cube = readTopology(new BoxGeometry(2, 2, 2));
    const interior = [...topology(cube).edges.values()].find((incident) => incident.length === 2)?.[0];
    if (!interior) throw new Error("Missing interior edge");
    // Oblique, so the offset is not parallel to a vertical edge, which would give the fin no area.
    const fin = extrudeRegion(cube, "edge", [edgeKey(interior.from, interior.to)], new Vector3(0.3, 1, 0.2));
    expect([...topology(fin.mesh).edges.values()].some((incident) => incident.length === 3)).toBe(true);
  });

  it("copies the source face material and corner onto an edge wall", () => {
    const mesh: PolygonMesh = {
      positions: [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 1, 0), new Vector3(0, 1, 0)],
      faces: [[0, 1, 2, 3]],
      channels: { positions: [0, 1, 2, 3].map(basis), corners: [[4, 5, 6, 7].map(basis)], materials: [3] },
    };
    const result = extrudeRegion(mesh, "edge", [edgeKey(0, 1)], new Vector3(0, 0, 1));
    expect(result.mesh.channels?.materials[1]).toBe(3);
    const corners = result.mesh.channels?.corners[1] ?? [];
    expect(corners.some((weights) => weights.get(4) === 1)).toBe(true);
    expect(corners.some((weights) => weights.get(5) === 1)).toBe(true);
  });

  it("points a two-vertex wall outward and keeps both triangles on that side", () => {
    const cage = readTopology(new BoxGeometry(2, 2, 2));
    const incident = [...topology(cage).edges.values()].find((edges) => edges.length === 2);
    const half = incident?.[0];
    const other = incident?.[1];
    const first = half ? cage.faces[half.face] : undefined;
    const second = other ? cage.faces[other.face] : undefined;
    if (!half || !other || !first || !second) throw new Error("Missing edge");
    const result = extrudeRegion(cage, "vertex", [String(half.from), String(half.to)], faceNormal(cage, first));
    const wall = result.mesh.faces[result.mesh.faces.length - 1];
    if (!wall) throw new Error("Missing wall");
    const normal = faceNormal(result.mesh, wall);
    expect(normal.dot(faceNormal(cage, second))).toBeGreaterThan(0.5);
    for (const triangle of triangulate(result.mesh, wall)) {
      const pa = point(result.mesh, wall[triangle[0] ?? -1]);
      const pb = point(result.mesh, wall[triangle[1] ?? -1]);
      const pc = point(result.mesh, wall[triangle[2] ?? -1]);
      expect(pb.clone().sub(pa).cross(pc.clone().sub(pa)).dot(normal)).toBeGreaterThan(0);
    }
  });

  it("keeps a flat cube faceted and a smooth sphere smooth", () => {
    const source = new BoxGeometry(2, 2, 2);
    const cage = readTopology(source);
    const result = extrudeRegion(cage, "face", [String(top(cage))], new Vector3(0, 1, 0));
    expectFlat(writeShadedGeometry(source, result.mesh));
    const sphere = new SphereGeometry(1, 8, 6);
    expect(hardCageVertices(sphere, readTopology(sphere)).size).toBe(0);
  });

  it("keeps the mesh closed when two selected faces touch only at a corner", () => {
    // Two faces of a sphere that share one vertex and no edge. Each gets its own moved copy of that vertex.
    const sphere = readTopology(new SphereGeometry(1, 8, 6));
    const result = extrudeRegion(sphere, "face", ["12", "31"], new Vector3(0.3, 0.7, 0.2));
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
    expect(result.walls).toHaveLength(6);
  });

  it("extrudes both vertices of an edge and rejects a lone vertex or a zero offset", () => {
    const mesh: PolygonMesh = {
      positions: [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
      faces: [[0, 1, 2]],
    };
    const result = extrudeRegion(mesh, "vertex", ["0", "1"], new Vector3(0, 0, 1));
    expect(result.mesh.faces).toHaveLength(2);
    expect(result.selection).toHaveLength(2);
    expect(() => extrudeRegion(mesh, "vertex", ["0"], new Vector3(0, 0, 1))).toThrow(/both vertices/);
    expect(() => extrudeRegion(mesh, "face", ["0"], new Vector3(0, 0, 0))).toThrow(/move the selection/);
    expect(() => extrudeRegion(mesh, "face", ["4"], new Vector3(0, 1, 0))).toThrow(/Unknown face/);
  });
});

describe("extrude walls", () => {
  it("winds a boundary wall against its edge so the sheet stays one consistent surface", () => {
    const plane = readTopology(new PlaneGeometry(1, 1));
    const boundary = [...topology(plane).edges.values()].find((incident) => incident.length === 1)?.[0];
    if (!boundary) throw new Error("Missing boundary");
    const sheet = extrudeRegion(plane, "edge", [edgeKey(boundary.from, boundary.to)], new Vector3(0, 0, 1));
    expect(() => assertManifold(sheet.mesh, topology(sheet.mesh))).not.toThrow();
  });

  it("refuses a wall whose offset runs along its own edge, and still accepts that edge as a selection", () => {
    const cube = readTopology(new BoxGeometry(2, 2, 2));
    const edge = [...topology(cube).edges.values()].find((incident) => incident.length === 2)?.[0];
    if (!edge) throw new Error("Missing edge");
    const along = point(cube, edge.to).clone().sub(point(cube, edge.from));
    expect(() => extrudeRegion(cube, "edge", [edgeKey(edge.from, edge.to)], along)).toThrow(ZeroAreaWallError);
    expect(() => checkExtrudeSelection(cube, "edge", [edgeKey(edge.from, edge.to)])).not.toThrow();
  });

  it("starts a drag on a vertical edge, which a fixed upward probe would have rejected", () => {
    const cube = readTopology(new BoxGeometry(2, 2, 2));
    const vertical = [...topology(cube).edges.values()].find((incident) => {
      const half = incident[0];
      if (!half) return false;
      return Math.abs(point(cube, half.to).clone().sub(point(cube, half.from)).normalize().y) > 0.99;
    })?.[0];
    if (!vertical) throw new Error("Missing vertical edge");
    expect(() => checkExtrudeSelection(cube, "edge", [edgeKey(vertical.from, vertical.to)])).not.toThrow();
    expect(() => extrudeRegion(cube, "edge", [edgeKey(vertical.from, vertical.to)], new Vector3(1, 0, 0))).not.toThrow();
  });

  it("gives every extruded wall texture area, for face, edge and vertex extrudes", () => {
    const source = new BoxGeometry(2, 2, 2);
    const cage = readTopology(source);
    const topFace = cage.faces.findIndex((face) => faceNormal(cage, face).y > 0.9);
    expectTexturedWalls(source, extrudeRegion(cage, "face", [String(topFace)], new Vector3(0, 1, 0)));
    const edge = [...topology(cage).edges.values()].find((incident) => incident.length === 2)?.[0];
    if (!edge) throw new Error("Missing edge");
    expectTexturedWalls(source, extrudeRegion(cage, "edge", [edgeKey(edge.from, edge.to)], new Vector3(0.3, 1, 0.2)));
    const pair = [String(edge.from), String(edge.to)];
    expectTexturedWalls(source, extrudeRegion(cage, "vertex", pair, new Vector3(0.3, 1, 0.2)));
  });

  it("keeps cube faces flat after edge and vertex extrudes, including a second extrude of the written result", () => {
    const source = new BoxGeometry(2, 2, 2);
    const cage = readTopology(source);
    const edge = [...topology(cage).edges.values()].find((incident) => incident.length === 2)?.[0];
    if (!edge) throw new Error("Missing edge");
    const first = writeExtrudedGeometry(source, extrudeRegion(cage, "edge", [edgeKey(edge.from, edge.to)], new Vector3(0.3, 1, 0.2)));
    expectFlat(first);
    const next = readTopology(first);
    const topFace = next.faces.findIndex((face) => faceNormal(next, face).y > 0.9);
    expectFlat(writeExtrudedGeometry(first, extrudeRegion(next, "face", [String(topFace)], new Vector3(0, 0.5, 0))));
  });
});

describe("extrude command", () => {
  it("moves adjacent cube faces separately along their own normals", () => {
    const source = new BoxGeometry(2, 2, 2);
    const cage = readTopology(source);
    const ids = [top(cage), cage.faces.findIndex((face) => faceNormal(cage, face).x > 0.9)];
    const result = extrudeAlongRegionNormal(cage, ids.map(String), 0.5, { normalMode: "individual" });
    const [topId, sideId] = ids;
    expect((result.mesh.faces[topId ?? -1] ?? []).every((vertex) => point(result.mesh, vertex).y === 1.5)).toBe(true);
    expect((result.mesh.faces[sideId ?? -1] ?? []).every((vertex) => point(result.mesh, vertex).x === 1.5)).toBe(true);
    expect(result.walls).toHaveLength(8);
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
    source.dispose();
  });

  it("supports different cap scales and a mesh-local cap tilt", () => {
    const source = new PlaneGeometry(4, 2);
    const cage = readTopology(source);
    const result = extrudeAlongRegionNormal(cage, ["0"], 2, {
      capScaleXY: [0.5, 1.5], capRotationDegrees: [30, 0, 0],
    });
    const cap = (result.mesh.faces[0] ?? []).map((id) => point(result.mesh, id));
    expect(Math.max(...cap.map((p) => p.x))).toBeCloseTo(1);
    expect(Math.max(...cap.map((p) => p.y))).toBeCloseTo(1.5 * Math.cos(Math.PI / 6));
    expect(Math.max(...cap.map((p) => p.z))).toBeCloseTo(2.75);
    source.dispose();
  });

  it.each(["edge", "vertex"] as const)("reevaluates a live %s extrusion from an untouched cage", (componentKind) => {
    const source = new PlaneGeometry(2, 2);
    const cage = readTopology(source);
    const edge = topology(cage).edges.values().next().value?.[0];
    if (!edge) throw new Error("Missing plane edge");
    const ids = componentKind === "edge" ? [edgeKey(edge.from, edge.to)] : [String(edge.from), String(edge.to)];
    const mesh = new Mesh(source);
    const stack = evaluateStack(mesh, [{
      id: "ext", kind: "extrusion", componentKind, enabled: true,
      ids, baseKey: cageKey(cage), offset: [0, 0, 1],
    }]);
    expect(readTopology(stack.geometry).faces).toHaveLength(2);
    expect(readTopology(stack.base).faces).toHaveLength(1);
    stack.geometry.dispose(); stack.base.dispose(); source.dispose();
  });

  it("fills an explicit boundary loop and rejects an incomplete loop without a mutation", () => {
    const source = new PlaneGeometry(2, 2);
    const result = extrudeAlongRegionNormal(readTopology(source), ["0"], 1);
    const geometry = writeExtrudedGeometry(source, result);
    const editor = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(geometry);
    editor.importObject("box", mesh);
    const ids = [...topology(readTopology(geometry)).edges]
      .filter(([, incident]) => incident.length === 1).map(([id]) => id);
    const command = { commandId: "fill", type: "geometry.fill_hole", objectId: "box", ids };
    const sheet = new Mesh(source.clone());
    editor.importObject("sheet", sheet);
    const outer = [...topology(readTopology(sheet.geometry)).edges.keys()];
    const rejected = editor.execute("outer", editor.currentRevision, [{ ...command, objectId: "sheet", ids: outer }]);
    expect(rejected.status).toBe("failed");
    if (rejected.status === "failed") expect(rejected.message).toContain("coincident faces");
    expect(editor.execute("incomplete", editor.currentRevision, [{ ...command, ids: ids.slice(1) }]).status).toBe("failed");
    expect(mesh.geometry).toBe(geometry);
    expect(editor.execute("fill", editor.currentRevision, [command]).status).toBe("applied");
    const closed = readTopology(mesh.geometry);
    expect(() => assertManifold(closed, topology(closed), true)).not.toThrow();
    expect(signedVolume(closed)).toBeCloseTo(4);
    editor.reset(); source.dispose();
  });

  it("retains a live extrusion when hole fill preserves the existing base IDs", () => {
    const source = new PlaneGeometry(2, 2);
    const geometry = writeExtrudedGeometry(source, extrudeAlongRegionNormal(readTopology(source), ["0"], 1));
    const editor = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(geometry);
    editor.importObject("box", mesh);
    const cage = readTopology(geometry);
    const stack = evaluateStack(mesh, [{
      id: "ext", kind: "extrusion", enabled: true, ids: ["0"], baseKey: cageKey(cage), normalDistance: 1,
    }]);
    commitStack(mesh, stack);
    const ids = [...topology(cage).edges].filter(([, incident]) => incident.length === 1).map(([id]) => id);
    expect(editor.execute("fill", editor.currentRevision, [{
      commandId: "fill", type: "geometry.fill_hole", objectId: "box", ids, componentView: "base",
    }]).status).toBe("applied");
    const live = modifierStack(mesh);
    expect(live?.modifiers[0]).toMatchObject({ id: "ext", ids: ["0"], enabled: true });
    expect(mesh.geometry.boundingBox?.max.z).toBeCloseTo(2);
    if (!live) throw new Error("Missing live stack");
    const closed = readTopology(live.base);
    expect(() => assertManifold(closed, topology(closed), true)).not.toThrow();
    editor.reset(); source.dispose(); geometry.dispose();
  });

  it("triangulates a warped opening while preserving the original boundary vertices", () => {
    const source = new PlaneGeometry(2, 2);
    const { mesh } = extrudeAlongRegionNormal(readTopology(source), ["0"], 1);
    const boundary = [...topology(mesh).edges].filter(([, incident]) => incident.length === 1);
    const vertex = boundary[0]?.[1][0]?.from;
    if (vertex === undefined) throw new Error("Missing boundary vertex");
    point(mesh, vertex).z -= 0.35;
    const result = fillHole(mesh, boundary.map(([id]) => id));
    expect(result.mesh.positions).toBe(mesh.positions);
    expect(result.selection).toHaveLength(2);
    expect(result.mesh.faces.slice(-2).map((face) => face.length)).toEqual([3, 3]);
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
    writeExtrudedGeometry(source, result).dispose();
    source.dispose();
  });

  it("retains a live face extrusion across a disjoint base extrusion and refuses to move its anchor", () => {
    const editor = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    editor.importObject("box", mesh);
    const cage = readTopology(mesh.geometry);
    const topFace = String(top(cage));
    const bottom = String(cage.faces.findIndex((face) => faceNormal(cage, face).y < -0.9));
    commitStack(mesh, evaluateStack(mesh, [{
      id: "ext", kind: "extrusion", enabled: true, ids: [topFace],
      baseKey: cageKey(cage), normalDistance: 1,
    }]));
    const command = {
      commandId: "extrude", type: "geometry.extrude", objectId: "box", kind: "face",
      componentView: "base", normalDistance: 0.5,
    };
    expect(editor.execute("bottom", editor.currentRevision, [{ ...command, ids: [bottom] }]).status).toBe("applied");
    const stack = modifierStack(mesh);
    expect(stack?.modifiers[0]).toMatchObject({ id: "ext", ids: [topFace] });
    expect(mesh.geometry.boundingBox?.max.y).toBeCloseTo(2);
    expect(mesh.geometry.boundingBox?.min.y).toBeCloseTo(-1.5);
    const rejected = editor.execute("top", editor.currentRevision, [{ ...command, ids: [topFace] }]);
    expect(rejected.status).toBe("failed");
    if (rejected.status === "failed") expect(rejected.message).toContain("face used by the live extrusion");
    expect(modifierStack(mesh)).toBe(stack);
    editor.reset();
  });
  it.each([1, -1])("closes a planar sheet with outward winding at distance %s", (distance) => {
    const source = new PlaneGeometry(2, 2);
    const cage = readTopology(source);
    const result = extrudeAlongRegionNormal(cage, ["0"], distance, { closeOpenSurface: true });
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
    expect(signedVolume(result.mesh)).toBeCloseTo(4);
    expectTexturedWalls(source, result);
    source.dispose();
  });

  it("scales and twists a cap about its translated center", () => {
    const source = new PlaneGeometry(4, 2);
    const cage = readTopology(source);
    const result = extrudeAlongRegionNormal(cage, ["0"], 1, { capScale: 0.5, twistDegrees: 90 });
    const cap = (result.mesh.faces[0] ?? []).map((id) => point(result.mesh, id));
    expect(Math.max(...cap.map((p) => Math.abs(p.x)))).toBeCloseTo(0.5);
    expect(Math.max(...cap.map((p) => Math.abs(p.y)))).toBeCloseTo(1);
    expect(cap.every((p) => Math.abs(p.z - 1) < 1e-8)).toBe(true);
    const geometry = writeExtrudedGeometry(source, result);
    geometry.dispose();
    source.dispose();
  });

  it("updates a live extrusion from the unchanged base and rejects a stale cage key", () => {
    const source = new PlaneGeometry(2, 2);
    const mesh = new Mesh(source);
    const extrusion = {
      id: "extrusion", kind: "extrusion" as const, enabled: true, ids: ["0"],
      baseKey: cageKey(readTopology(source)), normalDistance: 1, closeOpenSurface: true,
    };
    const first = evaluateStack(mesh, [extrusion]);
    commitStack(mesh, first);
    const second = evaluateStack(mesh, [{ ...extrusion, normalDistance: 2 }]);
    expect(second.base).toBe(first.base);
    expect(second.geometry.boundingBox?.max.z).toBeCloseTo(2);
    expect(first.geometry.boundingBox?.max.z).toBeCloseTo(1);
    expect(() => evaluateStack(mesh, [{ ...extrusion, baseKey: "0000000000000000" }])).toThrow("base cage changed");
    second.geometry.dispose();
    first.geometry.dispose();
    first.base.dispose();
    source.dispose();
  });
  it("prepares and applies a region-normal extrusion while retaining the enabled modifier", () => {
    const editor = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    const stack = evaluateStack(mesh, [{ id: "sub", kind: "subdivision", enabled: true, levels: 1 }]);
    commitStack(mesh, stack);
    editor.importObject("box", mesh);
    const inspection = editor.context({ objectId: "box", meshPath: [], offset: 0, limit: 25, view: "base" });
    const face = top(readTopology(stack.base));
    expect(inspection.meshInspection?.faces.some(({ index }) => index === face)).toBe(true);
    const commands = [{
      commandId: "ex", type: "geometry.extrude", objectId: "box",
      kind: "face", ids: [String(face)], componentView: "base", normalDistance: 0.75,
    }];
    expect(editor.executePrepared("proposal", inspection.revision, commands, "prepare").status).toBe("applied");
    expect(mesh.geometry).toBe(stack.geometry);
    expect(editor.executePrepared("proposal", inspection.revision, commands, "commit").status).toBe("applied");
    const edited = editor.getObject("box");
    if (!isEditableTarget(edited)) throw new Error("Missing extruded mesh");
    const next = modifierStack(edited);
    expect(next?.modifiers).toEqual(stack.modifiers);
    expect(next?.base.boundingBox?.max.y).toBeCloseTo(1.75);
    expect(next?.geometry).toBe(edited.geometry);
    expect(next?.geometry).not.toBe(next?.base);
    editor.reset();
  });

  it("rejects a region with opposing normals without mutating the cage", () => {
    const editor = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry());
    editor.importObject("box", mesh);
    const original = mesh.geometry;
    const cage = readTopology(original);
    const bottom = cage.faces.findIndex((face) => faceNormal(cage, face).y < -0.9);
    const result = editor.execute("proposal", editor.currentRevision, [{
      commandId: "ex", type: "geometry.extrude", objectId: "box",
      kind: "face", ids: [String(top(cage)), String(bottom)], normalDistance: 1,
    }]);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("no stable region normal");
    expect(mesh.geometry).toBe(original);
    editor.reset();
  });

  it("keeps the original cage and display if an enabled modifier rejects the extrusion", () => {
    const editor = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry());
    const stack = evaluateStack(mesh, [{ id: "sub", kind: "subdivision", enabled: true, levels: 1 }]);
    commitStack(mesh, stack);
    editor.importObject("box", mesh);
    const cage = readTopology(stack.base);
    const edge = topology(cage).edges.keys().next().value;
    if (edge === undefined) throw new Error("Missing cube edge");
    const revision = editor.currentRevision;
    const result = editor.execute("proposal", revision, [{
      commandId: "ex", type: "geometry.extrude", objectId: "box",
      kind: "edge", ids: [edge], componentView: "base", offset: [1, 1, 1],
    }]);
    expect(result.status).toBe("failed");
    expect(editor.currentRevision).toBe(revision);
    expect(modifierStack(mesh)).toBe(stack);
    expect(mesh.geometry).toBe(stack.geometry);
    editor.reset();
  });
  it("applies on the base cage and refuses an enabled modifier", () => {
    const scene = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    scene.importObject("box", mesh);
    const face = String(top(readTopology(mesh.geometry)));
    const applied = scene.execute("extrude", scene.currentRevision, [{ commandId: "ex", type: "geometry.extrude", objectId: "box", kind: "face", ids: [face], offset: [0, 1, 0] }]);
    expect(applied.status).toBe("applied");
    expect(readTopology(mesh.geometry).faces).toHaveLength(10);
    const faceMaterial = mesh.material;
    if (Array.isArray(faceMaterial)) throw new Error("Missing material");
    expect(faceMaterial.side).toBe(FrontSide);
    const vertices = readTopology(new BoxGeometry(2, 2, 2));
    const pair = [...topology(vertices).edges.values()].find((edges) => edges.length === 2)?.[0];
    const adjacent = pair ? vertices.faces[pair.face] : undefined;
    if (!pair || !adjacent) throw new Error("Missing edge");
    const direction = faceNormal(vertices, adjacent);
    const sided = new EditorScene(new Scene(), "project");
    const fin = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial({ side: FrontSide }));
    sided.importObject("box", fin);
    const extruded = sided.execute("extrude", sided.currentRevision, [{ commandId: "ex", type: "geometry.extrude", objectId: "box", kind: "vertex", ids: [String(pair.from), String(pair.to)], offset: [direction.x, direction.y, direction.z] }]);
    expect(extruded.status).toBe("applied");
    if (!(fin.material instanceof MeshStandardMaterial)) throw new Error("Missing material");
    expect(fin.material.side).toBe(DoubleSide);
    const blocked = new EditorScene(new Scene(), "project");
    const modified = new Mesh(new BoxGeometry(2, 2, 2));
    blocked.importObject("box", modified);
    commitStack(modified, evaluateStack(modified, [{ id: "sub", kind: "subdivision", enabled: true, levels: 1 }]));
    const refused = blocked.execute("extrude", blocked.currentRevision, [{ commandId: "ex", type: "geometry.extrude", objectId: "box", kind: "face", ids: ["0"], offset: [0, 1, 0] }]);
    expect(refused.status).toBe("failed");
    if (refused.status === "failed") expect(refused.message).toContain("Disable modifiers");
  });
});
