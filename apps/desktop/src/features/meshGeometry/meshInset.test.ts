import { describe, expect, it } from "vitest";
import { BoxGeometry, Scene } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { insetFaces } from "./meshInset";
import { writeExtrudedGeometry } from "./meshExtrude";
import { createPolygonMesh } from "./createPolygonMesh";
import { assertManifold, point, readTopology, topology } from "./meshTopology";

const sheet = () => createPolygonMesh(
  [[0, 0, 0], [2, 0, 0], [4, 0, 0], [0, 2, 0], [2, 2, 0], [4, 2, 0]],
  [[0, 1, 4, 3], [1, 2, 5, 4]],
);

describe("face inset", () => {
  it("creates one even border around connected faces, or one border per face", () => {
    const geometry = sheet();
    const cage = readTopology(geometry);
    const region = insetFaces(cage, ["0", "1"], { thickness: 0.25, selectOuter: true });
    expect(region.selection).toHaveLength(6);
    const individual = insetFaces(cage, ["0", "1"], { thickness: 0.25, individual: true });
    expect(individual.mesh.faces).toHaveLength(10);
    const written = writeExtrudedGeometry(geometry, region);
    expect(readTopology(written).faces).toHaveLength(8);
  });

  it("slides along open edges when Boundary is off and outsets into adjacent faces", () => {
    const cage = readTopology(sheet());
    const region = insetFaces(cage, ["0"], { thickness: 0.25, boundary: false });
    expect(region.mesh.faces).toHaveLength(3);
    const outset = insetFaces(cage, ["0"], { thickness: 0.25, outset: true });
    expect(outset.mesh.faces[0]).toEqual(cage.faces[0]);
    expect(outset.mesh.faces[1]).not.toEqual(cage.faces[1]);
    expect(outset.mesh.faces).toHaveLength(3);
  });

  it("creates complete individual borders even when Boundary is disabled", () => {
    const cage = readTopology(sheet());
    const inset = insetFaces(cage, ["0"], { thickness: 0.25, individual: true, boundary: false });
    expect(inset.mesh.faces).toHaveLength(6);
    expect(() => assertManifold(inset.mesh, topology(inset.mesh))).not.toThrow();
  });

  it("supports depth on a closed mesh and rejects offsets that collapse the face", () => {
    const cage = readTopology(new BoxGeometry(2, 2, 2));
    const result = insetFaces(cage, ["0"], { thickness: 0.25, depth: -0.4 });
    const cap = result.mesh.faces[0] ?? [];
    for (const vertex of cap) {
      const position = point(result.mesh, vertex);
      expect(position.x).toBeCloseTo(0.6);
      expect(Math.abs(position.y)).toBeCloseTo(0.75);
      expect(Math.abs(position.z)).toBeCloseTo(0.75);
    }
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
    expect(() => insetFaces(cage, ["0"], { thickness: 1.2 })).toThrow("too large");
  });

  it("rejects an inset that overlaps the arms of a concave face", () => {
    const geometry = createPolygonMesh(
      [[0, 0, 0], [4, 0, 0], [4, 4, 0], [3, 4, 0], [3, 1, 0], [1, 1, 0], [1, 4, 0], [0, 4, 0]],
      [[0, 1, 2, 3, 4, 5, 6, 7]],
    );
    const cage = readTopology(geometry);
    expect(() => {
      const result = insetFaces(cage, ["0"], { thickness: 0.6 });
      writeExtrudedGeometry(geometry, result);
    }).toThrow();
  });

  it("applies even and relative offsets and interpolates the new corner attributes", () => {
    const cage = readTopology(sheet());
    const even = insetFaces(cage, ["0"], { thickness: 0.2 }).mesh;
    const uneven = insetFaces(cage, ["0"], { thickness: 0.2, offsetEven: false }).mesh;
    const relative = insetFaces(cage, ["0"], { thickness: 0.2, offsetRelative: true, interpolate: false }).mesh;
    expect(point(even, even.faces[0]?.[0]).x).toBeCloseTo(0.2);
    expect(point(uneven, uneven.faces[0]?.[0]).x).toBeCloseTo(0.2 / Math.sqrt(2));
    expect(point(relative, relative.faces[0]?.[0]).x).toBeCloseTo(0.4);
    expect(even.channels?.corners[0]?.[0]?.size).toBeGreaterThan(1);
    expect(relative.channels?.corners[0]?.[0]?.size).toBe(1);
  });

  it("scales relative offsets using inset edges when open boundaries are excluded", () => {
    const cage = readTopology(createPolygonMesh(
      [[0, 0, 0], [2, 0, 0], [4, 0, 0], [0, 4, 0], [2, 4, 0], [4, 4, 0]],
      [[0, 1, 4, 3], [1, 2, 5, 4]],
    ));
    const result = insetFaces(cage, ["0"], { thickness: 0.1, boundary: false, offsetRelative: true }).mesh;
    expect(point(result, result.faces[0]?.[1]).x).toBeCloseTo(1.6);
    expect(point(result, result.faces[0]?.[2]).x).toBeCloseTo(1.6);
  });

  it("propagates relative depth to interior vertices of a connected region", () => {
    const cage = readTopology(createPolygonMesh(
      [[0, 0, 0], [2, 0, 0], [4, 0, 0], [0, 2, 0], [2, 2, 0], [4, 2, 0], [0, 4, 0], [2, 4, 0], [4, 4, 0]],
      [[0, 1, 4, 3], [1, 2, 5, 4], [3, 4, 7, 6], [4, 5, 8, 7]],
    ));
    const result = insetFaces(cage, ["0", "1", "2", "3"], { thickness: 0.1, depth: 0.2, offsetRelative: true }).mesh;
    expect(point(result, result.faces[0]?.[2]).z).toBeCloseTo(0.4);
  });

  it("slides new corners along existing interior edges with Edge Rail enabled", () => {
    const cage = readTopology(createPolygonMesh(
      [[0, 0, 0], [2, 0, 0], [4, 0, 0], [0, 2, 0], [2.5, 2, 0], [4, 2, 0]],
      [[0, 1, 4, 3], [1, 2, 5, 4]],
    ));
    const free = insetFaces(cage, ["0", "1"], { thickness: 0.2 }).mesh;
    const railed = insetFaces(cage, ["0", "1"], { thickness: 0.2, edgeRail: true }).mesh;
    expect(point(free, free.faces[0]?.[2]).x).toBeCloseTo(2.5);
    expect(point(railed, railed.faces[0]?.[2]).x).toBeCloseTo(2.45);
  });

  it("replays an inset through the editor history", async () => {
    const scene = new EditorScene(new Scene(), "project");
    const create = { commandId: "box", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 2, replaceExisting: false };
    const inset = { commandId: "inset", type: "geometry.inset_faces", objectId: "box", ids: ["0"], thickness: 0.2, depth: -0.1 };
    expect(scene.execute("create", 0, [create]).status).toBe("applied");
    expect(scene.execute("inset", 1, [inset]).status).toBe("applied");
    const replay = new EditorScene(new Scene(), "project");
    await replay.restore([
      { kind: "commands", proposalId: "create", commands: [create] },
      { kind: "commands", proposalId: "inset", commands: [inset] },
    ], () => Promise.reject(new Error("Unexpected import")));
    const request = { objectId: "box", meshPath: [], offset: 0, limit: 25 };
    expect(replay.context(request).meshInspection).toEqual(scene.context(request).meshInspection);
  });
});
