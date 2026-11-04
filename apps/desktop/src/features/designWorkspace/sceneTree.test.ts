import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { editorCommandSchema } from "@movynta/editor-protocol";
import { EditorScene, type OutlineEntry } from "@/features/assistant/EditorScene";
import { buildSceneTree, canMoveUnder, flattenTree, outlineCommands, revealed, scrollToRow, visibleRange } from "./sceneTree";

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
  it("are valid editor commands, the same ones the assistant proposes", () => {
    for (const command of [outlineCommands.rename("a", "Arm"), outlineCommands.move("a", "b"), outlineCommands.move("a", null), outlineCommands.show("a", false)]) {
      expect(editorCommandSchema.safeParse(command).success).toBe(true);
    }
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
