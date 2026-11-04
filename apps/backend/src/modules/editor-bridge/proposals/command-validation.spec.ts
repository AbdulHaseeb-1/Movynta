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
    const selectedFaces: EditorCommand = { commandId: "f", type: "geometry.subdivide_faces", objectId: "box", meshPath: [], ids: ["0"] };
    expect(validateAgainstContext([{ ...selectedFaces, objectId: "missing" }], emptyScene)[0]?.message).toContain("does not exist");
    expect(validateAgainstContext([selectedFaces, create("c", "new")], sceneWith({ id: "box", parentId: null }))[0]?.message).toContain("only extrude");
    expect(validateAgainstContext([selectedFaces, { ...extrude, commandId: "e2", objectId: "box" }], sceneWith({ id: "box", parentId: null }))).toEqual([]);
    const cut = (commandId: string, objectId: string, operandObjectId: string): EditorCommand => ({
      commandId, type: "geometry.set_modifiers", objectId, meshPath: [],
      modifiers: [{ id: "cut", kind: "boolean", enabled: true, operation: "difference", operandObjectId, operandMeshPath: [] }],
    });
    const scene = sceneWith({ id: "box", parentId: null }, { id: "cutter", parentId: null });
    expect(validateAgainstContext([cut("b", "box", "cutter")], scene)).toEqual([]);
    expect(validateAgainstContext([cut("b", "box", "missing")], scene)[0]?.message).toContain("operand");
    expect(validateAgainstContext([cut("b", "box", "box")], scene)[0]?.message).toContain("own mesh");
    expect(validateAgainstContext([cut("a", "box", "cutter"), cut("b", "cutter", "box")], scene).some((issue) => issue.message.includes("cycle"))).toBe(true);
  });
  it("explains the create_object then create_primitive mix-up and how to fix it", () => {
    const issues = validateAgainstContext([create("a", "crate"), primitive("b", "crate")], emptyScene);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.commandId).toBe("b");
    expect(issues[0]?.message).toContain("already created earlier in this batch");
    expect(issues[0]?.message).toContain("replaceExisting");
  });

  it("batches face transforms with extrusion and tracks Boolean cycles across mesh parts", () => {
    const scene = sceneWith({ id: "box", parentId: null }, { id: "cutter", parentId: null });
    const move: EditorCommand = {
      type: "geometry.transform_faces", commandId: "move", objectId: "box", meshPath: [], ids: ["0"],
      space: "world", transform: { position: [0, 1, 0] },
    };
    expect(validateAgainstContext([move, {
      type: "geometry.extrude", commandId: "extrude", objectId: "box", meshPath: [], ids: ["0"], kind: "face", normalDistance: 1, steps: 3,
    }], scene)).toEqual([]);
    const cut: EditorCommand = {
      type: "geometry.boolean", commandId: "cut", objectId: "box", meshPath: [0], operandObjectId: "box", operandMeshPath: [1], operation: "difference",
    };
    expect(validateAgainstContext([cut], scene)).toEqual([]);
    expect(validateAgainstContext([cut, { ...cut, commandId: "reverse", meshPath: [1], operandMeshPath: [0] }], scene)
      .some((issue) => issue.message.includes("cycle"))).toBe(true);
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

describe("validateAgainstContext with a parent, name and place on shapes", () => {
  const capable: EditorContext = { ...emptyScene, supportsSceneGraph: true };
  const under = (commandId: string, objectId: string, parentId: string): EditorCommand => ({
    ...primitive(commandId, objectId),
    parentId,
    name: "Part",
    transform: { position: [1, 0, 0] },
  } as EditorCommand);
  const mesh = (commandId: string, objectId: string, parentId: string): EditorCommand => ({
    commandId,
    type: "geometry.create_mesh",
    objectId,
    parentId,
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    faces: [[0, 1, 2]],
  });

  it("accepts a shape under a group created earlier in the same batch", () => {
    expect(validateAgainstContext([create("g", "figure"), under("a", "torso", "figure"), mesh("m", "fin", "figure")], capable)).toEqual([]);
  });

  it("names a missing parent and how to fix it", () => {
    const issues = validateAgainstContext([under("a", "torso", "nobody"), mesh("m", "fin", "nobody")], capable);
    expect(issues.map((issue) => issue.commandId)).toEqual(["a", "m"]);
    expect(issues[0]?.message).toContain('parentId "nobody" does not exist');
  });

  it("counts a shape created under a parent when its parent is deleted", () => {
    const issues = validateAgainstContext([create("g", "figure"), under("a", "torso", "figure"), remove("d", "figure")], capable);
    expect(issues.map((issue) => issue.commandId)).toEqual(["d"]);
    expect(issues[0]?.message).toContain("still has children (torso)");
  });

  it("refuses the new fields for an editor that does not advertise them, but not the old ones", () => {
    const old = emptyScene;
    const issues = validateAgainstContext([create("g", "figure"), under("a", "torso", "figure"), primitive("p", "plain")], old);
    expect(issues.map((issue) => issue.commandId)).toEqual(["a"]);
    expect(issues[0]?.message).toContain("too old");
  });
});

describe("validateAgainstContext with moves and re-parenting", () => {
  type Place = { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] };
  const placed = (...objects: { id: string; parentId?: string | null; place?: Place }[]): EditorContext => ({
    ...emptyScene,
    supportsSceneGraph: true,
    objects: objects.map((object) => ({
      id: object.id,
      name: object.id,
      type: "mesh",
      parentId: object.parentId ?? null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], ...object.place },
    })) as unknown as EditorContext["objects"],
  });
  const reparent = (commandId: string, objectId: string, parentId: string | null): EditorCommand => ({ commandId, type: "scene.set_parent", objectId, parentId });
  const rescale = (objectId: string, scale: [number, number, number]): EditorCommand => ({ commandId: `scale-${objectId}`, type: "scene.transform_object", objectId, transform: { scale } });
  const uneven = { scale: [2, 1, 1] } as Place;
  const turned = { rotation: [0, 0.6, 0] } as Place;

  describe("scene.move_object", () => {
    const move = (objectId: string): EditorCommand => ({ commandId: "m", type: "scene.move_object", objectId, delta: [0, 1, 0] });

    it("accepts a move of an object that exists, including one created earlier in the batch", () => {
      expect(validateAgainstContext([move("a")], placed({ id: "a" }))).toEqual([]);
      expect(validateAgainstContext([create("c", "new"), { ...move("new"), commandId: "m2" }], placed())).toEqual([]);
    });

    it("names an object that does not exist", () => {
      expect(validateAgainstContext([move("ghost")], placed())[0]?.message).toContain('"ghost" does not exist');
    });

    it("is refused for an editor that does not advertise it, with the way around it", () => {
      const old = { ...placed({ id: "a" }), supportsSceneGraph: undefined } as EditorContext;
      const [issue] = validateAgainstContext([move("a")], old);
      expect(issue?.message).toContain("too old for scene.move_object");
      expect(issue?.message).toContain("scene.transform_object");
    });
  });

  describe("the shear rule", () => {
    it("refuses a turned part under a group scaled by different amounts, and says how to avoid it", () => {
      const [issue] = validateAgainstContext([reparent("s", "part", "group")], placed({ id: "group", place: uneven }, { id: "part", place: turned }));
      expect(issue?.commandId).toBe("s");
      expect(issue?.message).toContain("shearing");
      expect(issue?.message).toContain("same scale on every axis");
      expect(issue?.message).toContain("parentId");
    });

    it("accepts the same move when the group is scaled the same on every axis", () => {
      expect(validateAgainstContext([reparent("s", "part", "group")], placed({ id: "group", place: { scale: [2, 2, 2] } }, { id: "part", place: turned }))).toEqual([]);
    });

    it("accepts a part that is not turned, because its axes stay perpendicular", () => {
      expect(validateAgainstContext([reparent("s", "part", "group")], placed({ id: "group", place: uneven }, { id: "part" }))).toEqual([]);
    });

    it("judges a move out of an unevenly scaled group the same way", () => {
      const scene = placed({ id: "group", place: uneven }, { id: "part", parentId: "group", place: turned });
      expect(validateAgainstContext([reparent("s", "part", null)], scene)[0]?.message).toContain("the top level");
    });

    it("follows a scale set earlier in the same batch, and does not mind one set afterwards", () => {
      const scene = placed({ id: "group" }, { id: "part", place: turned });
      expect(validateAgainstContext([rescale("group", [2, 1, 1]), reparent("s", "part", "group")], scene)).toHaveLength(1);
      expect(validateAgainstContext([reparent("s", "part", "group"), rescale("group", [2, 1, 1])], scene)).toEqual([]);
    });

    it("follows objects created earlier in the same batch", () => {
      const commands: EditorCommand[] = [
        { ...create("g", "group"), transform: { scale: [2, 1, 1] } } as EditorCommand,
        { ...primitive("p", "part"), transform: { rotation: [0, 0.6, 0] } } as EditorCommand,
        reparent("s", "part", "group"),
      ];
      expect(validateAgainstContext(commands, placed()).map((issue) => issue.commandId)).toEqual(["s"]);
    });

    it("never asks about a part created under the group, since its place is stored as given", () => {
      const commands: EditorCommand[] = [
        { ...create("g", "group"), transform: { scale: [2, 1, 1] } } as EditorCommand,
        { ...primitive("p", "part"), parentId: "group", transform: { rotation: [0, 0.6, 0] } } as EditorCommand,
      ];
      expect(validateAgainstContext(commands, placed())).toEqual([]);
    });

    it("sees a move already made in the batch, so a second one is judged from where the first left the part", () => {
      // The part is turned and the first group is uneven: the first move is refused and the batch stops being judged there.
      const scene = placed({ id: "one", place: uneven }, { id: "two", place: { scale: [3, 3, 3] } }, { id: "part", place: turned });
      expect(validateAgainstContext([reparent("a", "part", "two"), reparent("b", "part", "one")], scene).map((issue) => issue.commandId)).toEqual(["b"]);
    });

    it("explains a scale of zero on either side, which would flatten the mesh or cannot be undone", () => {
      const flatGroup = validateAgainstContext([reparent("s", "part", "group")], placed({ id: "group", place: { scale: [1, 0, 1] } }, { id: "part" }));
      expect(flatGroup[0]?.message).toContain('"group" has no size');
      const flatPart = validateAgainstContext([reparent("s", "part", "group")], placed({ id: "group" }, { id: "part", place: { scale: [1, 0, 1] } }));
      expect(flatPart[0]?.message).toContain("flattening its mesh");
    });

    it("does not follow placement at all for a batch with no re-parenting", () => {
      expect(validateAgainstContext([rescale("group", [2, 1, 1]), create("c", "other")], placed({ id: "group" }))).toEqual([]);
    });
  });
});
