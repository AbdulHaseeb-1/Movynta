import type { EditorCommand } from "../../../shared/types/editor-command.types.js";
import type { EditorContext } from "../../../shared/types/editor-context.types.js";
import { validateAgainstContext } from "./command-proposal.service.js";

const transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } as const;
const emptyScene: EditorContext = {
  projectId: "p",
  revision: 0,
  activeSceneName: "Main",
  selectedObjectIds: [],
  objects: [],
};
const sceneWith = (...objects: { id: string; parentId: string | null }[]): EditorContext => ({
  ...emptyScene,
  objects: objects.map((object) => ({
    ...object,
    name: object.id,
    type: "empty",
    transform: { position: [...transform.position], rotation: [...transform.rotation], scale: [...transform.scale] },
  })) as unknown as EditorContext["objects"],
});

const create = (commandId: string, objectId: string, parentId?: string): EditorCommand => ({
  type: "scene.create_object",
  commandId,
  objectId,
  name: objectId,
  ...(parentId ? { parentId } : {}),
});
const primitive = (commandId: string, objectId: string, replaceExisting = false): EditorCommand => ({
  type: "geometry.create_primitive",
  commandId,
  objectId,
  primitive: "box",
  size: 1,
  replaceExisting,
});
const remove = (commandId: string, objectId: string): EditorCommand => ({
  type: "scene.delete_object",
  commandId,
  objectId,
});

describe("validateAgainstContext", () => {
  it("checks modifier targets and rejects mixed geometry batches", () => {
    const subdivide: EditorCommand = { commandId: "s", type: "geometry.subdivide", objectId: "missing", meshPath: [], levels: 1 };
    expect(validateAgainstContext([subdivide], emptyScene)[0]?.message).toContain("does not exist");
    expect(validateAgainstContext([subdivide, create("c", "new")], emptyScene)[0]?.message).toContain("only bevel/subdivision");
    const extrude: EditorCommand = { commandId: "e", type: "geometry.extrude", objectId: "missing", meshPath: [], kind: "face", ids: ["0"], offset: [0, 1, 0] };
    expect(validateAgainstContext([extrude], emptyScene)[0]?.message).toContain("does not exist");
    expect(validateAgainstContext([{ ...extrude, objectId: "box" }, create("c", "new")], sceneWith({ id: "box", parentId: null }))[0]?.message).toContain("only extrude");
    expect(validateAgainstContext([{ ...extrude, objectId: "box" }], sceneWith({ id: "box", parentId: null }))).toEqual([]);
  });
  it("explains the create_object then create_primitive mix-up and how to fix it", () => {
    const issues = validateAgainstContext([create("a", "crate"), primitive("b", "crate")], emptyScene);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.commandId).toBe("b");
    expect(issues[0]?.message).toContain("already created earlier in this batch");
    expect(issues[0]?.message).toContain("replaceExisting");
  });

  it("accepts a group turned into a shape with replaceExisting, and fresh primitives", () => {
    expect(validateAgainstContext([create("a", "crate"), primitive("b", "crate", true)], emptyScene)).toEqual([]);
    expect(validateAgainstContext([primitive("a", "left"), primitive("b", "right")], emptyScene)).toEqual([]);
  });

  it("tells apart ids that are already in the scene", () => {
    const [issue] = validateAgainstContext([primitive("a", "cube")], sceneWith({ id: "cube", parentId: null }));
    expect(issue?.message).toContain("already exists in the scene");
  });

  it("names the missing object, parent and replacement target", () => {
    const messages = validateAgainstContext(
      [
        { type: "scene.transform_object", commandId: "t", objectId: "ghost", transform: {} },
        create("c", "child", "nobody"),
        primitive("p", "absent", true),
      ],
      emptyScene,
    ).map((issue) => issue.message);
    expect(messages[0]).toContain('"ghost" does not exist');
    expect(messages[1]).toContain('parentId "nobody" does not exist');
    expect(messages[2]).toContain('"absent" cannot be replaced');
  });

  it("rejects deleting a parent before its children, and allows children first", () => {
    const scene = sceneWith({ id: "arm", parentId: null }, { id: "hand", parentId: "arm" });
    const [issue] = validateAgainstContext([remove("a", "arm")], scene);
    expect(issue?.message).toContain("still has children (hand)");
    expect(validateAgainstContext([remove("a", "hand"), remove("b", "arm")], scene)).toEqual([]);
  });

  it("counts children created in the same batch", () => {
    const issues = validateAgainstContext([create("a", "arm"), create("b", "hand", "arm"), remove("c", "arm")], emptyScene);
    expect(issues.map((issue) => issue.commandId)).toEqual(["c"]);
  });

  it("flags a repeated commandId", () => {
    const issues = validateAgainstContext([primitive("same", "a"), primitive("same", "b")], emptyScene);
    expect(issues[0]?.message).toContain("commandId is used more than once");
  });
});
