import { describe, expect, it } from "vitest";
import { BoxGeometry, Mesh, Scene } from "three";
import { EditorScene } from "./EditorScene";

function boxScene(): EditorScene {
  const scene = new EditorScene(new Scene(), "project");
  scene.importObject("box", new Mesh(new BoxGeometry(2, 2, 2)));
  return scene;
}

describe("design focus in the assistant context", () => {
  it("reports the Edit-mode picks, and whether enabled modifiers make them display ids", () => {
    const scene = boxScene();
    scene.setDesignFocus({ mode: "edit", componentKind: "face", componentSelection: { objectId: "box", meshPath: [], kind: "face", ids: ["0"], modifiersEnabled: false } });
    expect(scene.context().designFocus?.componentSelection).toEqual({ objectId: "box", meshPath: [], kind: "face", ids: ["0"], modifiersEnabled: false });
    const applied = scene.execute("bevel", scene.currentRevision, [{ commandId: "b", type: "geometry.bevel", objectId: "box", width: 0.1 }]);
    expect(applied.status).toBe("applied");
    expect(scene.context().designFocus?.componentSelection?.modifiersEnabled).toBe(true);
  });

  it("reports no picks in Object mode and drops a pick whose object no longer exists", () => {
    const scene = boxScene();
    scene.setDesignFocus({ mode: "object", componentKind: null, componentSelection: null });
    expect(scene.context().designFocus).toEqual({ mode: "object", componentKind: null, componentSelection: null });
    scene.setDesignFocus({ mode: "edit", componentKind: "face", componentSelection: { objectId: "gone", meshPath: [], kind: "face", ids: ["0"], modifiersEnabled: false } });
    expect(scene.context().designFocus?.componentSelection).toBeNull();
    scene.setDesignFocus({ mode: "edit", componentKind: "face", componentSelection: { objectId: "box", meshPath: [9, 9], kind: "face", ids: ["0"], modifiersEnabled: false } });
    expect(scene.context().designFocus?.componentSelection).toBeNull();
  });
});
