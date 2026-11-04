import { describe, expect, it } from "vitest";
import { BoxGeometry, Mesh, Scene, Vector3 } from "three";
import { EditorScene } from "../assistant/EditorScene";
import { writeShadedGeometry } from "./meshOutput";
import { subdivideFaces } from "./meshSubdivideFaces";
import { assertManifold, faceNormal, point, readTopology, topology, type PolygonMesh } from "./meshTopology";

function topFace(mesh: PolygonMesh): number {
  const index = mesh.faces.findIndex((face) => faceNormal(mesh, face).y > 0.9);
  if (index < 0) throw new Error("No top face");
  return index;
}
/** Area of a planar polygon, from a fan of triangles. */
function faceArea(mesh: PolygonMesh, face: readonly number[]): number {
  const origin = point(mesh, face[0]);
  let area = 0;
  for (let i = 1; i + 1 < face.length; i += 1) {
    const b = point(mesh, face[i]).clone().sub(origin);
    const c = point(mesh, face[i + 1]).clone().sub(origin);
    area += b.cross(c).length() / 2;
  }
  return area;
}

describe("subdivide selected faces", () => {
  it("splits one face of a closed cube and keeps the cube closed", () => {
    const cube = readTopology(new BoxGeometry(2, 2, 2));
    const result = subdivideFaces(cube, [String(topFace(cube))]);
    // Four quads from the selected face, the four neighbours with one midpoint each, and the untouched bottom.
    expect(result.mesh.faces).toHaveLength(9);
    expect(result.selection).toHaveLength(4);
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
  });

  it("leaves the original vertices in place and adds only the shared midpoints and the centre", () => {
    const cube = readTopology(new BoxGeometry(2, 2, 2));
    const result = subdivideFaces(cube, [String(topFace(cube))]);
    expect(result.mesh.positions).toHaveLength(8 + 4 + 1);
    for (let i = 0; i < 8; i += 1) expect(point(result.mesh, i).equals(point(cube, i))).toBe(true);
    const centre = result.mesh.positions[result.mesh.positions.length - 1];
    expect(centre?.y).toBeCloseTo(1);
  });

  it("subdivides adjacent selected faces without leaving a T-junction", () => {
    const cube = readTopology(new BoxGeometry(2, 2, 2));
    const graph = topology(cube);
    const shared = [...graph.edges.values()].find((incident) => incident.length === 2);
    const first = shared?.[0]?.face;
    const second = shared?.[1]?.face;
    if (first === undefined || second === undefined) throw new Error("Missing adjacent faces");
    const result = subdivideFaces(cube, [String(first), String(second)]);
    expect(result.selection).toHaveLength(8);
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
  });

  it("keeps the area and writes the result: quads triangulate into the expected triangle count", () => {
    const source = new BoxGeometry(2, 2, 2);
    const cube = readTopology(source);
    const result = subdivideFaces(cube, [String(topFace(cube))]);
    const written = writeShadedGeometry(source, result.mesh);
    // Four quads (2 triangles each), four pentagons (3 each) and the bottom quad (2).
    expect(written.getIndex()?.count).toBe((8 + 12 + 2) * 3);
    const top = result.selection.reduce((sum, id) => sum + faceArea(result.mesh, result.mesh.faces[Number(id)] ?? []), 0);
    expect(top).toBeCloseTo(4);
  });

  it("splits a concave selected face into convex quads that cover the same area", () => {
    const shape: PolygonMesh = {
      positions: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]].map(([x, y]) => new Vector3(x, y, 0)),
      faces: [[0, 1, 2, 3, 4, 5]],
    };
    const result = subdivideFaces(shape, ["0"]);
    // The L-shape has four triangles, and each becomes three quads.
    expect(result.selection).toHaveLength(12);
    const area = result.selection.reduce((sum, id) => sum + faceArea(result.mesh, result.mesh.faces[Number(id)] ?? []), 0);
    expect(area).toBeCloseTo(3);
  });

  it("rejects a face that does not exist and an empty selection", () => {
    const cube = readTopology(new BoxGeometry(2, 2, 2));
    expect(() => subdivideFaces(cube, ["99"])).toThrow(/Unknown face/);
    expect(() => subdivideFaces(cube, [])).toThrow();
  });
});

describe("subdivide faces command", () => {
  it("subdivides only the selected face of an object, and the selection names the new quads", () => {
    const scene = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    scene.importObject("box", mesh);
    const top = topFace(readTopology(mesh.geometry));
    const applied = scene.execute("subdivide", scene.currentRevision, [{ commandId: "sub", type: "geometry.subdivide_faces", objectId: "box", ids: [String(top)] }]);
    expect(applied.status).toBe("applied");
    expect(readTopology(mesh.geometry).faces).toHaveLength(9);
  });

  it("refuses the command while a modifier is enabled, so the selection matches the base mesh", () => {
    const scene = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    scene.importObject("box", mesh);
    const modified = scene.execute("first", scene.currentRevision, [{ commandId: "bevel", type: "geometry.bevel", objectId: "box", width: 0.1 }]);
    expect(modified.status).toBe("applied");
    const refused = scene.execute("second", scene.currentRevision, [{ commandId: "sub", type: "geometry.subdivide_faces", objectId: "box", ids: ["0"] }]);
    expect(refused.status).toBe("failed");
    if (refused.status === "failed") expect(refused.message).toContain("Disable modifiers");
  });
});
