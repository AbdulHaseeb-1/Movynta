import { describe, expect, it } from "vitest";
import { Matrix4, Scene } from "three";
import { editorCommandSchema } from "@movynta/editor-protocol";
import { EditorScene } from "./EditorScene";

const collection = (id: string, name: string, parentCollectionId?: string) => ({ commandId: `c_${id}`, type: "scene.create_collection", collectionId: id, name, ...(parentCollectionId ? { parentCollectionId } : {}) });
const group = (id: string, extra: Record<string, unknown> = {}) => ({ commandId: `g_${id}`, type: "scene.create_object", objectId: id, name: id, ...extra });
const box = (id: string, extra: Record<string, unknown> = {}) => ({ commandId: `b_${id}`, type: "geometry.create_primitive", objectId: id, primitive: "box", size: 1, replaceExisting: false, ...extra });
const put = (commandId: string, objectId: string, collectionId: string | null, includeChildren?: boolean) => ({ commandId, type: "scene.move_to_collection", objectId, collectionId, ...(includeChildren === undefined ? {} : { includeChildren }) });
const hide = (commandId: string, collectionId: string, visible: boolean) => ({ commandId, type: "scene.set_collection_visibility", collectionId, visible });
const remove = (commandId: string, collectionId: string) => ({ commandId, type: "scene.delete_collection", collectionId });

const where = (editor: EditorScene) => Object.fromEntries(editor.context().objects.map((object) => [object.id, object.collectionId]));
const names = (editor: EditorScene) => (editor.context().collections ?? []).map((entry) => `${entry.id}=${entry.name}`);
const failedMessage = (result: ReturnType<EditorScene["execute"]>) => ("message" in result ? result.message : "");

describe("creating and nesting collections", () => {
  it("makes collections inside each other and lists them in the context", () => {
    const editor = new EditorScene(new Scene(), "p");
    expect(editor.execute("a", 0, [collection("chars", "Characters"), collection("heroes", "Heroes", "chars")]).status).toBe("applied");
    expect(editor.context().collections).toEqual([
      { id: "chars", name: "Characters", parentId: null, visible: true },
      { id: "heroes", name: "Heroes", parentId: "chars", visible: true },
    ]);
    expect(editor.context().supportsCollections).toBe(true);
  });

  it("numbers a name that a collection in the same place has, reports it, and allows it in another place", () => {
    const editor = new EditorScene(new Scene(), "p");
    const result = editor.execute("a", 0, [collection("a", "Props"), collection("b", "Props"), collection("c", "Other"), collection("d", "Props", "c")]);
    expect(names(editor)).toEqual(["a=Props", "b=Props.001", "c=Other", "d=Props"]);
    expect(result.results.map((item) => ("name" in item ? item.name : undefined))).toEqual(["Props", "Props.001", "Other", "Props"]);
  });

  it("renames and moves a collection, keeping names distinct where it lands", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [collection("a", "Props"), collection("b", "Set"), collection("c", "Props", "b")]);
    expect(editor.execute("b", 1, [{ commandId: "r", type: "scene.rename_collection", collectionId: "c", name: "Set" }]).status).toBe("applied");
    expect(names(editor)).toEqual(["a=Props", "b=Set", "c=Set"]);
    const moved = editor.execute("c", 2, [{ commandId: "m", type: "scene.move_collection", collectionId: "c", parentCollectionId: null }]);
    expect(moved.status).toBe("applied");
    expect(names(editor)).toEqual(["a=Props", "b=Set", "c=Set.001"]);
  });

  it("refuses a collection inside itself or inside what it holds, and a repeated id", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [collection("a", "A"), collection("b", "B", "a")]);
    const loop = editor.execute("b", 1, [{ commandId: "m", type: "scene.move_collection", collectionId: "a", parentCollectionId: "b" }]);
    expect(loop.status).toBe("failed");
    expect(failedMessage(loop)).toContain("inside itself");
    expect(editor.execute("c", 1, [collection("a", "Again")]).status).toBe("failed");
  });
});

