import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector2,
} from "three";
import { EditorScene, type ObjectTransform } from "../assistant/EditorScene";
import { pickObjectId, toNdc } from "./picking";
import {
  degreesToRadians,
  formatNumber,
  parseNumber,
  radiansToDegrees,
  sameTransform,
  withAxis,
} from "./transformMath";

const box = (objectId: string) => ({
  commandId: `create-${objectId}`,
  type: "geometry.create_primitive",
  objectId,
  primitive: "box",
  size: 1,
  replaceExisting: false,
});

function sceneWith(...ids: string[]) {
  const scene = new Scene();
  const editor = new EditorScene(scene, "prj_1");
  editor.execute("p1", 0, ids.map(box));
  return { scene, editor };
}

const moved: ObjectTransform = {
  position: [1, 2, 3],
  rotation: [0, 0.5, 0],
  scale: [2, 2, 2],
};

describe("selection in the editor scene", () => {
  it("selects an object, tells listeners, and shows it to the assistant as the user's selection", () => {
    const { editor } = sceneWith("a", "b");
    let notified = 0;
    editor.onChange(() => (notified += 1));
    editor.select("b");
    expect(editor.selection).toBe("b");
    expect(editor.context().selectedObjectIds).toEqual(["b"]);
    expect(notified).toBe(1);
    editor.select("b");
    expect(notified).toBe(1);
    editor.select(null);
    expect(editor.context().selectedObjectIds).toEqual([]);
  });

  it("ignores ids that are not in the scene", () => {
    const { editor } = sceneWith("a");
    editor.select("ghost");
    expect(editor.selection).toBeNull();
  });

  it("drops the selection when the object is deleted, and when the scene is emptied", () => {
    const { editor } = sceneWith("a", "b");
    editor.select("a");
    const remove = [{ commandId: "d", type: "scene.delete_object", objectId: "a" }];
    expect(editor.execute("p2", 1, remove).status).toBe("applied");
    expect(editor.selection).toBeNull();
    editor.select("b");
    editor.reset();
    expect(editor.selection).toBeNull();
  });

  it("keeps the selection through the assistant's other changes", () => {
    const { editor } = sceneWith("a", "b");
    editor.select("a");
    const move = [{ commandId: "m", type: "scene.transform_object", objectId: "b", transform: { position: [5, 0, 0] } }];
    editor.execute("p2", 1, move);
    expect(editor.selection).toBe("a");
  });
});

describe("edits made by the user", () => {
  it("move the object and produce commands that replay to the same place", () => {
    const { editor } = sceneWith("a");
    const edit = editor.applyUserTransform("a", moved);
    expect(edit.applied).toBe(true);
    expect(editor.transformOf("a")).toEqual(moved);
    expect(editor.currentRevision).toBe(2);

    const fresh = new EditorScene(new Scene(), "prj_2");
    fresh.execute("p1", 0, [box("a")]);
    expect(fresh.execute("replay", 1, edit.commands).status).toBe("applied");
    expect(fresh.transformOf("a")).toEqual(moved);
  });

  it("can be undone by applying the earlier transform", () => {
    const { editor } = sceneWith("a");
    const before = editor.transformOf("a");
    editor.applyUserTransform("a", moved);
    if (before) editor.applyUserTransform("a", before);
    expect(editor.transformOf("a")).toEqual(before);
  });

  it("are refused for an object that does not exist", () => {
    const { editor } = sceneWith("a");
    expect(editor.applyUserTransform("ghost", moved).applied).toBe(false);
    expect(editor.currentRevision).toBe(1);
  });

  it("know whether the scene belongs to a saved project", () => {
    const blank = new EditorScene(new Scene(), "unsaved-project");
    expect(blank.hasProject).toBe(false);
    blank.bindProject("prj_9");
    expect(blank.hasProject).toBe(true);
  });
});

describe("picking", () => {
  function view() {
    const { scene, editor } = sceneWith("a");
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    return { scene, editor, camera };
  }

  it("finds the object under the pointer and nothing in empty space", () => {
    const { editor, camera } = view();
    expect(pickObjectId(editor, camera, new Vector2(0, 0))).toBe("a");
    expect(pickObjectId(editor, camera, new Vector2(0.95, 0.95))).toBeUndefined();
  });

  it("picks a whole imported model when any part of it is hit", () => {
    const { scene, editor, camera } = view();
    const model = new Group();
    const part = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    part.position.set(0, 0, 0);
    model.add(part);
    model.position.set(0, 3, 0);
    editor.importObject("model", model);
    camera.position.set(0, 3, 5);
    camera.lookAt(0, 3, 0);
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    expect(pickObjectId(editor, camera, new Vector2(0, 0))).toBe("model");
    expect(editor.idOf(part)).toBe("model");
  });

  it("converts pointer positions to device coordinates, with y pointing up", () => {
    const bounds = { left: 100, top: 50, width: 200, height: 100 };
    expect(toNdc(200, 100, bounds).toArray()).toEqual([0, 0]);
    expect(toNdc(100, 50, bounds).toArray()).toEqual([-1, 1]);
    expect(toNdc(300, 150, bounds).toArray()).toEqual([1, -1]);
  });
});

