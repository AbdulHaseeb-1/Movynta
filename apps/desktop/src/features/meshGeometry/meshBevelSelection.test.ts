import { describe, expect, it } from "vitest";
import { BoxGeometry, IcosahedronGeometry, PlaneGeometry, Scene } from "three";
import { EditorScene } from "../assistant/EditorScene";
import { bevelSurface, prepareBevelPreview } from "./meshBevel";
import { assertManifold, faceNormal, readTopology, topology } from "./meshTopology";

describe("selected edge bevel", () => {
  it("bevels one cube edge while keeping the surface closed", () => {
    const mesh = readTopology(new BoxGeometry(2, 2, 2));
    const graph = topology(mesh);
    const edge = [...graph.edges].find(([, faces]) => {
      const [a, b] = faces;
      const first = a && mesh.faces[a.face]; const second = b && mesh.faces[b.face];
      return first && second && faceNormal(mesh, first).dot(faceNormal(mesh, second)) < 0.5;
    });
    if (!edge) throw new Error("Missing cube crease");
    const result = bevelSurface(mesh, 0.1, 3, "circular", 0, [edge[0]]);
    expect(result.faces.length).toBeGreaterThan(mesh.faces.length);
    expect(() => assertManifold(result, topology(result), true)).not.toThrow();
    const samples = 30; const start = performance.now();
    for (let i = 0; i < samples; i += 1) bevelSurface(mesh, 0.1, 3, "circular", 0, [edge[0]]);
    // eslint-disable-next-line no-console -- Records selected-edge preview geometry timing.
    console.info(JSON.stringify({ samples, selectedBevelMeanMs: (performance.now() - start) / samples }));
  });

  it("rejects missing, repeated and boundary edges", () => {
    const mesh = readTopology(new PlaneGeometry());
    const boundary = [...topology(mesh).edges].find(([, edges]) => edges.length === 1)?.[0];
    if (!boundary) throw new Error("Missing boundary edge");
    expect(() => bevelSurface(mesh, 0.1, 1, "round", 0, [boundary])).toThrow(/boundary/);
    expect(() => bevelSurface(mesh, 0.1, 1, "round", 0, ["999_1000"])).toThrow(/does not exist/);
    expect(() => bevelSurface(mesh, 0.1, 1, "round", 0, [boundary, boundary])).toThrow(/distinct/);
  });

  it("handles connected and disconnected cube crease selections", () => {
    const mesh = readTopology(new BoxGeometry(2, 2, 2));
    const creases = [...topology(mesh).edges].filter(([, sides]) => {
      const a = sides[0] && mesh.faces[sides[0].face]; const b = sides[1] && mesh.faces[sides[1].face];
      return a && b && faceNormal(mesh, a).dot(faceNormal(mesh, b)) < 0.5;
    }).map(([id]) => id);
    const first = creases[0]; if (!first) throw new Error("Missing crease");
    const vertices = first.split("_");
    const connected = creases.find((id) => id !== first && id.split("_").some((vertex) => vertices.includes(vertex)));
    const disconnected = creases.find((id) => id.split("_").every((vertex) => !vertices.includes(vertex)));
    if (!connected || !disconnected) throw new Error("Missing crease pair");
    for (const other of [connected, disconnected]) {
      for (const trim of [false, true]) {
        const result = bevelSurface(mesh, 0.1, 3, "circular", 0, [first, other], trim);
        expect(() => assertManifold(result, topology(result), true)).not.toThrow();
      }
    }
  });

  it("reports a partially selected collinear crease as unsupported", () => {
    const mesh = readTopology(new BoxGeometry(2, 2, 2, 10, 10, 10));
    const edge = [...topology(mesh).edges].find(([, sides]) => {
      const a = sides[0] && mesh.faces[sides[0].face]; const b = sides[1] && mesh.faces[sides[1].face];
      return a && b && faceNormal(mesh, a).dot(faceNormal(mesh, b)) < 0.5;
    })?.[0];
    if (!edge) throw new Error("Missing crease");
    expect(() => bevelSurface(mesh, 0.01, 3, "circular", 0, [edge])).toThrow(/full straight run/);
  });

  it("benchmarks crease selection on a more detailed box", () => {
    const mesh = readTopology(new BoxGeometry(2, 2, 2, 10, 10, 10));
    const edges = [...topology(mesh).edges].filter(([, sides]) => {
      const a = sides[0] && mesh.faces[sides[0].face]; const b = sides[1] && mesh.faces[sides[1].face];
      return a && b && faceNormal(mesh, a).dot(faceNormal(mesh, b)) < 0.5;
    }).map(([id]) => id);
    const samples = 10; const start = performance.now();
    for (let i = 0; i < samples; i += 1) bevelSurface(mesh, 0.01, 3, "circular", 0, edges);
    // eslint-disable-next-line no-console -- Records selected-edge preview geometry timing.
    console.info(JSON.stringify({ faces: mesh.faces.length, vertices: mesh.positions.length, edges: edges.length, samples, selectedBevelMeanMs: (performance.now() - start) / samples }));
  });

  it("benchmarks a selected edge on a dense triangulated mesh", () => {
    const mesh = readTopology(new IcosahedronGeometry(2, 8));
    const edge = [...topology(mesh).edges.keys()][0];
    if (!edge) throw new Error("Missing edge");
    const samples = 5; const start = performance.now();
    for (let i = 0; i < samples; i += 1) bevelSurface(mesh, 0.001, 3, "circular", 0, [edge]);
    const directMeanMs = (performance.now() - start) / samples;
    const preview = prepareBevelPreview(mesh, [edge]);
    const expected = bevelSurface(mesh, 0.001, 3, "circular", 0, [edge], true);
    expect(preview(0.001, 3)).toEqual(expected);
    expect(preview(0.002, 4)).toEqual(bevelSurface(mesh, 0.002, 4, "circular", 0, [edge], true));
    const previewStart = performance.now();
    for (let i = 0; i < samples; i += 1) preview(0.001, 3);
    const previewMeanMs = (performance.now() - previewStart) / samples;
    const smoothStart = performance.now();
    for (let i = 0; i < samples; i += 1) preview(0.001, 32);
    // eslint-disable-next-line no-console -- Records selected-edge preview geometry timing.
    console.info(JSON.stringify({ faces: mesh.faces.length, vertices: mesh.positions.length, samples, directMeanMs, previewMeanMs, smoothPreviewMeanMs: (performance.now() - smoothStart) / samples }));
  });

  it("trims the planar end faces instead of overlaying them with bevel caps", () => {
    const mesh = readTopology(new BoxGeometry(2, 2, 2));
    const edge = [...topology(mesh).edges].find(([, sides]) => {
      const a = sides[0] && mesh.faces[sides[0].face]; const b = sides[1] && mesh.faces[sides[1].face];
      return a && b && faceNormal(mesh, a).dot(faceNormal(mesh, b)) < 0.5;
    });
    if (!edge) throw new Error("Missing cube edge");
    for (const segments of [1, 3, 8, 32]) {
      const result = bevelSurface(mesh, 0.2, segments, "circular", 0, [edge[0]], true);
      expect(() => assertManifold(result, topology(result), true)).not.toThrow();
      for (const vertex of edge[0].split("_").map(Number)) {
        const original = mesh.positions[vertex];
        if (!original) throw new Error("Missing endpoint");
        expect(result.positions.some((point) => point.distanceToSquared(original) < 1e-20)).toBe(false);
      }
      expect(result.faces).toHaveLength(mesh.faces.length + segments);
    }
    // Legacy histories intentionally retain their original topology.
    expect(bevelSurface(mesh, 0.2, 3, "circular", 0, [edge[0]]).faces.length).toBeGreaterThan(mesh.faces.length + 3);
  });

  it("replays a selected-edge bevel from saved commands", async () => {
    const scene = new EditorScene(new Scene(), "project");
    const create = { commandId: "box", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 2, replaceExisting: false };
    expect(scene.execute("create", 0, [create]).status).toBe("applied");
    const inspection = scene.context({ objectId: "box", meshPath: [], offset: 0, limit: 100 }).meshInspection;
    const edge = inspection?.edges?.find((item) => item.faces.length === 2);
    if (!edge) throw new Error("Missing cube edge");
    const bevel = { commandId: "bevel", type: "geometry.bevel_edges", objectId: "box", ids: [edge.vertices.slice().sort((a, b) => a - b).join("_")], width: 0.1, segments: 32, profile: "circular", trimEndFaces: true };
    expect(scene.execute("bevel", 1, [bevel]).status).toBe("applied");
    const replay = new EditorScene(new Scene(), "project");
    await replay.restore([{ kind: "commands", proposalId: "create", commands: [create] }, { kind: "commands", proposalId: "bevel", commands: [bevel] }], () => Promise.reject(new Error("Unexpected import")));
    const request = { objectId: "box", meshPath: [], offset: 0, limit: 100 };
    expect(replay.context(request).meshInspection).toEqual(scene.context(request).meshInspection);
  });
});
