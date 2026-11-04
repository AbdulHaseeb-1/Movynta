import { describe, expect, it } from "vitest";
import { BoxGeometry, DoubleSide, FrontSide, Mesh, MeshStandardMaterial, PlaneGeometry, Scene, SphereGeometry, Vector3 } from "three";
import { EditorScene } from "../assistant/EditorScene";
import { commitStack, evaluateStack } from "./modifierStack";
import { extrudeRegion } from "./meshExtrude";
import { hardCageVertices, triangulate, writeGeometry, writeShadedGeometry } from "./meshOutput";
import { assertManifold, edgeKey, faceNormal, point, readTopology, topology, type PolygonMesh } from "./meshTopology";
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

describe("extrude region", () => {
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
    const result = extrudeRegion(cage, "face", [String(first), String(second)], new Vector3(0, 1, 0));
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
    const fin = extrudeRegion(cube, "edge", [edgeKey(interior.from, interior.to)], new Vector3(0, 1, 0));
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
    const written = writeShadedGeometry(source, result.mesh);
    const position = written.getAttribute("position");
    const normal = written.getAttribute("normal");
    const index = written.getIndex();
    if (!index) throw new Error("Missing index");
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      const pa = new Vector3().fromBufferAttribute(position, a);
      const face = new Vector3().fromBufferAttribute(position, b).sub(pa).cross(new Vector3().fromBufferAttribute(position, c).sub(pa)).normalize();
      for (const vertex of [a, b, c]) expect(new Vector3().fromBufferAttribute(normal, vertex).dot(face)).toBeGreaterThan(0.99);
    }
    const sphere = new SphereGeometry(1, 8, 6);
    expect(hardCageVertices(sphere, readTopology(sphere)).size).toBe(0);
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

describe("extrude command", () => {
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
