import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Mesh, Scene } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { faceNormal, readTopology } from "@/features/meshGeometry/meshTopology";
import { recordSceneEdit } from "@/features/objectEditing/sceneEditApi";
import { saveCageEdit } from "./saveCageEdit";
import { BackendResponseError } from "@/lib/backend";

vi.mock("@/features/objectEditing/sceneEditApi", () => ({ recordSceneEdit: vi.fn() }));

describe("pending component edit preview", () => {
  it("retains the preview during the save and disposes it before committing the saved geometry", async () => {
    const scene = new EditorScene(new Scene(), "project"); const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    scene.importObject("box", mesh); const original = mesh.geometry;
    const face = readTopology(original).faces.findIndex((f) => faceNormal(readTopology(original), f).y > 0.9);
    let finish: ((value: { proposalId: string }) => void) | undefined;
    vi.mocked(recordSceneEdit).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const displayed = original.clone();
    const preview = { show: vi.fn(() => { mesh.geometry = displayed; }), dispose: vi.fn(() => { if (mesh.geometry === displayed) mesh.geometry = original; displayed.dispose(); }) };
    const saving = saveCageEdit(scene, { revision: scene.currentRevision, objectId: "box", meshPath: [], selection: [], edit: { type: "geometry.inset_faces", ids: [String(face)], thickness: 0.1 } }, preview);
    expect(preview.show).toHaveBeenCalledOnce(); expect(mesh.geometry).toBe(displayed);
    if (!finish) throw new Error("Save did not start");
    finish({ proposalId: "saved" }); await saving;
    expect(preview.dispose).toHaveBeenCalled();
    const object = scene.getObject("box");
    expect(object).not.toBe(mesh); expect(scene.currentRevision).toBeGreaterThan(0);
  });
  it("restores the mesh after a definite save rejection without requiring recovery", async () => {
    const scene = new EditorScene(new Scene(), "project"); const mesh = new Mesh(new BoxGeometry());
    scene.importObject("box", mesh); const original = mesh.geometry; const revision = scene.currentRevision;
    const display = original.clone();
    const preview = { show: () => { mesh.geometry = display; }, dispose: () => { if (mesh.geometry === display) mesh.geometry = original; display.dispose(); } };
    vi.mocked(recordSceneEdit).mockRejectedValueOnce(new BackendResponseError("Rejected", 422));
    await expect(saveCageEdit(scene, { revision, objectId: "box", meshPath: [], selection: [], edit: { type: "geometry.inset_faces", ids: ["0"], thickness: 0.1 } }, preview)).rejects.toThrow("Rejected");
    expect(mesh.geometry).toBe(original); expect(scene.currentRevision).toBe(revision); expect(scene.requiresRecovery).toBe(false);
  });
});
