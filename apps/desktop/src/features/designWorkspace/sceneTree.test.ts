import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { editorCommandSchema, HAND_EDIT_COMMAND_TYPES } from "@movynta/editor-protocol";
import { EditorScene, type CollectionEntry, type OutlineEntry } from "@/features/assistant/EditorScene";
import { buildSceneTree, canMoveUnder, collectionRowId, dropAction, dropCommands, flattenTree, outlineCommands, revealed, ROOT_ROW_ID, rowTarget, scrollToRow, visibleRange } from "./sceneTree";

const entry = (id: string, parentId: string | null = null, extra: Partial<OutlineEntry> = {}): OutlineEntry => ({
  id, name: id.toUpperCase(), kind: "empty", parentId, visible: true, collectionId: null, ...extra,
});
const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

describe("buildSceneTree and flattenTree", () => {
  const tree = buildSceneTree([entry("fig"), entry("torso", "fig"), entry("head", "fig"), entry("hat", "head"), entry("rock")]);

  it("lists parents before their children, children in the order they were created", () => {
    const rows = flattenTree(tree, new Set());
    expect(ids(rows)).toEqual(["fig", "torso", "head", "hat", "rock"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 1, 2, 0]);
    expect(rows.map((row) => row.hasChildren)).toEqual([true, false, true, false, false]);
  });

  it("skips what is under a collapsed object and says which lines are collapsed", () => {
    const rows = flattenTree(tree, new Set(["head"]));
    expect(ids(rows)).toEqual(["fig", "torso", "head", "rock"]);
    expect(rows.find((row) => row.id === "head")?.collapsed).toBe(true);
    expect(flattenTree(tree, new Set(["fig"])).map((row) => row.id)).toEqual(["fig", "rock"]);
  });

  it("ignores collapsing an object that has no children", () => {
    expect(flattenTree(tree, new Set(["rock"])).find((row) => row.id === "rock")?.collapsed).toBe(false);
  });

  it("marks everything under a hidden object as not drawn, and leaves its own flag alone", () => {
    const hidden = buildSceneTree([entry("fig", null, { visible: false }), entry("torso", "fig"), entry("rock")]);
    const rows = flattenTree(hidden, new Set());
    expect(rows.map((row) => [row.id, row.visible, row.effectiveVisible])).toEqual([
      ["fig", false, false], ["torso", true, false], ["rock", true, true],
    ]);
  });

  it("puts an object whose parent is missing at the top level", () => {
    const orphan = buildSceneTree([entry("a", "gone"), entry("b", "b")]);
    expect(ids(flattenTree(orphan, new Set()))).toEqual(["a", "b"]);
  });

  it("does not lose objects that data with a loop would hide", () => {
    const loop = buildSceneTree([entry("a", "b"), entry("b", "a"), entry("c")]);
    expect(new Set(ids(flattenTree(loop, new Set())))).toEqual(new Set(["a", "b", "c"]));
  });

  it("walks a chain of thousands without running out of stack", () => {
    const chain = Array.from({ length: 5000 }, (_, i) => entry(`n${i}`, i === 0 ? null : `n${i - 1}`));
    const rows = flattenTree(buildSceneTree(chain), new Set());
    expect(rows).toHaveLength(5000);
    expect(rows[4999]?.depth).toBe(4999);
  });
});

describe("canMoveUnder", () => {
  const tree = buildSceneTree([entry("fig"), entry("arm", "fig"), entry("hand", "arm"), entry("rock")]);

  it("allows a move to another parent and to the top level", () => {
    expect(canMoveUnder(tree, "rock", "fig")).toBe(true);
    expect(canMoveUnder(tree, "hand", null)).toBe(true);
    expect(canMoveUnder(tree, "hand", "fig")).toBe(true);
  });

  it("refuses a move that changes nothing", () => {
    expect(canMoveUnder(tree, "rock", null)).toBe(false);
    expect(canMoveUnder(tree, "arm", "fig")).toBe(false);
  });

  it("refuses a move under itself or under what hangs below it", () => {
    expect(canMoveUnder(tree, "arm", "arm")).toBe(false);
    expect(canMoveUnder(tree, "fig", "hand")).toBe(false);
    expect(canMoveUnder(tree, "arm", "hand")).toBe(false);
  });

  it("refuses objects that do not exist", () => {
    expect(canMoveUnder(tree, "ghost", null)).toBe(false);
    expect(canMoveUnder(tree, "rock", "ghost")).toBe(false);
  });
});

