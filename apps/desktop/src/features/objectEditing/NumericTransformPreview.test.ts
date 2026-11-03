import { expect, it } from "vitest";
import { BoxGeometry, Mesh, Scene } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { NumericTransformPreview } from "./NumericTransformPreview";

function fixture() {
  const scene = new EditorScene(new Scene(), "project");
  scene.importObject("a", new Mesh(new BoxGeometry())); scene.importObject("b", new Mesh(new BoxGeometry())); scene.select("a");
  return scene;
}
it("updates the scene during a drag, and returns one final change on release", () => {
  const scene = fixture(); const revision = scene.currentRevision;
  const preview = new NumericTransformPreview(scene, "a");
  preview.preview({ position: [1, 0, 0] }); expect(scene.getObject("a")?.position.x).toBe(1);
  preview.preview({ position: [2, 0, 0] }); expect(scene.getObject("a")?.position.x).toBe(2);
  expect(scene.currentRevision).toBe(revision);
  const change = preview.finish(true); expect(scene.getObject("a")?.position.x).toBe(0);
  expect(change?.before.position).toEqual([0, 0, 0]); expect(change?.after.position).toEqual([2, 0, 0]);
});
it("restores on cancellation and selection changes, and rejects invalid scale", () => {
  const scene = fixture(); const preview = new NumericTransformPreview(scene, "a");
  expect(preview.preview({ scale: [0, 1, 1] })).toBeUndefined();
  preview.preview({ position: [3, 0, 0] }); scene.select("b");
  expect(preview.finish(false)).toBeUndefined(); expect(scene.getObject("a")?.position.x).toBe(0);
  scene.select("a"); const second = new NumericTransformPreview(scene, "a"); second.preview({ position: [4, 0, 0] }); second.finish(false); expect(scene.getObject("a")?.position.x).toBe(0);
});
it("does not overwrite a newer scene revision when a gesture is interrupted", () => {
  const scene = fixture(); const preview = new NumericTransformPreview(scene, "a");
  preview.preview({ position: [2, 0, 0] });
  scene.applyUserTransforms([{ id: "a", transform: { position: [7, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }]);
  expect(preview.finish(false)).toBeUndefined(); expect(scene.getObject("a")?.position.x).toBe(7);
});
