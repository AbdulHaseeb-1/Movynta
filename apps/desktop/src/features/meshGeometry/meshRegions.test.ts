import { describe, expect, it } from "vitest";
import { BoxGeometry, CylinderGeometry, Mesh, Scene, SphereGeometry, Vector3, type Object3D } from "three";
import { meshInspectionSchema } from "@movynta/editor-protocol";
import { EditorScene } from "../assistant/EditorScene";
import { createPolygonMesh } from "./createPolygonMesh";
import { inspectMesh } from "./meshInspection";
import { boundaryLoops, shellRoots, shellSummaries } from "./meshRegions";
import { readTopology, topology } from "./meshTopology";

const request = { objectId: "body", meshPath: [] as never[], offset: 0, limit: 25, view: "base" as const };
function isMesh(object: Object3D | undefined): object is Mesh { return object instanceof Mesh; }

/** Two open tubes, one above the other: four openings, two shells. */
function tubes(sides = 6) {
  const ring = (y: number) => Array.from({ length: sides }, (_, i) => [Math.cos((i / sides) * 2 * Math.PI), y, Math.sin((i / sides) * 2 * Math.PI)]);
  const band = (at: number) => Array.from({ length: sides }, (_, i) => [at + i, at + ((i + 1) % sides), at + sides + ((i + 1) % sides), at + sides + i]);
  return createPolygonMesh([...ring(0), ...ring(1), ...ring(2), ...ring(3)], [...band(0), ...band(2 * sides)]);
}

describe("openings and shells", () => {
  it("finds the openings of a mesh as closed loops of boundary edges", () => {
    const cage = readTopology(tubes(6)), { loops, irregular } = boundaryLoops(topology(cage));
    expect(loops).toHaveLength(4);
    expect(irregular).toBe(0);
    for (const loop of loops) {
      expect(loop.edges).toHaveLength(6);
      expect(new Set(loop.edges).size).toBe(6);
      // Each edge joins two consecutive vertices of the walk.
      loop.edges.forEach((edge, i) => {
        const a = loop.vertices[i] ?? -1, b = loop.vertices[(i + 1) % loop.vertices.length] ?? -1;
        expect(edge).toBe(a < b ? `${a}_${b}` : `${b}_${a}`);
      });
    }
    expect(boundaryLoops(topology(readTopology(new BoxGeometry()))).loops).toHaveLength(0);
  });

  it("counts boundary edges it cannot walk as a simple loop", () => {
    // Two squares that touch at one corner. The editor refuses to hold such a mesh as a cage, but an import can have one.
    const positions = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 1, 0], [2, 2, 0], [1, 2, 0]].map(([x = 0, y = 0, z = 0]) => new Vector3(x, y, z));
    const bowtie = { positions, faces: [[0, 1, 2, 3], [2, 4, 5, 6]] };
    const result = boundaryLoops(topology(bowtie));
    expect(result.loops).toHaveLength(0);
    expect(result.irregular).toBe(8);
    expect(() => createPolygonMesh(positions.map((p) => p.toArray()), bowtie.faces)).toThrow("non-manifold");
  });

  it("summarizes shells by lowest face with their size, extent and whether they enclose a volume", () => {
    const cage = readTopology(tubes(6)), graph = topology(cage), shells = shellSummaries(cage, graph);
    expect(shells).toHaveLength(2);
    expect(shells.map((shell) => [shell.firstFace, shell.faceCount, shell.closed])).toEqual([[0, 6, false], [6, 6, false]]);
    expect(shells[1]?.min[1]).toBeCloseTo(2, 6);
    expect(shells[1]?.max[1]).toBeCloseTo(3, 6);
    expect(shells[0]?.center[1]).toBeCloseTo(0.5, 6);
    const sphere = readTopology(new SphereGeometry(1, 8, 6));
    expect(shellSummaries(sphere, topology(sphere))).toMatchObject([{ closed: true, faceCount: sphere.faces.length, firstFace: 0 }]);
    expect(new Set(shellRoots(cage)).size).toBe(2);
  });
});

