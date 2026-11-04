import { describe, expect, it } from "vitest";
import { Box3, Group, Scene, Vector3 } from "three";
import { editorCommandSchema } from "@movynta/editor-protocol";
import { EditorScene } from "./EditorScene";

type Vec3 = [number, number, number];

const group = (commandId: string, objectId: string, name: string, parentId?: string, position?: Vec3) => ({
  commandId,
  type: "scene.create_object",
  objectId,
  name,
  ...(parentId ? { parentId } : {}),
  ...(position ? { transform: { position } } : {}),
});
const box = (commandId: string, objectId: string, extra: Record<string, unknown> = {}) => ({
  commandId,
  type: "geometry.create_primitive",
  objectId,
  primitive: "box",
  size: 1,
  replaceExisting: false,
  ...extra,
});
const rename = (commandId: string, objectId: string, name: string) => ({ commandId, type: "scene.rename_object", objectId, name });
const names = (editor: EditorScene) => editor.context().objects.map((object) => `${object.id}=${object.name}`);

describe("creating shapes with a name, a parent and a place", () => {
  it("names a shape after its kind when no name is given, as it always did", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [box("c", "one")]);
    expect(names(editor)).toEqual(["one=box"]);
  });

  it("creates a shape under a parent at a place that is local to the parent, in one command", () => {
    const editor = new EditorScene(new Scene(), "p");
    const result = editor.execute("a", 0, [
      group("g", "figure", "Figure", undefined, [10, 0, 0]),
      box("t", "torso", { name: "Torso", parentId: "figure", transform: { position: [1, 2, 0] } }),
    ]);
    expect(result.status).toBe("applied");
    const torso = editor.getObject("torso");
    expect(torso?.position.toArray()).toEqual([1, 2, 0]);
    expect(torso?.getWorldPosition(new Vector3()).toArray()).toEqual([11, 2, 0]);
    expect(editor.context().objects.find((object) => object.id === "torso")).toMatchObject({ name: "Torso", parentId: "figure" });
  });

  it("creates a custom mesh under a parent too", () => {
    const editor = new EditorScene(new Scene(), "p");
    const result = editor.execute("a", 0, [
      group("g", "figure", "Figure"),
      {
        commandId: "m", type: "geometry.create_mesh", objectId: "tri", name: "Fin", parentId: "figure",
        vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]], transform: { position: [0, 3, 0] },
      },
    ]);
    expect(result.status).toBe("applied");
    expect(editor.context().objects.find((object) => object.id === "tri")).toMatchObject({ name: "Fin", parentId: "figure" });
    expect(editor.getObject("tri")?.position.toArray()).toEqual([0, 3, 0]);
  });

  it("fails the whole batch, creating nothing, when the parent does not exist", () => {
    const editor = new EditorScene(new Scene(), "p");
    const result = editor.execute("a", 0, [box("c1", "ok"), box("c2", "lost", { parentId: "nobody" })]);
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).toContain('Parent \\"nobody\\" does not exist');
    expect(editor.context().objects).toEqual([]);
  });

  it("does not let a replaced shape be given a name, a parent or a place", () => {
    const base = { commandId: "r", type: "geometry.create_primitive", objectId: "x", primitive: "sphere", size: 1, replaceExisting: true };
    expect(editorCommandSchema.safeParse(base).success).toBe(true);
    for (const extra of [{ name: "N" }, { parentId: "p" }, { transform: { position: [0, 0, 0] } }]) {
      expect(editorCommandSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });

  it("advertises the capability", () => {
    expect(new EditorScene(new Scene(), "p").context().supportsSceneGraph).toBe(true);
  });
});

