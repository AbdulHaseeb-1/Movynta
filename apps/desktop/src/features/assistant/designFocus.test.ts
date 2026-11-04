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
    expect(scene.context().designFocus?.componentSelection).toBeNull();
    scene.setDesignFocus({ mode: "edit", componentKind: "face", componentSelection: { objectId: "box", meshPath: [], kind: "face", ids: ["0"], modifiersEnabled: false } });
    expect(scene.context().designFocus?.componentSelection?.modifiersEnabled).toBe(true);
    expect(scene.context().designFocus?.componentSelection?.baseFaceIds).toEqual(["0"]);
  });

  it.each(["catmull-clark", "linear", "loop"])("maps refined %s faces back to their base face", (method) => {
    const scene = boxScene();
    const applied = scene.execute("stack", scene.currentRevision, [{
      commandId: "stack", type: "geometry.set_modifiers", objectId: "box", modifiers: [
        { id: "bevel", kind: "bevel", width: 0.05, segments: 1 },
        { id: "sub", kind: "subdivision", levels: 2, method },
      ],
    }]);
    expect(applied.status).toBe("applied");
    const inspection = { objectId: "box", meshPath: [], offset: 0, limit: 100 };
    const faces = scene.context(inspection).meshInspection?.faces ?? [];
    const picked = (ids: string[]) => scene.setDesignFocus({
      mode: "edit", componentKind: "face",
      componentSelection: { objectId: "box", meshPath: [], kind: "face", ids, modifiersEnabled: false },
    });
    expect(faces.slice(0, 2).map((face) => face.baseFaceIndex)).toEqual([0, 0]);
    picked(["0", "1"]);
    expect(scene.context().designFocus?.componentSelection?.baseFaceIds).toEqual(["0"]);
    const generated = scene.context({ ...inspection, offset: method === "loop" ? 200 : 100 })
      .meshInspection?.faces.find((face) => face.baseFaceIndex === undefined);
    if (!generated) throw new Error("Missing generated bevel face");
    picked(["0", String(generated.index)]);
    expect(scene.context().designFocus?.componentSelection).toMatchObject({ modifiersEnabled: true });
    expect(scene.context().designFocus?.componentSelection?.baseFaceIds).toBeUndefined();
    scene.reset();
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
