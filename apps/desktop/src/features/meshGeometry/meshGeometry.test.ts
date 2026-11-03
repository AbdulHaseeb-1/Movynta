import { describe, expect, it } from "vitest";
import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Scene, SphereGeometry, Texture } from "three";
import { meshInspectionSchema } from "@movynta/editor-protocol";
import { EditorScene } from "../assistant/EditorScene";
import { assertEditableMesh, modifyGeometry } from "./meshModifiers";
import { assertManifold, readTopology, topology } from "./meshTopology";
import { inspectMesh } from "./meshInspection";

describe("polygon surface operations", () => {
  it("reconstructs six cube control faces and computes Catmull-Clark points", () => {
    const original = new BoxGeometry(2, 2, 2);
    expect(readTopology(original).faces).toHaveLength(6);
    const output = modifyGeometry(original, { type: "geometry.subdivide", levels: 1 });
    const mesh = readTopology(output);
    expect(mesh.positions).toHaveLength(26);
    expect(mesh.faces).toHaveLength(24);
    expect(mesh.faces.every((face) => face.length === 4)).toBe(true);
    expect(Math.abs(mesh.positions[0]?.x ?? 0)).toBeCloseTo(5 / 9);
    expect(output.index?.count).toBe(144);
    expect(original.getAttribute("position").count).toBe(24);
    expect(() => assertManifold(mesh, topology(mesh), true)).not.toThrow();
    const twice = modifyGeometry(output, { type: "geometry.subdivide", levels: 1 });
    expect(readTopology(twice).faces).toHaveLength(96);
  });

  it("uses the boundary subdivision rule for open surfaces", () => {
    const mesh = readTopology(modifyGeometry(new PlaneGeometry(1, 1), { type: "geometry.subdivide", levels: 1 }));
    expect(mesh.faces).toHaveLength(4);
    expect(Math.abs(mesh.positions[0]?.x ?? 0)).toBeCloseTo(.375);
    expect(() => assertManifold(mesh, topology(mesh))).not.toThrow();
  });

  it("bevels cube edges and corners into a closed surface with outward normals", () => {
    const output = modifyGeometry(new BoxGeometry(2, 2, 2), { type: "geometry.bevel", width: .2 });
    const mesh = readTopology(output);
    expect(mesh.positions).toHaveLength(24);
    expect(mesh.faces).toHaveLength(26);
    expect(output.getAttribute("position").count / 3).toBe(44);
    expect(() => assertManifold(mesh, topology(mesh), true)).not.toThrow();
    const p = output.getAttribute("position"); const n = output.getAttribute("normal");
    for (let i = 0; i < p.count; i += 1) expect(p.getX(i) * n.getX(i) + p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i)).toBeGreaterThan(0);
  });

  it("handles cylinder caps and sphere seams", () => {
    for (const source of [new CylinderGeometry(1, 1, 2, 12), new SphereGeometry(1, 12, 8)]) {
      const output = modifyGeometry(source, { type: "geometry.subdivide", levels: 1 });
      const mesh = readTopology(output);
      expect(() => assertManifold(mesh, topology(mesh), true)).not.toThrow();
      const beveled = readTopology(modifyGeometry(source, { type: "geometry.bevel", width: .01 }));
      expect(() => assertManifold(beveled, topology(beveled), true)).not.toThrow();
    }
  });

  it("rejects invalid widths, non-manifold geometry, and excessive refinement while accepting open and textured meshes", () => {
    expect(() => modifyGeometry(new BoxGeometry(), { type: "geometry.bevel", width: 1 })).toThrow(/width/);
    expect(() => modifyGeometry(new PlaneGeometry(), { type: "geometry.bevel", width: .1 })).not.toThrow();
    const bad = new BufferGeometry().setAttribute("position", new Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0, 0,-1,0, 0,0,1], 3));
    bad.setIndex([0,1,2, 1,0,3, 0,1,4]);
    expect(() => modifyGeometry(bad, { type: "geometry.subdivide", levels: 1 })).toThrow(/manifold/);
    expect(() => modifyGeometry(new SphereGeometry(1, 100, 80), { type: "geometry.subdivide", levels: 3 })).toThrow(/limit/);
    expect(() => assertEditableMesh(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: new Texture() })))).not.toThrow();
  });
});

