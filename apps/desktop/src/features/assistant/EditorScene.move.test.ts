import { describe, expect, it } from "vitest";
import { Scene, Vector3 } from "three";
import { editorCommandSchema } from "@movynta/editor-protocol";
import { EditorScene } from "./EditorScene";

type Vec3 = [number, number, number];
const group = (id: string, extra: Record<string, unknown> = {}) => ({ commandId: `c_${id}`, type: "scene.create_object", objectId: id, name: id, ...extra });
const move = (commandId: string, objectId: string, delta: Vec3) => ({ commandId, type: "scene.move_object", objectId, delta });
const position = (editor: EditorScene, id: string) => editor.getObject(id)?.position.toArray();

describe("scene.move_object", () => {
  it("adds the distance to where the object is now", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [group("g", { transform: { position: [1, 2, 3] } })]);
    expect(editor.execute("b", 1, [move("m", "g", [0.5, -1, 2])]).status).toBe("applied");
    expect(position(editor, "g")).toEqual([1.5, 1, 5]);
  });

  it("adds up moves of the same object in one batch, with other changes in between", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [group("g")]);
    const result = editor.execute("b", 1, [move("m1", "g", [1, 0, 0]), { commandId: "r", type: "scene.rename_object", objectId: "g", name: "Group" }, move("m2", "g", [1, 0, 0])]);
    expect(result.status).toBe("applied");
    expect(position(editor, "g")).toEqual([2, 0, 0]);
    expect(editor.context().objects[0]?.name).toBe("Group");
  });

  it("keeps a move the user made after the batch was written, which an absolute position would overwrite", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [group("g", { transform: { position: [1, 0, 0] } })]);
    // The assistant read x = 1 and wrote its batch; meanwhile the user drags the group to x = 6.
    expect(editor.applyUserTransform("g", { position: [6, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }).applied).toBe(true);
    expect(editor.execute("relative", editor.currentRevision, [move("m", "g", [2, 0, 0])]).status).toBe("applied");
    expect(position(editor, "g")).toEqual([8, 0, 0]);
    // The absolute command for the same intent would have put it back to x = 3.
    editor.execute("absolute", editor.currentRevision, [{ commandId: "t", type: "scene.transform_object", objectId: "g", transform: { position: [3, 0, 0] } }]);
    expect(position(editor, "g")).toEqual([3, 0, 0]);
  });

  it("moves along the parent's axes, so under a turned parent the world movement is turned too", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [group("parent", { transform: { rotation: [0, Math.PI / 2, 0] } }), group("child", { parentId: "parent" })]);
    editor.execute("b", 1, [move("m", "child", [1, 0, 0])]);
    expect(position(editor, "child")).toEqual([1, 0, 0]);
    const world = editor.getObject("child")?.getWorldPosition(new Vector3());
    expect(world?.x).toBeCloseTo(0, 9);
    expect(world?.z).toBeCloseTo(-1, 9);
  });

  it("moves the children along with their parent without touching their own positions", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [group("parent"), group("child", { parentId: "parent", transform: { position: [0, 1, 0] } })]);
    editor.execute("b", 1, [move("m", "parent", [5, 0, 0])]);
    expect(position(editor, "child")).toEqual([0, 1, 0]);
    expect(editor.getObject("child")?.getWorldPosition(new Vector3()).toArray()).toEqual([5, 1, 0]);
  });

  it("fails the whole batch and changes nothing when the object does not exist", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [group("g")]);
    const result = editor.execute("b", 1, [move("m1", "g", [1, 0, 0]), move("m2", "ghost", [1, 0, 0])]);
    expect(result.status).toBe("failed");
    expect(position(editor, "g")).toEqual([0, 0, 0]);
  });

  it("is recorded as a revision like any other change, and replays to the same place", async () => {
    const live = new EditorScene(new Scene(), "p");
    const steps = [[group("g", { transform: { position: [1, 0, 0] } })], [move("m", "g", [2, 0, 0])], [move("n", "g", [0, 3, 0])]];
    steps.forEach((commands, index) => live.execute(`s${index}`, index, commands));
    const replay = new EditorScene(new Scene(), "p");
    await replay.restore(steps.map((commands, index) => ({ kind: "commands" as const, proposalId: `s${index}`, commands })), () => Promise.reject(new Error("no imports")));
    expect(position(replay, "g")).toEqual([3, 3, 0]);
    expect(replay.currentRevision).toBe(live.currentRevision);
  });
});

describe("scene.move_object in the protocol", () => {
  const base = { commandId: "m", type: "scene.move_object", objectId: "g" };
  it("needs a distance that moves the object, within a sane range", () => {
    expect(editorCommandSchema.safeParse({ ...base, delta: [0, 1, 0] }).success).toBe(true);
    expect(editorCommandSchema.safeParse({ ...base, delta: [0, 0, 0] }).success).toBe(false);
    expect(editorCommandSchema.safeParse({ ...base, delta: [100001, 0, 0] }).success).toBe(false);
    expect(editorCommandSchema.safeParse({ ...base, delta: [Number.NaN, 0, 0] }).success).toBe(false);
    expect(editorCommandSchema.safeParse({ ...base, delta: [1, 0] }).success).toBe(false);
    expect(editorCommandSchema.safeParse({ ...base, delta: [1, 0, 0], space: "world" }).success).toBe(false);
  });
});