describe("typed values", () => {
  it("reads plain numbers and drops everything else", () => {
    expect(parseNumber(" 1.5 ")).toBe(1.5);
    expect(parseNumber("-2")).toBe(-2);
    expect(parseNumber("3,25")).toBe(3.25);
    expect(parseNumber(".5")).toBe(0.5);
    for (const text of ["", "abc", "1e9", "1.2.3", "--1", "Infinity", "12px"])
      expect(parseNumber(text)).toBeUndefined();
  });

  it("shows numbers briefly, never as -0", () => {
    expect(formatNumber(1.23456)).toBe("1.235");
    expect(formatNumber(2)).toBe("2");
    expect(formatNumber(-0.0001)).toBe("0");
    expect(formatNumber(-0)).toBe("0");
  });

  it("converts rotations between degrees and radians", () => {
    expect(radiansToDegrees([Math.PI, Math.PI / 2, 0])[0]).toBeCloseTo(180);
    expect(degreesToRadians([90, 0, 0])[0]).toBeCloseTo(Math.PI / 2);
  });

  it("changes one axis at a time without touching the original", () => {
    const original: [number, number, number] = [1, 2, 3];
    expect(withAxis(original, 1, 9)).toEqual([1, 9, 3]);
    expect(original).toEqual([1, 2, 3]);
  });

  it("treats transforms that differ by rounding noise as the same", () => {
    expect(sameTransform(moved, { ...moved, position: [1, 2, 3 + 1e-9] })).toBe(true);
    expect(sameTransform(moved, { ...moved, scale: [2, 2, 2.01] })).toBe(false);
  });
});

describe("deleting objects", () => {
  const group = (objectId: string, parentId?: string) => ({
    commandId: `create-${objectId}`,
    type: "scene.create_object",
    objectId,
    name: objectId,
    ...(parentId ? { parentId } : {}),
  });
  const remove = (objectId: string) => ({ commandId: `del-${objectId}`, type: "scene.delete_object", objectId });

  function family() {
    const scene = new Scene();
    const editor = new EditorScene(scene, "prj_1");
    editor.execute("p1", 0, [group("arm"), group("hand", "arm"), group("finger", "hand"), box("other")]);
    return { scene, editor };
  }

  it("lists an object's children before the object, deepest first", () => {
    const { editor } = family();
    expect(editor.deleteCommandsFor("arm")).toMatchObject([
      { objectId: "finger" },
      { objectId: "hand" },
      { objectId: "arm" },
    ]);
    expect(editor.deleteCommandsFor("ghost")).toEqual([]);
  });

  it("removes the object with everything below it, and leaves the rest alone", () => {
    const { editor } = family();
    editor.select("hand");
    expect(editor.applyUserEdit(editor.deleteCommandsFor("arm"))).toBe(true);
    expect(editor.context().objects.map((object) => object.id)).toEqual(["other"]);
    expect(editor.selection).toBeNull();
    expect(editor.idOf(new Group())).toBeUndefined();
  });

  it("refuses to delete a parent before its children, and changes nothing", () => {
    const { editor } = family();
    const before = editor.currentRevision;
    const result = editor.execute("p2", before, [remove("arm")]);
    expect(result.status).toBe("failed");
    expect(result.message).toContain('Delete the children of "arm"');
    expect(editor.currentRevision).toBe(before);
    expect(editor.context().objects).toHaveLength(4);
  });

  it("applies a batch whole or not at all", () => {
    const { editor } = family();
    const failing = [remove("finger"), remove("ghost")];
    expect(editor.execute("p2", editor.currentRevision, failing).status).toBe("failed");
    expect(editor.getObject("finger")).toBeDefined();
    const moveAfter = [remove("other"), { commandId: "m", type: "scene.transform_object", objectId: "other", transform: {} }];
    expect(editor.execute("p3", editor.currentRevision, moveAfter).status).toBe("failed");
    expect(editor.getObject("other")).toBeDefined();
    expect(editor.execute("p4", editor.currentRevision, [remove("other"), remove("other")]).status).toBe("failed");
  });

  it("frees the parts of an imported model", () => {
    const editor = new EditorScene(new Scene(), "prj_1");
    const model = new Group();
    const part = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    model.add(part);
    let freed = 0;
    part.geometry.addEventListener("dispose", () => (freed += 1));
    editor.importObject("model", model);
    expect(editor.applyUserEdit(editor.deleteCommandsFor("model"))).toBe(true);
    expect(freed).toBe(1);
    expect(model.children).toHaveLength(0);
    expect(part.parent).toBeNull();
  });

  it("replays from a saved history to the same scene", async () => {
    const { editor } = family();
    const commands = editor.deleteCommandsFor("arm");
    editor.applyUserEdit(commands);
    const replayed = new EditorScene(new Scene(), "prj_2");
    await replayed.restore(
      [
        { kind: "commands", proposalId: "p1", commands: [group("arm"), group("hand", "arm"), group("finger", "hand"), box("other")] },
        { kind: "commands", proposalId: "usr_1", commands },
      ],
      () => Promise.reject(new Error("no imports")),
    );
    expect(replayed.context().objects.map((object) => object.id)).toEqual(["other"]);
  });
});
