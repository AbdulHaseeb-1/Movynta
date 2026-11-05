import { describe, expect, it } from "vitest";
import { BoxGeometry, Float32BufferAttribute, Mesh, Scene } from "three";
import { createPolygonMesh } from "./createPolygonMesh";
import { mergeVertices } from "./meshMerge";
import { dissolveEdges } from "./meshDissolve";
import { slideEdges } from "./meshSlide";
import { loopCut } from "./meshLoopCut";
import { assertManifold, channels, point, readTopology, topology } from "./meshTopology";
import { writeExtrudedGeometry } from "./meshExtrude";
import { EditorScene } from "../assistant/EditorScene";

function grid(width = 2, height = 2) {
  const vertices: number[][] = [], faces: number[][] = [];
  for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) vertices.push([x, y, 0]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = y * (width + 1) + x; faces.push([a, a + 1, a + width + 2, a + width + 1]);
  }
  const source = createPolygonMesh(vertices, faces);
  const mesh = readTopology(source);
  return { source, mesh };
}
const internal = (mesh: ReturnType<typeof readTopology>) => [...topology(mesh).edges].filter(([, half]) => half.length === 2).map(([id]) => id);

describe("merge vertices", () => {
  it.each(["center", "first", "last"] as const)("collapses a cube edge to %s and keeps a closed manifold", (mode) => {
    const source = new BoxGeometry(), mesh = readTopology(source);
    const edge = [...topology(mesh).edges.keys()][0]; if (!edge) throw new Error("Missing edge");
    const ids = edge.split("_"), vertices = ids.map(Number);
    const a = point(mesh, vertices[0]), b = point(mesh, vertices[1]);
    const expected = mode === "center" ? a.clone().add(b).multiplyScalar(0.5) : mode === "first" ? a : b;
    const result = mergeVertices(mesh, ids, mode);
    expect(result.mesh.positions).toHaveLength(mesh.positions.length - 1);
    expect(point(result.mesh, Number(result.selection[0])).distanceTo(expected)).toBeLessThan(1e-10);
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
    const output = writeExtrudedGeometry(source, result);
    expect(output.getAttribute("uv")).toBeDefined(); output.dispose(); source.dispose();
  });
  it("rejects duplicate, unknown, pinching and disappearing selections without modifying input", () => {
    const { source, mesh } = grid(1, 1), before = mesh.positions.map((p) => p.toArray());
    expect(() => mergeVertices(mesh, ["0", "0"], "center")).toThrow();
    expect(() => mergeVertices(mesh, ["0", "99"], "center")).toThrow();
    const face = mesh.faces[0] ?? [];
    expect(() => mergeVertices(mesh, [String(face[0]), String(face[2])], "center")).toThrow("pinch");
    expect(() => mergeVertices(mesh, face.map(String), "center")).toThrow();
    expect(mesh.positions.map((p) => p.toArray())).toEqual(before); source.dispose();
  });
});

