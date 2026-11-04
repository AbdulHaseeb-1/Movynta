import { describe, expect, it } from "vitest";
import { BoxGeometry, Mesh, Scene } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import type { ExtrudeCommit } from "@/features/objectEditing/ExtrudeGesture";
import { faceNormal, readTopology } from "@/features/meshGeometry/meshTopology";
import { takeComponentSelection } from "./componentRestore";
import { saveExtrude } from "./saveExtrude";

function commitAt(revision: number): ExtrudeCommit {
  return { objectId: "box", meshPath: [], kind: "face", ids: ["0"], offset: [0, 1, 0], selection: ["0"], revision };
}

describe("saveExtrude", () => {
  it("refuses a preview computed on an older revision and leaves the mesh untouched", async () => {
    const scene = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    scene.importObject("box", mesh);
    const stale = scene.currentRevision;
    // An earlier edit lands first, so the preview's ids refer to a different mesh.
    const cage = readTopology(mesh.geometry);
    const top = cage.faces.findIndex((face) => faceNormal(cage, face).y > 0.9);
    const earlier = scene.execute("extrude", stale, [{ commandId: "earlier", type: "geometry.extrude", objectId: "box", kind: "face", ids: [String(top)], offset: [0, 1, 0] }]);
    expect(earlier.status).toBe("applied");
    const before = mesh.geometry;
    await expect(saveExtrude(scene, commitAt(stale))).rejects.toThrow(/changed before this extrude was saved/);
    expect(mesh.geometry).toBe(before);
    expect(takeComponentSelection(scene, "box")).toBeNull();
  });
});
