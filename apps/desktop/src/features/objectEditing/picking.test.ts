import { BoxGeometry, Mesh, PerspectiveCamera, Scene, Vector2 } from "three";
import { describe, expect, it } from "vitest";
import { EditorScene } from "@/features/assistant/EditorScene";
import { pickObjectIds } from "./picking";

describe("overlapping object picking", () => {
  it("returns visible objects in depth order without repeated hits", () => {
    const scene = new Scene();
    const editor = new EditorScene(scene, "project");
    const front = new Mesh(new BoxGeometry()); front.position.z = 1;
    const back = new Mesh(new BoxGeometry()); back.position.z = -1;
    editor.importObject("front", front); editor.importObject("back", back);
    const camera = new PerspectiveCamera(60, 1, 0.1, 100); camera.position.z = 5; camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    expect(pickObjectIds(editor, camera, new Vector2())).toEqual(["front", "back"]);
    back.visible = false;
    expect(pickObjectIds(editor, camera, new Vector2())).toEqual(["front"]);
  });
});