describe("what is in a collection", () => {
  it("moves an object with everything that hangs below it, and without them when asked", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [collection("set", "Set"), group("fig"), box("torso", { parentId: "fig" }), box("hat", { parentId: "torso" }), box("rock")]);
    expect(editor.execute("b", 1, [put("m", "fig", "set")]).status).toBe("applied");
    expect(where(editor)).toEqual({ fig: "set", torso: "set", hat: "set", rock: null });
    editor.execute("c", 2, [put("n", "fig", null, false)]);
    expect(where(editor)).toEqual({ fig: null, torso: "set", hat: "set", rock: null });
  });

  it("changes nothing in space: an object keeps its place and its parent when it is moved into a collection", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [collection("set", "Set"), group("fig", { transform: { position: [3, 0, 0], scale: [2, 2, 2] } }), box("torso", { parentId: "fig", transform: { position: [1, 2, 0] } })]);
    editor.getObject("torso")?.updateWorldMatrix(true, false);
    const before = new Matrix4().copy(editor.getObject("torso")?.matrixWorld ?? new Matrix4());
    editor.execute("b", 1, [put("m", "torso", "set")]);
    editor.getObject("torso")?.updateWorldMatrix(true, false);
    expect(editor.getObject("torso")?.matrixWorld.elements).toEqual(before.elements);
    expect(editor.context().objects.find((object) => object.id === "torso")?.parentId).toBe("fig");
  });

  it("puts a new object in the collection it is given, else its parent's, else the scene", () => {
    const editor = new EditorScene(new Scene(), "p");
    const result = editor.execute("a", 0, [
      collection("set", "Set"),
      box("given", { collectionId: "set" }),
      group("fig", { collectionId: "set" }),
      box("inherits", { parentId: "fig" }),
      box("elsewhere", { parentId: "fig", collectionId: "set" }),
      box("loose"),
    ]);
    expect(result.status).toBe("applied");
    expect(where(editor)).toEqual({ given: "set", fig: "set", inherits: "set", elsewhere: "set", loose: null });
  });

  it("fails a batch, creating nothing, when a collection it names does not exist", () => {
    const editor = new EditorScene(new Scene(), "p");
    const result = editor.execute("a", 0, [box("ok"), box("lost", { collectionId: "nowhere" })]);
    expect(result.status).toBe("failed");
    expect(failedMessage(result)).toContain('Collection "nowhere" does not exist');
    expect(editor.context().objects).toEqual([]);
    expect(editor.execute("b", 0, [put("m", "ghost", null)]).status).toBe("failed");
  });

  it("keeps a replaced shape where it was, and forgets a deleted object", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [collection("set", "Set"), box("one", { collectionId: "set" })]);
    editor.execute("b", 1, [{ ...box("one"), commandId: "r", primitive: "sphere", replaceExisting: true }]);
    expect(where(editor)).toEqual({ one: "set" });
    editor.execute("c", 2, [{ commandId: "d", type: "scene.delete_object", objectId: "one" }]);
    expect(editor.execute("d", 3, [remove("x", "set")]).status).toBe("applied");
  });
});

describe("deleting a collection", () => {
  it("is refused while an object or a collection is in it, and says what is in it", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [collection("set", "Set"), collection("sub", "Sub", "set"), box("rock", { collectionId: "set" })]);
    const refused = editor.execute("b", 1, [remove("x", "set")]);
    expect(refused.status).toBe("failed");
    expect(failedMessage(refused)).toMatch(/not empty \(.*(collection sub|rock)/);
    expect(editor.context().collections).toHaveLength(2);
  });

  it("works once it is empty, including within the same batch that empties it", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [collection("set", "Set"), collection("sub", "Sub", "set"), box("rock", { collectionId: "set" })]);
    expect(editor.execute("b", 1, [put("m", "rock", null), remove("d1", "sub"), remove("d2", "set")]).status).toBe("applied");
    expect(editor.context().collections).toEqual([]);
    expect(where(editor)).toEqual({ rock: null });
  });

  it("rolls the whole batch back when a later command fails", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [collection("set", "Set"), box("rock", { collectionId: "set" })]);
    const result = editor.execute("b", 1, [put("m", "rock", null), remove("d1", "set"), remove("d2", "missing")]);
    expect(result.status).toBe("failed");
    expect(where(editor)).toEqual({ rock: "set" });
    expect(editor.context().collections).toHaveLength(1);
  });
});

describe("hiding a collection", () => {
  const scene = () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [collection("set", "Set"), collection("sub", "Sub", "set"), box("one", { collectionId: "set" }), box("two", { collectionId: "sub" }), box("loose")]);
    return editor;
  };
  const drawn = (editor: EditorScene) => Object.fromEntries(["one", "two", "loose"].map((id) => [id, editor.getObject(id)?.visible]));

  it("hides what is in it and in the collections inside it, and not what is elsewhere", () => {
    const editor = scene();
    expect(editor.execute("b", 1, [hide("h", "set", false)]).status).toBe("applied");
    expect(drawn(editor)).toEqual({ one: false, two: false, loose: true });
    expect(editor.execute("c", 2, [hide("s", "set", true)]).status).toBe("applied");
    expect(drawn(editor)).toEqual({ one: true, two: true, loose: true });
  });

  it("leaves each object's own flag alone, so showing the collection does not show what was hidden on purpose", () => {
    const editor = scene();
    editor.execute("b", 1, [{ commandId: "v", type: "scene.set_visibility", objectId: "two", visible: false }, hide("h", "set", false)]);
    expect(editor.context().objects.find((object) => object.id === "two")?.visible).toBe(false);
    expect(editor.context().objects.find((object) => object.id === "one")?.visible).toBe(true);
    editor.execute("c", 2, [hide("s", "set", true)]);
    expect(drawn(editor)).toEqual({ one: true, two: false, loose: true });
  });

  it("keeps an object hidden by its collection when it is shown or hidden by hand, until it leaves", () => {
    const editor = scene();
    editor.execute("b", 1, [hide("h", "set", false)]);
    editor.execute("c", 2, [{ commandId: "v", type: "scene.set_visibility", objectId: "one", visible: true }]);
    expect(editor.getObject("one")?.visible).toBe(false);
    editor.execute("d", 3, [put("m", "one", null)]);
    expect(editor.getObject("one")?.visible).toBe(true);
    editor.execute("e", 4, [put("n", "one", "set")]);
    expect(editor.getObject("one")?.visible).toBe(false);
  });

  it("applies to an object created into a hidden collection", () => {
    const editor = scene();
    editor.execute("b", 1, [hide("h", "set", false)]);
    editor.execute("c", 2, [box("late", { collectionId: "sub" })]);
    expect(editor.getObject("late")?.visible).toBe(false);
    expect(editor.context().objects.find((object) => object.id === "late")?.visible).toBe(true);
  });
});

