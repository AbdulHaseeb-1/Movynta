import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { EditorScene } from "./EditorScene";

const box = {
  commandId: "cmd1",
  type: "geometry.create_primitive",
  objectId: "cube",
  primitive: "box",
  size: 2,
  replaceExisting: false,
};
describe("desktop editor protocol", () => {
  it("creates real geometry, transforms it, and reports the new context", () => {
    const scene = new Scene();
    const editor = new EditorScene(scene, "project");
    expect(editor.execute("p1", 0, [box]).status).toBe("applied");
    expect(scene.children).toHaveLength(1);
    expect(
      editor.execute("p2", 1, [
        {
          commandId: "cmd2",
          type: "scene.transform_object",
          objectId: "cube",
          transform: { position: [1, 2, 3] },
        },
      ]).status,
    ).toBe("applied");
    expect(editor.context().objects[0]?.transform.position).toEqual([1, 2, 3]);
  });
  it("rejects stale revisions, rolls failed batches back, and applies a proposal only once", () => {
    const editor = new EditorScene(new Scene(), "project");
    expect(editor.execute("p1", 1, [box]).status).toBe("revision_conflict");
    expect(editor.execute("p1", 0, [box]).status).toBe("applied");
    expect(editor.execute("p1", 0, [box]).status).toBe("applied");
    expect(editor.context().revision).toBe(1);
    const invalid = [
      { ...box, objectId: "new", commandId: "new" },
      { commandId: "bad", type: "scene.delete_object", objectId: "missing" },
    ];
    expect(editor.execute("p2", 1, invalid).status).toBe("failed");
    expect(editor.context().objects.map((object) => object.id)).toEqual([
      "cube",
    ]);
  });
  it("rejects shell/code and unsupported commands", () => {
    const editor = new EditorScene(new Scene(), "project");
    expect(() =>
      editor.execute("p1", 0, [
        { type: "code.execute", commandId: "bad", code: "throw 1" },
      ]),
    ).toThrow();
  });
});
