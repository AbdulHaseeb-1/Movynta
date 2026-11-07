import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Mesh, Scene } from "three";
import { HAND_EDIT_COMMAND_TYPES } from "@movynta/editor-protocol";
import { EditorScene } from "@/features/assistant/EditorScene";
import { createPolygonMesh } from "@/features/meshGeometry/createPolygonMesh";
import { readTopology, topology } from "@/features/meshGeometry/meshTopology";
import { recordSceneEdit } from "@/features/objectEditing/sceneEditApi";
import { cleanupSelection } from "./cleanupSelection";
import { isMesh } from "@/lib/three";

vi.mock("@/features/objectEditing/sceneEditApi", () => ({ recordSceneEdit: vi.fn(async () => undefined) }));

describe("manual mesh cleanup", () => {
  it("saves a vertex merge and keeps the merged vertex selected", async () => {
    const scene = new EditorScene(new Scene(), "project");
    const source = new BoxGeometry(); const cage = readTopology(source);
    scene.importObject("box", new Mesh(source));
    const edge = [...topology(cage).edges.keys()][0]; if (!edge) throw new Error("Missing edge");
    await cleanupSelection(scene, { objectId: "box", meshPath: [], ids: edge.split("_") }, scene.currentRevision, "merge-center");
    const result = scene.getObject("box"); if (!isMesh(result)) throw new Error("Missing result");
    expect(readTopology(result.geometry).positions.length).toBe(cage.positions.length - 1);
    expect(recordSceneEdit).toHaveBeenLastCalledWith("project", [expect.objectContaining({ type: "geometry.merge_vertices", mode: "center" })], expect.any(String));
    expect(HAND_EDIT_COMMAND_TYPES.has("geometry.merge_vertices")).toBe(true);
  });

  it("saves dissolve and fill through the same manual history path", async () => {
    const source = createPolygonMesh([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0]], [[0, 1, 4, 3], [1, 2, 5, 4]]);
    const scene = new EditorScene(new Scene(), "project"); scene.importObject("grid", new Mesh(source));
    const internal = [...topology(readTopology(source)).edges].filter(([, sides]) => sides.length === 2).map(([id]) => id);
    await cleanupSelection(scene, { objectId: "grid", meshPath: [], ids: internal }, scene.currentRevision, "dissolve");
    const grid = scene.getObject("grid"); if (!isMesh(grid)) throw new Error("Missing grid");
    expect(readTopology(grid.geometry).faces.length).toBe(1);
    const box = readTopology(new BoxGeometry());
    const open = createPolygonMesh(box.positions.map((p) => p.toArray()), box.faces.slice(1));
    scene.importObject("open", new Mesh(open));
    const boundary = [...topology(readTopology(open)).edges].filter(([, sides]) => sides.length === 1).map(([id]) => id);
    await cleanupSelection(scene, { objectId: "open", meshPath: [], ids: boundary }, scene.currentRevision, "fill");
    const closed = scene.getObject("open"); if (!isMesh(closed)) throw new Error("Missing solid");
    expect([...topology(readTopology(closed.geometry)).edges.values()].every((sides) => sides.length === 2)).toBe(true);
    expect(HAND_EDIT_COMMAND_TYPES.has("geometry.fill_hole")).toBe(true);
    expect(HAND_EDIT_COMMAND_TYPES.has("geometry.dissolve_edges")).toBe(true);
  });

  it("rejects stale and invalid selections without recording a change", async () => {
    const scene = new EditorScene(new Scene(), "project"); scene.importObject("box", new Mesh(new BoxGeometry()));
    const choice = { objectId: "box", meshPath: [], ids: ["999", "1000"] };
    const revision = scene.currentRevision; const calls = vi.mocked(recordSceneEdit).mock.calls.length;
    await expect(cleanupSelection(scene, choice, revision - 1, "merge-center")).rejects.toThrow("mesh changed");
    await expect(cleanupSelection(scene, choice, revision, "merge-center")).rejects.toThrow("Unknown vertex");
    expect(scene.currentRevision).toBe(revision); expect(vi.mocked(recordSceneEdit).mock.calls.length).toBe(calls);
  });
});