describe("revealed", () => {
  const tree = buildSceneTree([entry("fig"), entry("arm", "fig"), entry("hand", "arm")]);

  it("opens every collapsed object above the one to show, and no others", () => {
    expect(revealed(tree, new Set(["fig", "arm", "other"]), "hand")).toEqual(new Set(["other"]));
  });

  it("returns the same set when nothing above is collapsed", () => {
    const collapsed = new Set(["hand"]);
    expect(revealed(tree, collapsed, "hand")).toBe(collapsed);
  });
});

describe("windowing", () => {
  it("draws the lines in view and a margin around them, never past the ends", () => {
    expect(visibleRange(0, 280, 28, 1000, 6)).toEqual({ start: 0, end: 16 });
    expect(visibleRange(2800, 280, 28, 1000, 6)).toEqual({ start: 94, end: 116 });
    expect(visibleRange(27700, 280, 28, 1000, 6)).toEqual({ start: 983, end: 1000 });
    expect(visibleRange(0, 280, 28, 3, 6)).toEqual({ start: 0, end: 3 });
  });

  it("scrolls only as far as needed to bring a line into view", () => {
    expect(scrollToRow(100, 280, 28, 5)).toBe(100);
    expect(scrollToRow(300, 280, 28, 2)).toBe(56);
    expect(scrollToRow(0, 280, 28, 20)).toBe(20 * 28 + 28 - 280);
    expect(scrollToRow(0, 280, 28, 3)).toBe(0);
  });
});

describe("the commands a change in the list saves", () => {
  const all = [
    outlineCommands.rename("a", "Arm"), outlineCommands.move("a", "b"), outlineCommands.move("a", null), outlineCommands.show("a", false),
    outlineCommands.makeCollection("k", "Set", null), outlineCommands.makeCollection("k2", "Props", "k"), outlineCommands.renameCollection("k", "Scene set"),
    outlineCommands.showCollection("k", false), outlineCommands.nestCollection("k2", null), outlineCommands.nestCollection("k2", "k"),
    outlineCommands.deleteCollection("k"), outlineCommands.collect("a", "k"), outlineCommands.collect("a", null),
  ];

  it("are valid editor commands, the same ones the assistant proposes", () => {
    for (const command of all) expect(editorCommandSchema.safeParse(command).success, JSON.stringify(command)).toBe(true);
  });

  it("are all commands the backend accepts as a person's own edit, so none is refused when saved", () => {
    for (const command of all) expect(HAND_EDIT_COMMAND_TYPES.has(command.type), command.type).toBe(true);
  });
});

const col = (id: string, parentId: string | null = null, visible = true): CollectionEntry => ({ id, name: id.toUpperCase(), parentId, visible });
const inCollection = (id: string, collectionId: string | null, parentId: string | null = null, extra: Partial<OutlineEntry> = {}) => entry(id, parentId, { collectionId, ...extra });

