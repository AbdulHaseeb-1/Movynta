import { describe, expect, it } from "vitest";
import { Scene, Vector3 } from "three";
import { EditorScene } from "./EditorScene";

const place = (commandId: string, objectId: string, position: [number, number, number]) => ({
  commandId,
  type: "scene.create_object",
  objectId,
  name: objectId,
  transform: { position },
});

describe("desktop editor edits", () => {
  it("renames and hides an object without moving it", () => {
    const editor = new EditorScene(new Scene(), "project");
    expect(editor.execute("p1", 0, [place("c", "crate", [1, 0, 0])]).status).toBe("applied");
    const result = editor.execute("p2", 1, [
      { commandId: "r", type: "scene.rename_object", objectId: "crate", name: "Crate" },
      { commandId: "v", type: "scene.set_visibility", objectId: "crate", visible: false },
    ]);
    expect(result.status).toBe("applied");
    const crate = editor.context().objects[0];
    expect(crate?.name).toBe("Crate");
    expect(crate?.visible).toBe(false);
    expect(editor.getObject("crate")?.visible).toBe(false);
    expect(crate?.transform.position).toEqual([1, 0, 0]);
  });

  it("moves an object under another and keeps it where it was in the world", () => {
    const editor = new EditorScene(new Scene(), "project");
    editor.execute("p1", 0, [place("a", "parent", [5, 0, 0]), place("b", "child", [0, 0, 0])]);
    expect(
      editor.execute("p2", 1, [{ commandId: "s", type: "scene.set_parent", objectId: "child", parentId: "parent" }]).status,
    ).toBe("applied");
    const child = editor.getObject("child");
    expect(child?.getWorldPosition(new Vector3()).toArray()).toEqual([0, 0, 0]);
    expect(child?.position.toArray()).toEqual([-5, 0, 0]);
    expect(editor.context().objects.find((object) => object.id === "child")?.parentId).toBe("parent");
  });

  it("moves an object back to the top level without moving it in the world", () => {
    const editor = new EditorScene(new Scene(), "project");
    editor.execute("p1", 0, [place("a", "parent", [5, 0, 0]), place("b", "child", [0, 0, 0])]);
    editor.execute("p2", 1, [{ commandId: "s", type: "scene.set_parent", objectId: "child", parentId: "parent" }]);
    expect(
      editor.execute("p3", 2, [{ commandId: "u", type: "scene.set_parent", objectId: "child", parentId: null }]).status,
    ).toBe("applied");
    expect(editor.getObject("child")?.getWorldPosition(new Vector3()).toArray()).toEqual([0, 0, 0]);
    expect(editor.context().objects.find((object) => object.id === "child")?.parentId).toBeNull();
  });

  it("refuses to put an object under something that hangs below it, and changes nothing", () => {
    const editor = new EditorScene(new Scene(), "project");
    editor.execute("p1", 0, [place("a", "parent", [0, 0, 0]), place("b", "child", [0, 0, 0])]);
    editor.execute("p2", 1, [{ commandId: "s", type: "scene.set_parent", objectId: "child", parentId: "parent" }]);
    const result = editor.execute("p3", 2, [
      { commandId: "r", type: "scene.rename_object", objectId: "parent", name: "Renamed" },
      { commandId: "loop", type: "scene.set_parent", objectId: "parent", parentId: "child" },
    ]);
    expect(result.status).toBe("failed");
    const parent = editor.context().objects.find((object) => object.id === "parent");
    expect(parent?.name).toBe("parent");
    expect(parent?.parentId).toBeNull();
  });
});
