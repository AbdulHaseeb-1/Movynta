import { describe, expect, it } from "vitest";
import { Mesh, Scene, Vector3, type Object3D } from "three";
import { checkManifold } from "../meshGeometry/meshManifold";
import { readTopology, topology } from "../meshGeometry/meshTopology";
import { measureSurface } from "../meshGeometry/meshTestSupport";
import { EditorScene } from "./EditorScene";

function editorWithBox(transform: Record<string, number[]> = {}) {
  const editor = new EditorScene(new Scene(), "project");
  const created = editor.execute("make", 0, [{ commandId: "box", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 1, transform }]);
  expect(created.status).toBe("applied");
  return editor;
}
function isMesh(object: Object3D | undefined): object is Mesh { return object instanceof Mesh; }
function meshOf(editor: EditorScene): Mesh {
  const object = editor.getObject("box");
  if (!isMesh(object)) throw new Error("Missing mesh");
  return object;
}
const bisect = (extra: Record<string, unknown>) => ({ commandId: "cut", type: "geometry.bisect", objectId: "box", ...extra });

describe("assistant mesh cuts", () => {
  it("bisects at a world-space height and leaves the cut vertices on that plane", () => {
    const editor = editorWithBox({ position: [0, 2, 0], rotation: [0, 0.4, 0.3], scale: [1, 2, 3] });
    const result = editor.execute("bisect", editor.currentRevision, [bisect({ plane: { axis: "y", offset: 2.1 }, space: "world" })]);
    expect(result.status).toBe("applied");
    const mesh = meshOf(editor);
    mesh.updateWorldMatrix(true, false);
    const cage = readTopology(mesh.geometry);
    expect(cage.positions.length).toBeGreaterThan(8);
    const onPlane = cage.positions.filter((p) => Math.abs(p.clone().applyMatrix4(mesh.matrixWorld).y - 2.1) < 1e-4);
    expect(onPlane.length).toBeGreaterThanOrEqual(4);
    expect(() => checkManifold(cage, true)).not.toThrow();
  });

  it("keeps the upper half of a box and closes it", () => {
    const editor = editorWithBox();
    const before = measureSurface(readTopology(meshOf(editor).geometry));
    const result = editor.execute("half", editor.currentRevision, [bisect({ plane: { point: [0, 0, 0], normal: [0, 1, 0] }, keep: "positive", fill: true })]);
    expect(result.status).toBe("applied");
    const cage = readTopology(meshOf(editor).geometry);
    expect(Math.min(...cage.positions.map((p) => p.y))).toBeCloseTo(0, 6);
    expect(measureSurface(cage).volume).toBeCloseTo(before.volume / 2, 6);
    expect(() => checkManifold(cage, true)).not.toThrow();
    expect(editor.currentRevision).toBeGreaterThan(1);
  });

  it("triangulates a cylinder whose seam was beveled, and says why when a filled cut meets the hole it leaves", () => {
    // Bevelling a seam puts a vertex exactly on each straight edge of the caps; clipping those as ears left triangles with no area.
    const editor = new EditorScene(new Scene(), "project");
    editor.execute("make", 0, [{ commandId: "tube", type: "geometry.create_primitive", objectId: "tube", primitive: "cylinder", size: 1,
      options: { radiusTop: 0.3, radiusBottom: 0.3, height: 1, radialSegments: 8 } }]);
    expect(editor.execute("bevel", editor.currentRevision, [{ commandId: "b", type: "geometry.bevel_edges", objectId: "tube", ids: ["2_3"], width: 0.03, segments: 2, profile: "round" }]).status).toBe("applied");
    const triangulated = editor.execute("tri", editor.currentRevision, [{ commandId: "t", type: "geometry.triangulate_faces", objectId: "tube" }]);
    expect(triangulated.status).toBe("applied");
    // A cut that cannot be capped because a face is missing tells the assistant what to do about it.
    const open = new EditorScene(new Scene(), "project");
    open.execute("make", 0, [{ commandId: "box", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 1 }]);
    open.execute("hole", open.currentRevision, [{ commandId: "d", type: "geometry.delete_components", objectId: "box", kind: "face", ids: ["5"] }]);
    const refused = open.execute("cut", open.currentRevision, [{ commandId: "c", type: "geometry.bisect", objectId: "box", plane: { axis: "x", offset: 0.1 }, space: "local", keep: "positive", fill: true }]);
    expect(refused.status).toBe("failed");
    expect(JSON.stringify(refused.results)).toContain("geometry.fill_hole");
  });

  it("replays the same command to the same cage", () => {
    const command = bisect({ plane: { axis: "x", offset: 0.1 }, keep: "negative", fill: true });
    const first = editorWithBox(), second = editorWithBox();
    first.execute("a", first.currentRevision, [command]);
    second.execute("a", second.currentRevision, [command]);
    const a = readTopology(meshOf(first).geometry), b = readTopology(meshOf(second).geometry);
    expect(a.faces).toEqual(b.faces);
    expect(a.positions.map((p) => p.toArray())).toEqual(b.positions.map((p) => p.toArray()));
  });

  it("deletes, triangulates and flips through proposals", () => {
    const editor = editorWithBox();
    expect(editor.execute("tri", editor.currentRevision, [{ commandId: "t", type: "geometry.triangulate_faces", objectId: "box" }]).status).toBe("applied");
    expect(readTopology(meshOf(editor).geometry).faces).toHaveLength(12);
    expect(editor.execute("del", editor.currentRevision, [{ commandId: "d", type: "geometry.delete_components", objectId: "box", kind: "face", ids: ["0", "1"] }]).status).toBe("applied");
    expect(readTopology(meshOf(editor).geometry).faces).toHaveLength(10);
    const flipped = editor.execute("flip", editor.currentRevision, [{ commandId: "f", type: "geometry.flip_normals", objectId: "box" }]);
    expect(flipped.status).toBe("applied");
    expect(measureSurface(readTopology(meshOf(editor).geometry)).volume).not.toBeCloseTo(0, 3);
  });

  it("refuses unsafe requests without changing the mesh", () => {
    const editor = editorWithBox();
    const mesh = meshOf(editor), original = mesh.geometry;
    const cut = bisect({ plane: { axis: "y", offset: 0 } });
    expect(editor.execute("stale", editor.currentRevision - 1, [cut]).status).toBe("revision_conflict");
    expect(editor.execute("pair", editor.currentRevision, [cut, { ...cut, commandId: "cut2" }]).status).toBe("failed");
    const miss = editor.execute("miss", editor.currentRevision, [bisect({ plane: { axis: "y", offset: 9 } })]);
    expect(miss.status).toBe("failed");
    expect(miss.message).toContain("does not cut the mesh");
    const all = editor.execute("all", editor.currentRevision, [{ commandId: "d", type: "geometry.delete_components", objectId: "box", kind: "face", ids: ["0", "1", "2", "3", "4", "5"] }]);
    expect(all.message).toContain("scene.delete_object");
    expect(mesh.geometry).toBe(original);
    expect(editor.execute("mods", editor.currentRevision, [{ commandId: "m", type: "geometry.set_modifiers", objectId: "box", modifiers: [{ id: "s", kind: "subdivision", enabled: true, levels: 1 }] }]).status).toBe("applied");
    const withModifiers = editor.execute("late", editor.currentRevision, [cut]);
    expect(withModifiers.status).toBe("failed");
    expect(withModifiers.message).toContain("disable modifiers");
  });

  it("rejects a world-space plane on a collapsed object transform", () => {
    const editor = editorWithBox();
    const mesh = meshOf(editor);
    mesh.scale.set(1e-7, 1e-7, 1e-7); mesh.updateMatrixWorld(true);
    const world = editor.execute("flat", editor.currentRevision, [bisect({ plane: { axis: "y", offset: 0 }, space: "world" })]);
    expect(world.status).toBe("failed");
    expect(world.message).toContain("singular");
    // The same plane in mesh-local space does not depend on the transform.
    expect(editor.execute("local", editor.currentRevision, [bisect({ plane: { axis: "y", offset: 0 }, space: "local" })]).status).toBe("applied");
  });

  it("sets shading on an existing mesh and keeps it through the next edit", () => {
    const editor = new EditorScene(new Scene(), "project");
    editor.execute("make", 0, [{ commandId: "ball", type: "geometry.create_primitive", objectId: "box", primitive: "sphere", size: 1 }]);
    expect(editor.execute("flat", editor.currentRevision, [{ commandId: "s", type: "geometry.set_shading", objectId: "box", mode: "flat" }]).status).toBe("applied");
    const flatTriangles = (mesh: Mesh): boolean => {
      const normals = mesh.geometry.getAttribute("normal"), index = mesh.geometry.index;
      const count = (index?.count ?? normals.count) / 3;
      for (let t = 0; t < count; t += 1) {
        const at = (c: number) => index ? index.getX(t * 3 + c) : t * 3 + c;
        for (const c of [1, 2]) for (const axis of [0, 1, 2]) if (Math.abs(normals.getComponent(at(0), axis) - normals.getComponent(at(c), axis)) > 1e-5) return false;
      }
      return true;
    };
    expect(flatTriangles(meshOf(editor))).toBe(true);
    // A later cut rebuilds the normals; flat shading must survive it.
    expect(editor.execute("cut", editor.currentRevision, [bisect({ plane: { axis: "y", offset: 0.1 } })]).status).toBe("applied");
    expect(flatTriangles(meshOf(editor))).toBe(true);
    expect(editor.execute("smooth", editor.currentRevision, [{ commandId: "s2", type: "geometry.set_shading", objectId: "box", mode: "smooth", angle: 50 }]).status).toBe("applied");
    expect(flatTriangles(meshOf(editor))).toBe(false);
    const withModifiers = editor.execute("mods", editor.currentRevision, [{ commandId: "m", type: "geometry.set_modifiers", objectId: "box", modifiers: [{ id: "s", kind: "subdivision", enabled: true, levels: 1 }] }]);
    expect(withModifiers.status).toBe("applied");
    // Shading is a base-cage edit like the others and can run while modifiers are on, using base IDs.
    expect(editor.execute("again", editor.currentRevision, [{ commandId: "s3", type: "geometry.set_shading", objectId: "box", mode: "flat" }]).status).toBe("applied");
  });

  it("bridges two separate openings of one object into a single surface", () => {
    const editor = new EditorScene(new Scene(), "project");
    const ring = (y: number) => Array.from({ length: 6 }, (_, i) => [Math.cos((i / 6) * 2 * Math.PI), y, Math.sin((i / 6) * 2 * Math.PI)]);
    const side = (offset: number) => Array.from({ length: 6 }, (_, i) => [offset + i, offset + (i + 1) % 6, offset + 6 + (i + 1) % 6, offset + 6 + i]);
    const vertices = [...ring(0), ...ring(1), ...ring(2), ...ring(3)];
    const created = editor.execute("make", 0, [{ commandId: "mesh", type: "geometry.create_mesh", objectId: "box", vertices, faces: [...side(0), ...side(12)] }]);
    expect(created.status).toBe("applied");
    const cage = readTopology(meshOf(editor).geometry);
    const open = [...topology(cage).edges].filter(([, incident]) => incident.length === 1);
    const at = (y: number) => open.filter(([, incident]) => incident.every((half) => Math.abs((cage.positions[half.from]?.y ?? Number.NaN) - y) < 1e-6)).map(([id]) => id);
    const command = { commandId: "bridge", type: "geometry.bridge_edge_loops", objectId: "box", ids: [...at(1), ...at(2)] };
    expect(editor.execute("stale", editor.currentRevision - 1, [command]).status).toBe("revision_conflict");
    const result = editor.execute("bridge", editor.currentRevision, [command]);
    expect(result.status).toBe("applied");
    const bridged = readTopology(meshOf(editor).geometry);
    expect(bridged.faces).toHaveLength(cage.faces.length + 6);
    expect([...topology(bridged).edges.values()].filter((incident) => incident.length === 1)).toHaveLength(12);
    const again = editor.execute("again", editor.currentRevision, [{ ...command, commandId: "again" }]);
    expect(again.status).toBe("failed");
  });

  it("keeps smooth-by-angle shading through a later edit instead of faceting the side", () => {
    const editor = new EditorScene(new Scene(), "project");
    editor.execute("make", 0, [{ commandId: "tube", type: "geometry.create_primitive", objectId: "box", primitive: "cylinder", size: 1, options: { radialSegments: 12 } }]);
    expect(editor.execute("shade", editor.currentRevision, [{ commandId: "s", type: "geometry.set_shading", objectId: "box", mode: "smooth", angle: 40 }]).status).toBe("applied");
    expect(editor.execute("cut", editor.currentRevision, [bisect({ plane: { axis: "y", offset: 0.1 } })]).status).toBe("applied");
    const geometry = meshOf(editor).geometry, position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal"), index = geometry.index;
    let sides = 0, caps = 0;
    for (let i = 0; i < (index?.count ?? position.count); i += 1) {
      const v = index ? index.getX(i) : i;
      const n = new Vector3().fromBufferAttribute(normal, v), p = new Vector3().fromBufferAttribute(position, v);
      if (Math.abs(n.y) > 0.999) { caps += 1; continue; }
      sides += 1;
      // Smooth around the tube: the normal at a corner points straight out from the axis, not along its face.
      expect(Math.abs(n.y)).toBeLessThan(1e-4);
      expect(n.dot(p.clone().setY(0).normalize())).toBeGreaterThan(0.999);
    }
    expect(sides).toBeGreaterThan(0);
    expect(caps).toBeGreaterThan(0);
  });
});
