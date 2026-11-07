import { sceneObject, sceneOf } from "../../../testing/scene-fixtures.js";
import { SceneIndex } from "./scene-index.js";
import { SignatureBook, baseName, nameStem } from "./signature.js";

describe("names of copies", () => {
  it.each([
    ["Window.003", "Window"],
    ["Window_12", "Window"],
    ["Window 4", "Window"],
    ["Window copy", "Window"],
    ["Window copy 2", "Window"],
    ["Window-Clone_7", "Window"],
    ["Window.001.002", "Window"],
    ["Window", "Window"],
    ["Arm_L", "Arm_L"],
    ["2", "2"],
    ["  Door  ", "Door"],
  ])("%s is %s", (name, expected) => {
    expect(baseName(name)).toBe(expected);
  });

  it("compares without regard to case", () => {
    expect(nameStem("WINDOW.002")).toBe(nameStem("window_9"));
  });
});

describe("SignatureBook", () => {
  const book = (objects: ReturnType<typeof sceneObject>[]) => {
    const index = new SceneIndex(sceneOf(objects));
    return new SignatureBook(index);
  };

  it("matches objects of one type, name stem and size", () => {
    const signatures = book([
      sceneObject({ id: "a", name: "Brick.001", size: [1, 0.5, 0.5] }),
      sceneObject({ id: "b", name: "Brick.002", size: [1, 0.5, 0.5], at: [4, 0, 0] }),
    ]);
    expect(signatures.signatureOf("a")).toBe(signatures.signatureOf("b"));
  });

  it("separates objects that differ in size, name or type", () => {
    const signatures = book([
      sceneObject({ id: "a", name: "Brick", size: [1, 0.5, 0.5] }),
      sceneObject({ id: "b", name: "Brick", size: [1, 0.5, 0.6] }),
      sceneObject({ id: "c", name: "Block", size: [1, 0.5, 0.5] }),
      sceneObject({ id: "d", name: "Brick", type: "light", size: [1, 0.5, 0.5] }),
    ]);
    const all = ["a", "b", "c", "d"].map((id) => signatures.signatureOf(id));
    expect(new Set(all).size).toBe(4);
  });

  it("ignores differences below about three significant digits, and sees larger ones", () => {
    const signatures = book([
      sceneObject({ id: "a", name: "Pane", size: [1, 1.4, 0.2] }),
      sceneObject({ id: "b", name: "Pane", size: [1.0001, 1.40004, 0.2] }),
      sceneObject({ id: "c", name: "Pane", size: [1.02, 1.4, 0.2] }),
    ]);
    expect(signatures.signatureOf("a")).toBe(signatures.signatureOf("b"));
    expect(signatures.signatureOf("a")).not.toBe(signatures.signatureOf("c"));
  });

  it("matches an object turned a quarter turn", () => {
    const signatures = book([
      sceneObject({ id: "a", name: "Post", size: [0.2, 3, 0.4] }),
      sceneObject({ id: "b", name: "Post", size: [0.4, 3, 0.2] }),
    ]);
    expect(signatures.signatureOf("a")).toBe(signatures.signatureOf("b"));
  });

  it("includes what a group holds, so groups with different contents differ", () => {
    const signatures = book([
      sceneObject({ id: "g1", name: "Unit", type: "empty", size: null }),
      sceneObject({ id: "g1a", name: "Frame", parentId: "g1" }),
      sceneObject({ id: "g2", name: "Unit", type: "empty", size: null }),
      sceneObject({ id: "g2a", name: "Frame", parentId: "g2" }),
      sceneObject({ id: "g3", name: "Unit", type: "empty", size: null }),
      sceneObject({ id: "g3a", name: "Frame", parentId: "g3" }),
      sceneObject({ id: "g3b", name: "Pane", parentId: "g3" }),
    ]);
    expect(signatures.signatureOf("g1")).toBe(signatures.signatureOf("g2"));
    expect(signatures.signatureOf("g1")).not.toBe(signatures.signatureOf("g3"));
  });

  it("does not depend on the order of a group's children", () => {
    const signatures = book([
      sceneObject({ id: "g1", name: "Unit", type: "empty", size: null }),
      sceneObject({ id: "g1a", name: "Frame", parentId: "g1" }),
      sceneObject({ id: "g1b", name: "Pane", parentId: "g1", size: [2, 2, 2] }),
      sceneObject({ id: "g2", name: "Unit", type: "empty", size: null }),
      sceneObject({ id: "g2b", name: "Pane", parentId: "g2", size: [2, 2, 2] }),
      sceneObject({ id: "g2a", name: "Frame", parentId: "g2" }),
    ]);
    expect(signatures.signatureOf("g1")).toBe(signatures.signatureOf("g2"));
  });

  it("cannot compare an object with no geometry, or a group holding one", () => {
    const signatures = book([
      sceneObject({ id: "bare", name: "Bare", size: null }),
      sceneObject({ id: "g", name: "G", type: "empty", size: null }),
      sceneObject({ id: "g1", name: "Bare", parentId: "g", size: null }),
    ]);
    expect(signatures.signatureOf("bare")).toBeUndefined();
    expect(signatures.signatureOf("g")).toBeUndefined();
  });

  it("returns undefined for an unknown id", () => {
    expect(book([]).signatureOf("nope")).toBeUndefined();
  });
});