describe("names stay distinct among siblings", () => {
  it("numbers a name that a sibling already has, and reports what it became", () => {
    const editor = new EditorScene(new Scene(), "p");
    const result = editor.execute("a", 0, [box("c1", "a"), box("c2", "b"), box("c3", "c", { name: "box" })]);
    expect(names(editor)).toEqual(["a=box", "b=box.001", "c=box.002"]);
    expect(result.results.map((item) => ("name" in item ? item.name : undefined))).toEqual(["box", "box.001", "box.002"]);
  });

  it("allows the same name under different parents", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [
      group("g1", "left", "Left"), group("g2", "right", "Right"),
      box("c1", "l-arm", { name: "Arm", parentId: "left" }),
      box("c2", "r-arm", { name: "Arm", parentId: "right" }),
    ]);
    expect(names(editor).filter((entry) => entry.endsWith("=Arm"))).toHaveLength(2);
  });

  it("renames to a free name as asked and to a numbered one when the name is taken", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [box("c1", "a", { name: "Head" }), box("c2", "b", { name: "Hat" })]);
    const result = editor.execute("b", 1, [rename("r1", "b", "Head"), rename("r2", "a", "Head")]);
    expect(result.status).toBe("applied");
    expect(names(editor)).toEqual(["a=Head", "b=Head.001"]);
    expect(result.results.map((item) => ("name" in item ? item.name : undefined))).toEqual(["Head.001", "Head"]);
  });

  it("renames in one batch as the batch goes, and reuses a name freed by a delete in the same batch", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [box("c1", "a", { name: "Cube" }), box("c2", "b", { name: "Ball" }), box("c3", "c", { name: "Rock" })]);
    const result = editor.execute("b", 1, [
      { commandId: "d", type: "scene.delete_object", objectId: "a" },
      rename("r1", "b", "Cube"),
      rename("r2", "c", "Cube"),
    ]);
    expect(result.status).toBe("applied");
    expect(names(editor)).toEqual(["b=Cube", "c=Cube.001"]);
  });

  it("applies the same rules in a mixed batch that is staged as a copy, and leaves an object's own name alone", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [box("c1", "a", { name: "Head" }), box("c2", "c", { name: "Hat" })]);
    const result = editor.execute("b", 1, [box("c3", "b", { name: "Head" }), rename("r1", "a", "Head"), rename("r2", "c", "Head")]);
    expect(result.status).toBe("applied");
    expect(names(editor)).toEqual(["a=Head", "c=Head.002", "b=Head.001"]);
  });

  it("fails a rename whose numbered name would be too long, and changes nothing", () => {
    const editor = new EditorScene(new Scene(), "p");
    const long = "x".repeat(80);
    editor.execute("a", 0, [box("c1", "a", { name: long }), box("c2", "b", { name: "short" })]);
    const result = editor.execute("b", 1, [rename("r", "b", long)]);
    expect(result.status).toBe("failed");
    expect(names(editor)).toEqual([`a=${long}`, "b=short"]);
  });

  it("renames an object that moves under a parent which already has a child of that name", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [group("g", "figure", "Figure"), box("c1", "arm1", { name: "Arm", parentId: "figure" }), box("c2", "arm2", { name: "Arm" })]);
    const result = editor.execute("b", 1, [{ commandId: "s", type: "scene.set_parent", objectId: "arm2", parentId: "figure" }]);
    expect(result.status).toBe("applied");
    expect(names(editor)).toContain("arm2=Arm.001");
    expect(result.results[0]).toMatchObject({ name: "Arm.001" });
  });

  it("gives an imported model that is imported twice two distinct names", () => {
    const editor = new EditorScene(new Scene(), "p");
    for (const id of ["m1", "m2"]) {
      const model = new Group();
      model.name = "pair.glb";
      editor.importObject(id, model);
    }
    expect(names(editor)).toEqual(["m1=pair.glb", "m2=pair.glb.001"]);
  });

  it("builds the same names when the saved steps are replayed", async () => {
    const live = new EditorScene(new Scene(), "p");
    const steps = [
      [box("c1", "a"), box("c2", "b"), box("c3", "c", { name: "box" })],
      [{ commandId: "d", type: "scene.delete_object", objectId: "b" }, rename("r", "c", "box")],
    ];
    steps.forEach((commands, index) => live.execute(`s${index}`, index, commands));
    const replay = new EditorScene(new Scene(), "p");
    await replay.restore(steps.map((commands, index) => ({ kind: "commands" as const, proposalId: `s${index}`, commands })), () => Promise.reject(new Error("no imports")));
    expect(names(replay)).toEqual(names(live));
  });
});

describe("a figure built as a group", () => {
  const PARTS = 12;
  function figure(): unknown[] {
    return [
      group("g", "figure", "Figure"),
      ...Array.from({ length: PARTS }, (_, index) =>
        box(`p${index}`, `part-${index}`, { name: `Part${index}`, parentId: "figure", transform: { position: [index, 0, 0] } })),
    ];
  }

  it("is built in 13 commands, where it used to take 24, and every part sits under the group", () => {
    const editor = new EditorScene(new Scene(), "p");
    const commands = figure();
    expect(commands).toHaveLength(13);
    expect(editor.execute("a", 0, commands).status).toBe("applied");
    const objects = editor.context().objects;
    expect(objects.filter((object) => object.parentId === "figure")).toHaveLength(PARTS);
    expect(objects.filter((object) => object.parentId === null).map((object) => object.id)).toEqual(["figure"]);
  });

  it("moves with one command instead of one per part", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, figure());
    const bounds = () => new Box3().setFromObject(editor.getObject("figure") ?? new Group());
    const before = bounds();
    const result = editor.execute("b", 1, [{ commandId: "m", type: "scene.transform_object", objectId: "figure", transform: { position: [0, 5, 0] } }]);
    expect(result.status).toBe("applied");
    const after = bounds();
    expect(after.min.y - before.min.y).toBeCloseTo(5);
    expect(after.max.x - before.max.x).toBeCloseTo(0);
    expect(editor.getObject("part-11")?.getWorldPosition(new Vector3()).toArray()).toEqual([11, 5, 0]);
  });
});