describe("collections through a prepared edit, a preview and a replay", () => {
  const steps = [
    [collection("set", "Set"), collection("sub", "Sub", "set"), group("fig"), box("torso", { parentId: "fig" }), put("m", "fig", "sub"), hide("h", "set", false)],
    [{ commandId: "v", type: "scene.set_visibility", objectId: "torso", visible: false }, collection("late", "Set")],
  ];
  const summary = (editor: EditorScene) => ({ collections: editor.context().collections, where: where(editor), drawn: editor.outline().map((entry) => [entry.id, editor.getObject(entry.id)?.visible, entry.visible]) });

  it("replays to the same collections, membership and visibility", async () => {
    const live = new EditorScene(new Scene(), "p");
    steps.forEach((commands, index) => expect(live.execute(`s${index}`, index, commands).status).toBe("applied"));
    const replay = new EditorScene(new Scene(), "p");
    await replay.restore(steps.map((commands, index) => ({ kind: "commands" as const, proposalId: `s${index}`, commands })), () => Promise.reject(new Error("no imports")));
    expect(summary(replay)).toEqual(summary(live));
    expect(live.context().collections?.map((entry) => entry.name)).toEqual(["Set", "Sub", "Set.001"]);
  });

  it("carries collections into a prepared candidate and shows them only when it is committed", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("s0", 0, steps[0] ?? []);
    const prepared = editor.executePrepared("prep", editor.currentRevision, [collection("more", "More"), put("n", "fig", null)], "prepare");
    expect(prepared.status).toBe("applied");
    expect(editor.context().collections?.map((entry) => entry.id)).toEqual(["set", "sub"]);
    expect(where(editor)["fig"]).toBe("sub");
    editor.executePrepared("prep", editor.currentRevision, [collection("more", "More"), put("n", "fig", null)], "commit");
    expect(editor.context().collections?.map((entry) => entry.id)).toEqual(["set", "sub", "more"]);
    expect(where(editor)["fig"]).toBeNull();
  });

  it("is not changed by previewing a proposal on a copy", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("s0", 0, steps[0] ?? []);
    const before = summary(editor);
    const seen = editor.withProposalPreview("pv", editor.currentRevision, [collection("temp", "Temp"), put("n", "fig", "temp")], (_scene, candidate) => candidate.context().collections?.map((entry) => entry.id));
    expect(seen).toEqual(["set", "sub", "temp"]);
    expect(summary(editor)).toEqual(before);
  });

  it("counts only the scene's own changes in its version, so a list can tell when to rebuild", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [collection("set", "Set")]);
    const version = editor.version;
    editor.execute("b", 1, [hide("h", "set", false)]);
    expect(editor.version).toBeGreaterThan(version);
  });
});

describe("collection commands in the protocol", () => {
  it("accepts the six commands and the collection on creation commands", () => {
    for (const command of [
      collection("a", "A"), collection("b", "B", "a"),
      { commandId: "r", type: "scene.rename_collection", collectionId: "a", name: "X" },
      hide("h", "a", false),
      { commandId: "m", type: "scene.move_collection", collectionId: "b", parentCollectionId: null },
      remove("d", "a"), put("p", "obj", null), put("q", "obj", "a", false),
      group("g", { collectionId: "a" }), box("x", { collectionId: "a" }),
    ]) expect(editorCommandSchema.safeParse(command).success, JSON.stringify(command)).toBe(true);
  });

  it("includes children by default when moving into a collection", () => {
    const parsed = editorCommandSchema.parse(put("p", "obj", "a"));
    expect("includeChildren" in parsed && parsed.includeChildren).toBe(true);
  });

  it("refuses a collection on a replaced shape and unknown fields", () => {
    expect(editorCommandSchema.safeParse({ ...box("x"), replaceExisting: true, collectionId: "a" }).success).toBe(false);
    expect(editorCommandSchema.safeParse({ ...collection("a", "A"), objectId: "x" }).success).toBe(false);
    expect(editorCommandSchema.safeParse({ commandId: "m", type: "scene.move_to_collection", objectId: "x" }).success).toBe(false);
  });
});