describe("inspect_mesh openings and shells", () => {
  it("returns them in the response shape, with paging", () => {
    const mesh = new Mesh(tubes(6));
    const result = inspectMesh(mesh, { ...request, includeSamples: false, openings: { limit: 3 }, shells: {} });
    expect(result.status).toBe("ok");
    expect(() => meshInspectionSchema.parse(result)).not.toThrow();
    expect(result.openings).toMatchObject({ total: 4, offset: 0, hasMore: true, irregularEdges: 0 });
    expect(result.openings?.loops).toHaveLength(3);
    expect(result.openings?.loops[0]).toMatchObject({ edgeCount: 6, truncated: false });
    expect(result.openings?.loops[0]?.edges).toHaveLength(6);
    expect(result.shells).toMatchObject({ total: 2, hasMore: false });
    const page = inspectMesh(mesh, { ...request, includeSamples: false, openings: { offset: 3, limit: 3 } });
    expect(page.openings).toMatchObject({ total: 4, offset: 3, hasMore: false });
    expect(page.openings?.loops).toHaveLength(1);
    expect(inspectMesh(mesh, request).openings).toBeUndefined();
  });

  it("lists at most 256 edges of a long loop and says it did not list them all", () => {
    const mesh = new Mesh(new CylinderGeometry(1, 1, 2, 300, 1, true));
    const loop = inspectMesh(mesh, { ...request, includeSamples: false, openings: { limit: 1 } }).openings?.loops[0];
    expect(loop).toMatchObject({ edgeCount: 300, truncated: true });
    expect(loop?.edges).toHaveLength(256);
  });

  it("gives the assistant IDs that fill_hole and bridge_edge_loops accept as they are", () => {
    const scene = new EditorScene(new Scene(), "project");
    scene.importObject("body", new Mesh(tubes(6)));
    const read = () => { const object = scene.getObject("body"); if (!isMesh(object)) throw new Error("Missing mesh"); return inspectMesh(object, { ...request, includeSamples: false, openings: {}, shells: {} }); };
    const first = read();
    const loops = first.openings?.loops ?? [];
    // The inner pair of openings face each other: they have the middle heights.
    const middle = loops.filter((loop) => (loop.center[1] ?? 0) > 0.9 && (loop.center[1] ?? 0) < 2.1);
    expect(middle).toHaveLength(2);
    const bridged = scene.execute("bridge", scene.currentRevision, [{ commandId: "b", type: "geometry.bridge_edge_loops", objectId: "body", ids: middle.flatMap((loop) => loop.edges) }]);
    expect(bridged.status).toBe("applied");
    const after = read();
    expect(after.openings?.total).toBe(2);
    expect(after.shells?.total).toBe(1);
    // Close one end with the loop the inspection reported, exactly as returned.
    const end = after.openings?.loops[0];
    const closed = scene.execute("fill", scene.currentRevision, [{ commandId: "f", type: "geometry.fill_hole", objectId: "body", ids: end?.edges ?? [] }]);
    expect(closed.status).toBe("applied");
    expect(read().openings?.total).toBe(1);
  });

  it("names a shell by a face that flip_normals accepts", () => {
    const scene = new EditorScene(new Scene(), "project");
    scene.importObject("body", new Mesh(tubes(6)));
    const object = scene.getObject("body");
    if (!isMesh(object)) throw new Error("Missing mesh");
    const upper = inspectMesh(object, { ...request, includeSamples: false, shells: {} }).shells?.shells[1];
    expect(upper?.firstFace).toBe(6);
    const flipped = scene.execute("flip", scene.currentRevision, [{ commandId: "f", type: "geometry.flip_normals", objectId: "body", ids: [String(upper?.firstFace)] }]);
    expect(flipped.status).toBe("applied");
    const cage = readTopology(object.geometry);
    expect(cage.faces).toHaveLength(12);
  });
});
