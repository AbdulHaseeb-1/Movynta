import { describe, expect, it } from "vitest";
import { Group, Object3D, PerspectiveCamera, Quaternion, Scene, Vector3 } from "three";
import { editorCommandListSchema } from "@movynta/editor-protocol";
import { EditorScene } from "../assistant/EditorScene";
import { inBatches } from "./batches";
import { idsInRect, rectBetween } from "./boxSelect";
import { GroupTransform, medianPosition, topLevel } from "./groupTransform";

const box = (objectId: string) => ({
  commandId: `create-${objectId}`,
  type: "geometry.create_primitive",
  objectId,
  primitive: "box",
  size: 1,
  replaceExisting: false,
});

function sceneWith(...ids: string[]) {
  const editor = new EditorScene(new Scene(), "prj_1");
  editor.execute("p1", 0, ids.map(box));
  return editor;
}

describe("selecting several objects", () => {
  it("keeps the order they were chosen in, with the last one active", () => {
    const editor = sceneWith("a", "b", "c");
    editor.selectMany(["b", "a", "c"]);
    expect(editor.selectedIds).toEqual(["b", "a", "c"]);
    expect(editor.selection).toBe("c");
  });

  it("leaves out ids that are not in the scene, and repeats", () => {
    const editor = sceneWith("a", "b");
    editor.selectMany(["a", "ghost", "a", "b"]);
    expect(editor.selectedIds).toEqual(["a", "b"]);
  });

  it("toggles an object in and out, making a newly added one active", () => {
    const editor = sceneWith("a", "b", "c");
    editor.select("a");
    editor.toggleSelection("b");
    expect(editor.selectedIds).toEqual(["a", "b"]);
    expect(editor.selection).toBe("b");
    // Toggling an object that is selected but not active makes it active, as Blender does.
    editor.toggleSelection("a");
    expect(editor.selectedIds).toEqual(["b", "a"]);
    expect(editor.selection).toBe("a");
    // Toggling the active object takes it out, and the one chosen before it becomes active.
    editor.toggleSelection("a");
    expect(editor.selectedIds).toEqual(["b"]);
    expect(editor.selection).toBe("b");
    editor.toggleSelection("ghost");
    expect(editor.selectedIds).toEqual(["b"]);
  });

  it("selects everything, and select() goes back to one object", () => {
    const editor = sceneWith("a", "b", "c");
    editor.selectAll();
    expect(editor.selectedIds).toEqual(["a", "b", "c"]);
    editor.select("b");
    expect(editor.selectedIds).toEqual(["b"]);
    editor.select(null);
    expect(editor.selectedIds).toEqual([]);
    expect(editor.selection).toBeNull();
  });

  it("tells listeners only when the selection really changed, and replaces the array when it does", () => {
    const editor = sceneWith("a", "b");
    let notified = 0;
    editor.onChange(() => (notified += 1));
    editor.selectMany(["a", "b"]);
    const first = editor.selectedIds;
    editor.selectMany(["a", "b"]);
    expect(notified).toBe(1);
    expect(editor.selectedIds).toBe(first);
    editor.selectMany(["b", "a"]);
    expect(notified).toBe(2);
    expect(editor.selectedIds).not.toBe(first);
  });

  it("shows the assistant every selected object", () => {
    const editor = sceneWith("a", "b", "c");
    editor.selectMany(["c", "a"]);
    expect(editor.context().selectedObjectIds).toEqual(["c", "a"]);
  });

  it("drops objects that are deleted from the selection and keeps the others", () => {
    const editor = sceneWith("a", "b", "c");
    editor.selectMany(["a", "b", "c"]);
    expect(editor.applyUserEdit(editor.deleteCommandsFor(["b"]))).toBe(true);
    expect(editor.selectedIds).toEqual(["a", "c"]);
    expect(editor.selection).toBe("c");
  });

  it("keeps the selection when a batch replaces the objects with copies", () => {
    const editor = sceneWith("a", "b");
    editor.selectMany(["a", "b"]);
    editor.execute("more", editor.currentRevision, [box("c")]);
    expect(editor.selectedIds).toEqual(["a", "b"]);
  });
});

