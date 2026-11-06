import { describe, expect, it } from "vitest";
import { Mesh, Scene, type Object3D } from "three";
import { checkManifold } from "../meshGeometry/meshManifold";
import { readTopology } from "../meshGeometry/meshTopology";
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
});
