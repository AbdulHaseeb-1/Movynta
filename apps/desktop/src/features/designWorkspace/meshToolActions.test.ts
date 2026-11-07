import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Mesh, Scene, SphereGeometry, type Object3D } from "three";
import { HAND_EDIT_COMMAND_TYPES } from "@movynta/editor-protocol";
import { EditorScene } from "@/features/assistant/EditorScene";
import { createPolygonMesh } from "@/features/meshGeometry/createPolygonMesh";
import { measureSurface } from "@/features/meshGeometry/meshTestSupport";
import { readTopology, topology } from "@/features/meshGeometry/meshTopology";
import { recordSceneEdit } from "@/features/objectEditing/sceneEditApi";
import { applyMeshTool, meshToolEdit, middleOfObject, previewMeshCut, type CutSpec, type MeshToolAction } from "./meshToolActions";

vi.mock("@/features/objectEditing/sceneEditApi", () => ({ recordSceneEdit: vi.fn(async () => undefined) }));
function isMesh(object: Object3D | undefined): object is Mesh { return object instanceof Mesh; }
function meshOf(scene: EditorScene, id: string): Mesh {
  const object = scene.getObject(id);
  if (!isMesh(object)) throw new Error(`Missing mesh ${id}`);
  return object;
}
function sceneWith(geometry: ConstructorParameters<typeof Mesh>[0], id = "body"): EditorScene {
  const scene = new EditorScene(new Scene(), "project");
  scene.importObject(id, new Mesh(geometry));
  return scene;
}
const choose = (ids: string[], objectId = "body") => ({ objectId, meshPath: [], ids });
const cut = (overrides: Partial<CutSpec> = {}): CutSpec => ({ axis: "y", offset: 0, keep: "both", fill: false, facesOnly: false, ...overrides });
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
/** The first command of the most recent save. */
const lastSaved = (): Record<string, unknown> | undefined => {
  const calls = vi.mocked(recordSceneEdit).mock.calls;
  const commands: unknown = calls[calls.length - 1]?.[1];
  const first: unknown = Array.isArray(commands) ? commands[0] : undefined;
  return isRecord(first) ? first : undefined;
};

describe("Edit-mode mesh tools", () => {
  it("every command the menu can send is a saved hand edit", () => {
    for (const type of ["geometry.bisect", "geometry.delete_components", "geometry.flip_normals", "geometry.triangulate_faces", "geometry.set_shading", "geometry.bridge_edge_loops", "geometry.separate_faces"]) {
      expect(HAND_EDIT_COMMAND_TYPES.has(type)).toBe(true);
    }
    const actions: MeshToolAction[] = [{ type: "delete", kind: "face" }, { type: "separate" }, { type: "flip" }, { type: "triangulate" }, { type: "bridge" }, { type: "shade", mode: "flat" }, { type: "cut", spec: cut() }];
    for (const action of actions) expect(HAND_EDIT_COMMAND_TYPES.has(meshToolEdit(action, choose(["0"])).edit.type)).toBe(true);
  });

  it("deletes the selected faces and clears the selection", async () => {
    const scene = sceneWith(new BoxGeometry());
    await applyMeshTool(scene, choose(["0", "1"]), scene.currentRevision, { type: "delete", kind: "face" });
    expect(readTopology(meshOf(scene, "body").geometry).faces).toHaveLength(4);
    expect(lastSaved()).toMatchObject({ type: "geometry.delete_components", kind: "face", ids: ["0", "1"], objectId: "body" });
  });

  it("separates the selected faces into a new object beside the first", async () => {
    const scene = sceneWith(new SphereGeometry(1, 8, 6));
    const whole = measureSurface(readTopology(meshOf(scene, "body").geometry)).area;
    await applyMeshTool(scene, choose(["0", "1", "2"]), scene.currentRevision, { type: "separate" });
    const saved = lastSaved();
    expect(saved).toMatchObject({ type: "geometry.separate_faces", ids: ["0", "1", "2"] });
    const newId = String(saved?.["newObjectId"]);
    expect(newId).toMatch(/^part_[A-Za-z0-9-]+$/);
    const body = readTopology(meshOf(scene, "body").geometry), part = readTopology(meshOf(scene, newId).geometry);
    expect(part.faces).toHaveLength(3);
    expect(measureSurface(body).area + measureSurface(part).area).toBeCloseTo(whole, 5);
  });

  it("flips, triangulates and shades, keeping the selection where the numbers survive", async () => {
    const scene = sceneWith(new BoxGeometry());
    const before = measureSurface(readTopology(meshOf(scene, "body").geometry)).volume;
    await applyMeshTool(scene, choose(["0"]), scene.currentRevision, { type: "flip" });
    expect(measureSurface(readTopology(meshOf(scene, "body").geometry)).volume).toBeCloseTo(-before, 6);
    expect(meshToolEdit({ type: "flip" }, choose(["0"])).selection).toEqual(["0"]);
    await applyMeshTool(scene, choose(["0"]), scene.currentRevision, { type: "triangulate" });
    expect(readTopology(meshOf(scene, "body").geometry).faces).toHaveLength(7);
    expect(meshToolEdit({ type: "triangulate" }, choose(["0"])).selection).toEqual([]);
    await applyMeshTool(scene, choose(["0"]), scene.currentRevision, { type: "shade", mode: "smooth", angle: 40 });
    expect(lastSaved()).toMatchObject({ type: "geometry.set_shading", mode: "smooth", angle: 40 });
  });

  it("shades a mesh whose modifiers are on, but refuses topology edits there", async () => {
    const scene = sceneWith(new BoxGeometry());
    expect(scene.execute("mods", scene.currentRevision, [{ commandId: "m", type: "geometry.set_modifiers", objectId: "body", modifiers: [{ id: "s", kind: "subdivision", enabled: true, levels: 1 }] }]).status).toBe("applied");
    await applyMeshTool(scene, choose([]), scene.currentRevision, { type: "shade", mode: "flat" });
    await expect(applyMeshTool(scene, choose(["0"]), scene.currentRevision, { type: "delete", kind: "face" })).rejects.toThrow("Disable modifiers");
  });

  it("bridges two openings of one object", async () => {
    const ring = (y: number) => Array.from({ length: 4 }, (_, i) => [Math.cos((i / 4) * 2 * Math.PI), y, Math.sin((i / 4) * 2 * Math.PI)]);
    const band = (at: number) => Array.from({ length: 4 }, (_, i) => [at + i, at + ((i + 1) % 4), at + 4 + ((i + 1) % 4), at + 4 + i]);
    const scene = sceneWith(createPolygonMesh([...ring(0), ...ring(1), ...ring(2), ...ring(3)], [...band(0), ...band(8)]));
    const cage = readTopology(meshOf(scene, "body").geometry);
    const edges = [...topology(cage).edges].filter(([, incident]) => incident.length === 1 && incident.every((half) => [1, 2].some((y) => Math.abs((cage.positions[half.from]?.y ?? Number.NaN) - y) < 1e-6))).map(([id]) => id);
    await applyMeshTool(scene, choose(edges), scene.currentRevision, { type: "bridge" });
    expect(readTopology(meshOf(scene, "body").geometry).faces).toHaveLength(cage.faces.length + 4);
    expect(lastSaved()).toMatchObject({ type: "geometry.bridge_edge_loops" });
  });

  it("refuses to run on a mesh that changed since it was selected", async () => {
    const scene = sceneWith(new BoxGeometry());
    await expect(applyMeshTool(scene, choose(["0"]), scene.currentRevision - 1, { type: "flip" })).rejects.toThrow("changed");
  });
});