describe("geometry transactions and inspection", () => {
  it("copies shared geometry without disposing buffers another mesh still uses", () => {
    const editor = new EditorScene(new Scene(), "p"); const source = new BoxGeometry();
    const left = new Mesh(source); const right = new Mesh(source);
    let disposed = false; source.addEventListener("dispose", () => { disposed = true; });
    editor.importObject("left", left); editor.importObject("right", right);
    expect(editor.execute("change", 2, [{ commandId: "s", type: "geometry.subdivide", objectId: "left", levels: 1 }]).status).toBe("applied");
    expect(left.geometry).not.toBe(source); expect(right.geometry).toBe(source); expect(disposed).toBe(false);
  });

  it("invalidates inspected topology when position attributes are updated", () => {
    const source = new BoxGeometry(); const before = readTopology(source);
    const positions = source.getAttribute("position"); positions.setX(0, 2); positions.needsUpdate = true;
    expect(readTopology(source)).not.toBe(before);
  });
  it("targets an imported mesh, preserves its identity, and pages local geometry", () => {
    const editor = new EditorScene(new Scene(), "p"); const root = new Group();
    const mesh = new Mesh(new BoxGeometry(2,2,2)); root.add(mesh); editor.importObject("model", root);
    const result = editor.execute("bevel", 1, [{ commandId: "b", type: "geometry.bevel", objectId: "model", meshPath: [0], width: .2 }]);
    expect(result.status).toBe("applied"); expect(root.children[0]).toBe(mesh);
    const inspection = editor.context({ objectId: "model", meshPath: [0], offset: 2, limit: 3 }).meshInspection;
    expect(meshInspectionSchema.safeParse(inspection).success).toBe(true);
    expect(inspection?.stats).toMatchObject({ vertices: 24, faces: 26, triangles: 44, boundaryEdges: 0 });
    expect(inspection?.vertices).toHaveLength(3); expect(inspection?.vertices[0]?.index).toBe(2);
    expect(inspectMesh(root, { objectId: "model", meshPath: [], offset: 0, limit: 1 }).parts[0]?.path).toEqual([0]);
  });

  it("rolls back all geometry when a later command fails and rejects mixed batches", () => {
    const editor = new EditorScene(new Scene(), "p"); const mesh = new Mesh(new BoxGeometry()); editor.importObject("box", mesh);
    const original = mesh.geometry;
    const result = editor.execute("bad", 1, [
      { commandId: "a", type: "geometry.subdivide", objectId: "box", levels: 1 },
      { commandId: "b", type: "geometry.bevel", objectId: "missing", width: .1 },
    ]);
    expect(result.status).toBe("failed"); expect(mesh.geometry).toBe(original); expect(editor.currentRevision).toBe(1);
    expect(editor.execute("mixed", 1, [
      { commandId: "a", type: "geometry.subdivide", objectId: "box", levels: 1 },
      { commandId: "b", type: "scene.rename_object", objectId: "box", name: "New name" },
    ]).status).toBe("failed");
  });

  it("replays modifiers deterministically and applies each proposal once", async () => {
    const commands = [{ commandId: "b", type: "geometry.subdivide", objectId: "box", levels: 2 }];
    const steps = [
      { kind: "commands" as const, proposalId: "create", commands: [{ commandId: "c", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 2 }] },
      { kind: "commands" as const, proposalId: "subdivide", commands },
    ];
    const editor = new EditorScene(new Scene(), "p");
    await editor.restore(steps, () => Promise.reject(new Error("Unexpected import")));
    const inspection = editor.context({ objectId: "box", meshPath: [], offset: 0, limit: 5 }).meshInspection;
    expect(inspection?.stats?.faces).toBe(96);
    expect(editor.execute("subdivide", 1, commands).status).toBe("applied");
    expect(editor.currentRevision).toBe(2);
  });

  it("benchmarks a bevel and two subdivision levels", () => {
    const source = new BoxGeometry(2, 2, 2); const samples = 20;
    const start = performance.now();
    for (let i = 0; i < samples; i += 1) {
      const beveled = modifyGeometry(source, { type: "geometry.bevel", width: .2 });
      const smooth = modifyGeometry(beveled, { type: "geometry.subdivide", levels: 2 });
      expect(readTopology(smooth).faces.length).toBeGreaterThan(26);
      beveled.dispose(); smooth.dispose();
    }
    // eslint-disable-next-line no-console -- Records computational geometry timing.
    console.info(JSON.stringify({ samples, bevelAndSubdivisionMeanMs: (performance.now() - start) / samples }));
  });
});