describe("collections in the list", () => {
  const objects = [
    inCollection("fig", "set"), inCollection("torso", "set", "fig"), inCollection("rock", "props"),
    inCollection("cup", "props", "fig"), inCollection("loose", null),
  ];
  const tree = buildSceneTree(objects, [col("set"), col("props", "set")]);

  it("lists the scene first, then each collection with its collections and then its objects", () => {
    const rows = flattenTree(tree, new Set());
    expect(rows.map((row) => [row.id, row.depth, row.kind])).toEqual([
      [ROOT_ROW_ID, 0, "root"],
      ["collection:set", 1, "collection"],
      ["collection:props", 2, "collection"],
      ["rock", 3, "empty"],
      ["cup", 3, "empty"],
      ["fig", 2, "empty"],
      ["torso", 3, "empty"],
      ["loose", 1, "empty"],
    ]);
  });

  it("puts an object under its parent only when they are in the same collection, so each appears once", () => {
    // The cup's parent is in another collection, so it is listed with the props, not under the figure.
    expect(tree.displayParent.get("cup")).toBe("collection:props");
    expect(tree.displayParent.get("torso")).toBe("fig");
    expect(flattenTree(tree, new Set()).filter((row) => row.id === "cup")).toHaveLength(1);
    // Its parent in space is still the figure.
    expect(tree.parents.get("cup")).toBe("fig");
  });

  it("has no line for the scene when there are no collections, so the list is what it was", () => {
    const plain = buildSceneTree([entry("a"), entry("b", "a")]);
    expect(flattenTree(plain, new Set()).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("hides what a hidden collection holds, and the collections inside it, without touching their own flags", () => {
    const hidden = buildSceneTree(objects, [col("set", null, false), col("props", "set")]);
    const rows = new Map(flattenTree(hidden, new Set()).map((row) => [row.id, row]));
    expect(rows.get("collection:set")).toMatchObject({ visible: false, effectiveVisible: false });
    expect(rows.get("collection:props")).toMatchObject({ visible: true, effectiveVisible: false });
    expect(rows.get("rock")).toMatchObject({ visible: true, effectiveVisible: false });
    expect(rows.get("fig")).toMatchObject({ visible: true, effectiveVisible: false });
    expect(rows.get("loose")).toMatchObject({ visible: true, effectiveVisible: true });
  });

  it("accounts for spatial parents and their collections across collection boundaries", () => {
    const crossCollectionObjects = [
      inCollection("parent", "hidden"),
      inCollection("child", "visible", "parent"),
      inCollection("grandchild", null, "child"),
      inCollection("other", "visible"),
    ];
    const rows = new Map(flattenTree(buildSceneTree(crossCollectionObjects, [col("hidden", null, false), col("visible")]), new Set()).map((row) => [row.id, row]));
    expect(rows.get("child")).toMatchObject({ visible: true, effectiveVisible: false });
    expect(rows.get("grandchild")).toMatchObject({ visible: true, effectiveVisible: false });
    expect(rows.get("other")?.effectiveVisible).toBe(true);
    const hiddenParent = buildSceneTree([entry("p", null, { visible: false }), inCollection("c", "visible", "p")], [col("visible")]);
    expect(flattenTree(hiddenParent, new Set()).find((row) => row.id === "c")?.effectiveVisible).toBe(false);
  });

  it("skips what is under a collapsed collection or under the scene line", () => {
    expect(flattenTree(tree, new Set(["collection:props"])).map((row) => row.id)).toEqual([ROOT_ROW_ID, "collection:set", "collection:props", "fig", "torso", "loose"]);
    expect(flattenTree(tree, new Set([ROOT_ROW_ID])).map((row) => row.id)).toEqual([ROOT_ROW_ID]);
  });

  it("lists an object whose collection is missing, and a collection whose parent is missing, in the scene", () => {
    const broken = buildSceneTree([inCollection("a", "nowhere")], [col("c", "gone")]);
    expect(broken.displayParent.get("a")).toBe(ROOT_ROW_ID);
    expect(broken.displayParent.get("collection:c")).toBe(ROOT_ROW_ID);
  });

  it("does not lose collections that data with a loop would hide", () => {
    const loop = buildSceneTree([], [col("a", "b"), col("b", "a"), col("c")]);
    expect(new Set(flattenTree(loop, new Set()).map((row) => row.id))).toEqual(new Set([ROOT_ROW_ID, "collection:a", "collection:b", "collection:c"]));
  });

  it("opens the collections above an object so its line is there", () => {
    expect(revealed(tree, new Set(["collection:set", "collection:props", ROOT_ROW_ID]), "rock")).toEqual(new Set());
    expect(revealed(tree, new Set(["fig"]), "torso")).toEqual(new Set());
  });

  it("tells a line for a collection from one for an object even when they share an id", () => {
    expect(rowTarget("collection")).toEqual({ kind: "object", id: "collection" });
    expect(rowTarget(collectionRowId("collection"))).toEqual({ kind: "collection", id: "collection" });
    expect(rowTarget(ROOT_ROW_ID)).toEqual({ kind: "root" });
    const same = buildSceneTree([inCollection("set", "set")], [col("set")]);
    expect(flattenTree(same, new Set()).map((row) => row.id)).toEqual([ROOT_ROW_ID, "collection:set", "set"]);
  });
});

describe("what dropping a line does", () => {
  const tree = buildSceneTree(
    [inCollection("fig", "set"), inCollection("torso", "set", "fig"), inCollection("rock", null)],
    [col("set"), col("props", "set"), col("other")],
  );

  it("makes an object the child of another object, with the rules of re-parenting", () => {
    expect(dropAction(tree, "rock", "fig")).toEqual({ kind: "parent", objectId: "rock", parentId: "fig" });
    expect(dropAction(tree, "fig", "torso")).toBeUndefined();
    expect(dropAction(tree, "fig", "fig")).toBeUndefined();
  });

  it("puts an object in a collection, or in the scene, unless it is already there", () => {
    expect(dropAction(tree, "rock", collectionRowId("set"))).toEqual({ kind: "collect", objectId: "rock", collectionId: "set" });
    expect(dropAction(tree, "fig", ROOT_ROW_ID)).toEqual({ kind: "collect", objectId: "fig", collectionId: null });
    expect(dropAction(tree, "fig", collectionRowId("set"))).toBeUndefined();
    expect(dropAction(tree, "rock", ROOT_ROW_ID)).toBeUndefined();
    expect(dropAction(tree, "rock", collectionRowId("ghost"))).toBeUndefined();
  });

  it("takes an object out of its parent on the strip, and only an object", () => {
    expect(dropAction(tree, "torso", null)).toEqual({ kind: "parent", objectId: "torso", parentId: null });
    expect(dropAction(tree, "rock", null)).toBeUndefined();
    expect(dropAction(tree, collectionRowId("props"), null)).toBeUndefined();
  });

  it("nests a collection in another or at the top, but not in itself, in what it holds, or in an object", () => {
    expect(dropAction(tree, collectionRowId("other"), collectionRowId("set"))).toEqual({ kind: "nest", collectionId: "other", parentCollectionId: "set" });
    expect(dropAction(tree, collectionRowId("props"), ROOT_ROW_ID)).toEqual({ kind: "nest", collectionId: "props", parentCollectionId: null });
    expect(dropAction(tree, collectionRowId("set"), collectionRowId("props"))).toBeUndefined();
    expect(dropAction(tree, collectionRowId("set"), collectionRowId("set"))).toBeUndefined();
    expect(dropAction(tree, collectionRowId("other"), "fig")).toBeUndefined();
    expect(dropAction(tree, collectionRowId("other"), ROOT_ROW_ID)).toBeUndefined();
    expect(dropAction(tree, collectionRowId("props"), collectionRowId("set"))).toBeUndefined();
  });

  it("cannot drag the scene itself, and each action has a command", () => {
    expect(dropAction(tree, ROOT_ROW_ID, collectionRowId("set"))).toBeUndefined();
    const action = dropAction(tree, "rock", collectionRowId("set"));
    expect(action && dropCommands(action).map((command) => command.type)).toEqual(["scene.move_to_collection"]);
  });
});

describe("the editor's outline", () => {
  const create = (commandId: string, objectId: string, parentId?: string) => ({
    commandId, type: "scene.create_object", objectId, name: objectId, ...(parentId ? { parentId } : {}),
  });

  it("lists names, parents and visibility without the work the assistant's context does", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [create("g", "fig"), { commandId: "b", type: "geometry.create_primitive", objectId: "torso", primitive: "box", size: 1, replaceExisting: false, parentId: "fig" }]);
    editor.execute("b", 1, [{ commandId: "v", type: "scene.set_visibility", objectId: "fig", visible: false }]);
    expect(editor.outline()).toEqual([
      { id: "fig", name: "fig", kind: "empty", parentId: null, visible: false, collectionId: null },
      { id: "torso", name: "box", kind: "mesh", parentId: "fig", visible: true, collectionId: null },
    ]);
  });

  it("changes its version for a change of the scene and not for a selection", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [create("g", "fig")]);
    const built = editor.version;
    editor.select("fig");
    editor.select(null);
    expect(editor.version).toBe(built);
    editor.execute("b", 1, [{ commandId: "r", type: "scene.rename_object", objectId: "fig", name: "Figure" }]);
    expect(editor.version).toBeGreaterThan(built);
  });

  it("changes its version after a reset even when the revision comes back to the same number", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [create("g", "fig")]);
    const revision = editor.currentRevision;
    const before = editor.version;
    editor.reset();
    editor.execute("b", 0, [create("g", "other")]);
    expect(editor.currentRevision).toBe(revision);
    expect(editor.version).not.toBe(before);
  });
});

describe("the editor feeds the list with its collections", () => {
  it("lists objects under the collections they are in, as the editor reports them", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("a", 0, [
      { commandId: "k", type: "scene.create_collection", collectionId: "set", name: "Set" },
      { commandId: "g", type: "scene.create_object", objectId: "fig", name: "Fig", collectionId: "set" },
      { commandId: "b", type: "geometry.create_primitive", objectId: "torso", primitive: "box", size: 1, replaceExisting: false, parentId: "fig" },
      { commandId: "c", type: "geometry.create_primitive", objectId: "rock", primitive: "box", size: 1, replaceExisting: false },
    ]);
    const rows = flattenTree(buildSceneTree(editor.outline(), editor.collections()), new Set());
    expect(rows.map((row) => `${"  ".repeat(row.depth)}${row.name}`)).toEqual(["Scene collection", "  Set", "    Fig", "      box", "  box"]);
  });
});