describe("dissolve edges", () => {
  it("dissolves a planar region, removes unused vertices and retains affine UVs", () => {
    const { source, mesh } = grid();
    const position = source.getAttribute("position");
    source.setAttribute("uv", new Float32BufferAttribute(Array.from({ length: position.count }, (_, i) => [position.getX(i) / 2, position.getY(i) / 2]).flat(), 2));
    const result = dissolveEdges(mesh, internal(mesh), source);
    expect(result.mesh.faces).toHaveLength(1);
    expect(result.mesh.positions).toHaveLength(8);
    const output = writeExtrudedGeometry(source, result);
    const uv = output.getAttribute("uv"), out = output.getAttribute("position");
    for (let i = 0; i < uv.count; i++) { expect(uv.getX(i)).toBeCloseTo(out.getX(i) / 2); expect(uv.getY(i)).toBeCloseTo(out.getY(i) / 2); }
    output.dispose(); source.dispose();
  });
  it("rejects boundary edges, nonplanar faces, material boundaries and UV seams", () => {
    const { source, mesh } = grid(2, 1);
    const ids = internal(mesh), edge = ids[0]; if (!edge) throw new Error("Missing internal edge");
    expect(() => dissolveEdges(mesh, ["0_1"], source)).toThrow("internal");
    const data = channels(mesh);
    expect(() => dissolveEdges({ ...mesh, channels: { ...data, materials: [0, 1] } }, ids, source)).toThrow("material");
    const bent = { ...mesh, positions: mesh.positions.map((p) => p.clone()) };
    const boundary = (mesh.faces[1] ?? []).find((v) => !edge.split("_").includes(String(v)));
    if (boundary === undefined) throw new Error("Missing boundary vertex");
    point(bent, boundary).z = 1;
    expect(() => dissolveEdges(bent, ids, source)).toThrow("coplanar");
    const pos = source.getAttribute("position"), uv = new Float32BufferAttribute(Array.from({ length: pos.count }, (_, i) => [pos.getX(i), pos.getY(i)]).flat(), 2);
    source.setAttribute("uv", uv);
    const sample = data.corners[0]?.[1]?.keys().next().value;
    if (sample === undefined) throw new Error("Missing UV sample");
    uv.setX(sample, 100);
    expect(() => dissolveEdges(mesh, ids, source)).toThrow(/seam|detail/); source.dispose();
  });
  it("refuses removal of non-affine attribute detail even when shared samples agree", () => {
    const { source, mesh } = grid(); const position = source.getAttribute("position");
    source.setAttribute("uv", new Float32BufferAttribute(Array.from({ length: position.count }, (_, i) => [position.getX(i) * position.getY(i), position.getY(i)]).flat(), 2));
    expect(() => dissolveEdges(mesh, internal(mesh), source)).toThrow("detail"); source.dispose();
  });
});

describe("edge slide", () => {
  it("slides a shared edge along explicit neighboring rails", () => {
    const { source, mesh } = grid(2, 1); const ids = internal(mesh), edge = ids[0];
    if (!edge) throw new Error("Missing edge");
    const rails = edge.split("_").map((id) => {
      const vertex = Number(id), target = mesh.positions.findIndex((p) => p.x === 2 && p.y === point(mesh, vertex).y);
      return { vertex: id, toward: String(target) };
    });
    const result = slideEdges(mesh, ids, rails, 0.25);
    for (const rail of rails) expect(point(result.mesh, Number(rail.vertex)).x).toBeCloseTo(1.25);
    expect(result.mesh.faces).toBe(mesh.faces);
    expect(result.mesh.channels).toBe(mesh.channels);
    expect(() => slideEdges(mesh, ids, rails, 1)).toThrow();
    expect(() => slideEdges(mesh, ids, rails.slice(1), 0.2)).toThrow();
    expect(() => slideEdges(mesh, ids, rails.map((rail) => ({ ...rail, toward: rail.vertex })), 0.2)).toThrow(); source.dispose();
  });
});