describe("changing and deleting several objects", () => {
  it("moves several objects in one batch, and refuses it whole if one of them is missing", () => {
    const editor = sceneWith("a", "b");
    const edit = editor.applyUserTransforms([
      { id: "a", transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { id: "b", transform: { position: [4, 5, 6], rotation: [0, 0, 0], scale: [2, 2, 2] } },
    ]);
    expect(edit.applied).toBe(true);
    expect(edit.commands).toHaveLength(2);
    expect(editor.transformOf("a")?.position).toEqual([1, 2, 3]);
    expect(editor.transformOf("b")?.scale).toEqual([2, 2, 2]);

    const refused = editor.applyUserTransforms([
      { id: "a", transform: { position: [9, 9, 9], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { id: "ghost", transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    ]);
    expect(refused.applied).toBe(false);
    expect(editor.transformOf("a")?.position).toEqual([1, 2, 3]);
  });

  it("deletes several objects, each once, the children of any of them before their parent", () => {
    const editor = sceneWith("a", "b");
    editor.execute("tree", editor.currentRevision, [
      { commandId: "g", type: "scene.create_object", objectId: "group", name: "group" },
      { commandId: "k1", type: "scene.create_object", objectId: "kid1", name: "kid", parentId: "group" },
      { commandId: "k2", type: "scene.create_object", objectId: "kid2", name: "kid", parentId: "group" },
    ]);
    // Naming a parent and one of its children, and one object twice, deletes each once.
    const commands = editorCommandListSchema.parse(editor.deleteCommandsFor(["group", "kid1", "a", "a"]));
    const order = commands.map((command) => ("objectId" in command ? command.objectId : ""));
    expect(new Set(order).size).toBe(order.length);
    expect([...order].sort()).toEqual(["a", "group", "kid1", "kid2"]);
    expect(order.indexOf("kid1")).toBeLessThan(order.indexOf("group"));
    expect(order.indexOf("kid2")).toBeLessThan(order.indexOf("group"));
    expect(new Set(commands.map((command) => command.commandId)).size).toBe(commands.length);

    expect(editor.applyUserEdit(commands)).toBe(true);
    expect(editor.context().objects.map((object) => object.id)).toEqual(["b"]);
  });

  it("has nothing to delete for objects that are not in the scene", () => {
    expect(sceneWith("a").deleteCommandsFor(["ghost"])).toEqual([]);
    expect(sceneWith("a").deleteCommandsFor([])).toEqual([]);
  });
});

describe("batches", () => {
  it("split a list into runs of at most the size, in order", () => {
    expect(inBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(inBatches([], 2)).toEqual([]);
    expect(inBatches(Array.from({ length: 450 }, (_, index) => index)).map((batch) => batch.length)).toEqual([200, 200, 50]);
  });
});

describe("moving a group of objects as one", () => {
  function at(x: number, y: number, z: number, parent?: Object3D): Object3D {
    const object = new Object3D();
    object.position.set(x, y, z);
    (parent ?? new Group()).add(object);
    object.updateWorldMatrix(true, false);
    return object;
  }

  it("finds the median point of the objects", () => {
    const point = medianPosition([at(0, 0, 0), at(2, 0, 0), at(4, 6, 0)], new Vector3());
    expect(point.toArray()).toEqual([2, 2, 0]);
    expect(medianPosition([], new Vector3(5, 5, 5)).toArray()).toEqual([0, 0, 0]);
  });

  it("leaves out an object whose parent is also selected, as it moves with the parent", () => {
    const parent = at(1, 0, 0);
    const child = at(0, 1, 0, parent);
    const other = at(5, 0, 0);
    expect(topLevel([parent, child, other])).toEqual([parent, other]);
    expect(topLevel([child, other])).toEqual([child, other]);
  });

  it("turns every object about the pivot by the same amount the pivot turned", () => {
    const first = at(1, 0, 0);
    const second = at(-1, 0, 0);
    const pivot = new Object3D();
    const group = new GroupTransform();
    group.begin(pivot, [first, second]);
    pivot.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    group.update(pivot);

    // A quarter turn about Y takes +x to -z.
    expect(first.position.x).toBeCloseTo(0, 6);
    expect(first.position.z).toBeCloseTo(-1, 6);
    expect(second.position.z).toBeCloseTo(1, 6);
    const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    expect(first.quaternion.angleTo(turned)).toBeCloseTo(0, 6);
  });

  it("does not add up between steps: each update is measured from where the drag began", () => {
    const object = at(1, 0, 0);
    const pivot = new Object3D();
    const group = new GroupTransform();
    group.begin(pivot, [object]);
    pivot.position.set(1, 0, 0);
    group.update(pivot);
    group.update(pivot);
    group.update(pivot);
    expect(object.position.toArray()).toEqual([2, 0, 0]);
    pivot.position.set(0, 3, 0);
    group.update(pivot);
    expect(object.position.toArray()).toEqual([1, 3, 0]);
  });

  it("scales the distances between objects, about the pivot", () => {
    const first = at(2, 0, 0);
    const second = at(0, 2, 0);
    const pivot = new Object3D();
    const group = new GroupTransform();
    group.begin(pivot, [first, second]);
    pivot.scale.setScalar(2);
    group.update(pivot);
    expect(first.position.x).toBeCloseTo(4, 6);
    expect(second.position.y).toBeCloseTo(4, 6);
    expect(first.scale.x).toBeCloseTo(2, 6);
  });

  it("places objects that hang from a moved or scaled parent where the pivot says in the world", () => {
    const parent = at(10, 0, 0);
    parent.scale.setScalar(2);
    parent.updateWorldMatrix(true, false);
    const child = at(1, 0, 0, parent);
    const pivot = new Object3D();
    const group = new GroupTransform();
    group.begin(pivot, [child]);
    pivot.position.set(0, 4, 0);
    group.update(pivot);
    child.updateWorldMatrix(true, false);
    expect(child.getWorldPosition(new Vector3()).toArray()).toEqual([12, 4, 0]);
  });
});

describe("selecting with a rectangle", () => {
  function view() {
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    return camera;
  }

  function scene(...places: [string, number, number, number][]) {
    const editor = new EditorScene(new Scene(), "prj_1");
    editor.execute("p", 0, places.map(([id]) => box(id)));
    for (const [id, x, y, z] of places)
      editor.applyUserTransform(id, { position: [x, y, z], rotation: [0, 0, 0], scale: [1, 1, 1] });
    return editor;
  }

  it("takes the objects whose centers fall inside the rectangle, and no others", () => {
    const editor = scene(["left", -3, 0, 0], ["middle", 0, 0, 0], ["right", 3, 0, 0], ["high", 0, 3, 0]);
    const inside = idsInRect(editor.entries(), view(), rectBetween(-0.2, -0.2, 0.2, 0.2));
    expect(inside).toEqual(["middle"]);
    const wide = idsInRect(editor.entries(), view(), rectBetween(-1, -0.2, 1, 0.2));
    expect(wide.sort()).toEqual(["left", "middle", "right"]);
  });

  it("does not select an object just because its bounds cross the rectangle", () => {
    const editor = scene(["middle", 0, 0, 0]);
    const camera = view();
    expect(idsInRect(editor.entries(), camera, rectBetween(0.06, -0.02, 0.09, 0.02))).toEqual([]);
  });

  it("does not depend on the order the corners were dragged in", () => {
    expect(rectBetween(1, 1, -1, -1)).toEqual(rectBetween(-1, -1, 1, 1));
  });

  it("leaves out objects behind the camera, which project onto the screen as a mirror image", () => {
    const editor = scene(["behind", 0, 0, 20], ["ahead", 0, 0, 0]);
    expect(idsInRect(editor.entries(), view(), rectBetween(-1, -1, 1, 1))).toEqual(["ahead"]);
  });

  it("places an object with nothing to measure by its origin", () => {
    const editor = new EditorScene(new Scene(), "prj_1");
    editor.execute("p", 0, [{ commandId: "g", type: "scene.create_object", objectId: "empty", name: "empty" }]);
    expect(idsInRect(editor.entries(), view(), rectBetween(-0.1, -0.1, 0.1, 0.1))).toEqual(["empty"]);
  });
});