describe("plane cut from the menu", () => {
  it("cuts at a world position and keeps the sides the dialog asked for", async () => {
    const scene = sceneWith(new SphereGeometry(1, 12, 8));
    const before = readTopology(meshOf(scene, "body").geometry).faces.length;
    await applyMeshTool(scene, choose([]), scene.currentRevision, { type: "cut", spec: cut({ keep: "positive", fill: true }) });
    expect(lastSaved()).toMatchObject({ type: "geometry.bisect", plane: { axis: "y", offset: 0 }, space: "world", keep: "positive", fill: true });
    expect(readTopology(meshOf(scene, "body").geometry).faces.length).not.toBe(before);
    for (const p of readTopology(meshOf(scene, "body").geometry).positions) expect(p.y).toBeGreaterThan(-1e-6);
  });

  it("only offers faces-only cutting when nothing is removed, and never fills without keeping a side", () => {
    const spec = cut({ facesOnly: true, keep: "both", fill: true });
    expect(meshToolEdit({ type: "cut", spec }, choose(["1", "2"])).edit).toMatchObject({ keep: "both", fill: false, ids: ["1", "2"] });
    // Removing a side needs the whole mesh cut, so a faces-only choice is dropped.
    expect("ids" in meshToolEdit({ type: "cut", spec: { ...spec, keep: "negative" } }, choose(["1"])).edit).toBe(false);
  });

  it("previews what a cut would do, or why it cannot", () => {
    const scene = sceneWith(new BoxGeometry());
    const revision = scene.currentRevision;
    const ok = previewMeshCut(scene, choose([]), revision, cut());
    expect(ok).toMatchObject({ ok: true, split: 4 });
    expect(ok.message).toContain("cuts 4 faces");
    const miss = previewMeshCut(scene, choose([]), revision, cut({ offset: 5 }));
    expect(miss.ok).toBe(false);
    expect(miss.message).toContain("does not cut the mesh");
    expect(previewMeshCut(scene, choose([]), revision, cut({ offset: Number.NaN })).message).toContain("number");
    expect(previewMeshCut(scene, choose([]), revision - 1, cut()).message).toContain("changed");
    const capped = previewMeshCut(scene, choose([]), revision, cut({ keep: "positive", fill: true }));
    expect(capped.message).toContain("adds 1 cap face");
  });

  it("starts the dialog in the middle of the object, in world space", () => {
    const scene = new EditorScene(new Scene(), "project");
    scene.execute("make", 0, [{ commandId: "b", type: "geometry.create_primitive", objectId: "body", primitive: "box", size: 2, transform: { position: [1, 5, -3] } }]);
    expect(middleOfObject(scene, choose([]), "x")).toBeCloseTo(1, 5);
    expect(middleOfObject(scene, choose([]), "y")).toBeCloseTo(5, 5);
    expect(middleOfObject(scene, choose([]), "z")).toBeCloseTo(-3, 5);
  });
});