describe("loop cut", () => {
  it.each([1, 3])("cuts a closed cube ring with %i cuts without opening the mesh", (cuts) => {
    const source = new BoxGeometry(), mesh = readTopology(source), seed = topology(mesh).edges.keys().next().value;
    if (!seed) throw new Error("Missing seed");
    const result = loopCut(mesh, seed, cuts);
    expect(result.mesh.faces).toHaveLength(6 + 4 * cuts);
    expect(result.mesh.positions).toHaveLength(8 + 4 * cuts);
    expect(result.selection).toHaveLength(4 * cuts);
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
    const output = writeExtrudedGeometry(source, result);
    expect(output.getAttribute("uv")).toBeDefined(); output.dispose(); source.dispose();
  });
  it("cuts an open quad strip at an offset and interpolates face UVs", () => {
    const { source, mesh } = grid(2, 1), pos = source.getAttribute("position");
    source.setAttribute("uv", new Float32BufferAttribute(Array.from({ length: pos.count }, (_, i) => [pos.getX(i), pos.getY(i)]).flat(), 2));
    const seed = [...topology(mesh).edges.keys()].find((key) => key.split("_").every((id) => point(mesh, Number(id)).x === 0));
    if (!seed) throw new Error("Missing boundary seed");
    const result = loopCut(mesh, seed, 1, 0.25);
    expect(result.mesh.faces).toHaveLength(4);
    const ys = result.mesh.positions.slice(mesh.positions.length).map((p) => p.y);
    const firstY = ys[0]; if (firstY === undefined) throw new Error("Missing cut vertices");
    expect(ys.every((y) => Math.abs(y - firstY) < 1e-10)).toBe(true);
    expect(Math.min(ys[0] ?? 0, 1 - (ys[0] ?? 0))).toBeCloseTo(0.25);
    const out = writeExtrudedGeometry(source, result), uv = out.getAttribute("uv"), p = out.getAttribute("position");
    for (let i = 0; i < uv.count; i++) { expect(uv.getX(i)).toBeCloseTo(p.getX(i)); expect(uv.getY(i)).toBeCloseTo(p.getY(i)); }
    out.dispose(); source.dispose();
  });
  it("rejects triangle interruptions and invalid factors", () => {
    const source = createPolygonMesh([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]]), mesh = readTopology(source);
    expect(() => loopCut(mesh, "0_1", 1)).toThrow("quad");
    expect(() => loopCut(mesh, "1_0", 1)).toThrow("canonical");
    expect(() => loopCut(mesh, "0_1", 2, 0.2)).toThrow("even spacing"); source.dispose();
  });
  it("keeps UV seams and per-face material IDs across a cut ring", () => {
    const { source, mesh } = grid(2, 1), data = channels(mesh), position = source.getAttribute("position");
    const uv = new Float32BufferAttribute(new Float32Array(position.count * 2), 2);
    data.corners.forEach((corners, face) => corners.forEach((sample) => {
      const index = sample.keys().next().value;
      if (index === undefined) throw new Error("Missing corner sample");
      uv.setXY(index, position.getX(index) + face * 10, position.getY(index));
    }));
    source.setAttribute("uv", uv);
    const edged = { ...mesh, channels: { ...data, materials: [2, 5] } };
    const result = loopCut(edged, "0_3", 1);
    const output = writeExtrudedGeometry(source, result), p = output.getAttribute("position"), resultUv = output.getAttribute("uv");
    const shared = new Set<number>();
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - 1) < 1e-6 && Math.abs(p.getY(i) - 0.5) < 1e-6) shared.add(resultUv.getX(i));
    expect(shared).toEqual(new Set([1, 11]));
    expect(new Set(output.groups.map((group) => group.materialIndex))).toEqual(new Set([2, 5]));
    output.dispose(); source.dispose();
  });
});

describe("topology commands", () => {
  it("applies loop cuts, rejects stale revisions and rolls back invalid merges", () => {
    const editor = new EditorScene(new Scene(), "p"), mesh = new Mesh(new BoxGeometry()); editor.importObject("box", mesh);
    const seed = topology(readTopology(mesh.geometry)).edges.keys().next().value;
    const command = { commandId: "cut", type: "geometry.loop_cut", objectId: "box", edge: seed, cuts: 2 };
    expect(editor.execute("stale", editor.currentRevision - 1, [command]).status).toBe("revision_conflict");
    expect(editor.execute("cut", editor.currentRevision, [command]).status).toBe("applied");
    const before = mesh.geometry;
    expect(editor.execute("merge", editor.currentRevision, [{ commandId: "m", type: "geometry.merge_vertices", objectId: "box", ids: ["0", "999"] }]).status).toBe("failed");
    expect(mesh.geometry).toBe(before); editor.reset();
  });
  it("rejects batched topology changes and enabled modifiers atomically", () => {
    const editor = new EditorScene(new Scene(), "p"), mesh = new Mesh(new BoxGeometry()); editor.importObject("box", mesh);
    const edge = topology(readTopology(mesh.geometry)).edges.keys().next().value;
    const command = { commandId: "cut", type: "geometry.loop_cut", objectId: "box", edge };
    const before = mesh.geometry;
    expect(editor.execute("batch", editor.currentRevision, [command, { ...command, commandId: "cut-again" }]).status).toBe("failed");
    expect(mesh.geometry).toBe(before);
    expect(editor.execute("modifiers", editor.currentRevision, [{ commandId: "sub", type: "geometry.set_modifiers", objectId: "box",
      modifiers: [{ id: "smooth", kind: "subdivision", enabled: true, levels: 1 }] }]).status).toBe("applied");
    const modified = mesh.geometry;
    expect(editor.execute("cut", editor.currentRevision, [command]).status).toBe("failed");
    expect(mesh.geometry).toBe(modified); editor.reset();
  });
});
