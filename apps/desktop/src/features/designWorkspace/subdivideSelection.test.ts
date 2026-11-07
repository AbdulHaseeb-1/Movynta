import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Mesh, Scene } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { faceNormal, readTopology } from "@/features/meshGeometry/meshTopology";
import { createSerialQueue } from "@/lib/serialQueue";
import { takeComponentSelection } from "./componentRestore";
import { subdivideSelectedFaces } from "./subdivideSelection";
import { isMesh } from "@/lib/three";

// Only the network call that records the edit is replaced. The prepare, commit and rebuild steps run for real.
vi.mock("@/features/objectEditing/sceneEditApi", () => ({ recordSceneEdit: vi.fn(async () => undefined) }));


describe("Edit-mode Subdivide", () => {
  it("subdivides the chosen face through a saved edit and leaves the rest of the object alone", async () => {
    const scene = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    scene.importObject("box", mesh);
    const cage = readTopology(mesh.geometry);
    const top = cage.faces.findIndex((face) => faceNormal(cage, face).y > 0.9);
    const saves = createSerialQueue();
    const errors = vi.fn();
    subdivideSelectedFaces(scene, { objectId: "box", meshPath: [], ids: [String(top)] }, saves, errors);
    await saves.flush();
    expect(errors).not.toHaveBeenCalled();
    const live = scene.getObject("box");
    if (!isMesh(live)) throw new Error("Missing box mesh");
    expect(readTopology(live.geometry).faces).toHaveLength(9);
    expect(takeComponentSelection(scene, "box")).toBeNull();
  });

  it("reports a selection that cannot be subdivided and saves nothing", async () => {
    const scene = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    scene.importObject("box", mesh);
    const revision = scene.currentRevision;
    const saves = createSerialQueue();
    const errors = vi.fn();
    subdivideSelectedFaces(scene, { objectId: "box", meshPath: [], ids: ["99"] }, saves, errors);
    await saves.flush();
    const failure: unknown = errors.mock.calls[0]?.[0];
    if (!(failure instanceof Error)) throw new Error("Expected an error to be reported");
    expect(failure.message).toContain("Unknown face");
    expect(scene.currentRevision).toBe(revision);
  });

  it("refuses while a modifier is enabled, because the picks would name the display mesh", async () => {
    const scene = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    scene.importObject("box", mesh);
    const bevelled = scene.execute("bevel", scene.currentRevision, [{ commandId: "b", type: "geometry.bevel", objectId: "box", width: 0.1 }]);
    expect(bevelled.status).toBe("applied");
    const revision = scene.currentRevision;
    const saves = createSerialQueue();
    const errors = vi.fn();
    subdivideSelectedFaces(scene, { objectId: "box", meshPath: [], ids: ["0"] }, saves, errors);
    await saves.flush();
    const failure: unknown = errors.mock.calls[0]?.[0];
    if (!(failure instanceof Error)) throw new Error("Expected an error to be reported");
    expect(failure.message).toContain("Disable modifiers");
    expect(scene.currentRevision).toBe(revision);
  });
});
