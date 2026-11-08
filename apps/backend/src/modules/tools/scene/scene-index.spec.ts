import { sceneObject, sceneOf } from "../../../testing/scene-fixtures.js";
import { SceneIndex } from "./scene-index.js";

const objects = [
  sceneObject({ id: "figure", type: "empty", size: null }),
  sceneObject({ id: "torso", parentId: "figure", at: [0, 1, 0], size: [1, 1.5, 0.6] }),
  sceneObject({ id: "head", parentId: "torso", at: [0, 2, 0], size: [0.4, 0.4, 0.4] }),
  sceneObject({ id: "crate", at: [3, 0.5, 0] }),
];

describe("SceneIndex", () => {
  const index = new SceneIndex(sceneOf(objects));

  it("lists the top level in scene order", () => {
    expect(index.roots).toEqual(["figure", "crate"]);
    expect(index.total).toBe(4);
    expect(index.unreachable).toBe(0);
  });

  it("counts what is below each object, at any depth, by type", () => {
    expect(index.get("figure")).toMatchObject({ children: ["torso"], descendantCount: 2, descendantKinds: { mesh: 2 } });
    expect(index.get("torso")).toMatchObject({ descendantCount: 1 });
    expect(index.get("head")).toMatchObject({ children: [], descendantCount: 0, descendantKinds: {} });
  });

  it("works out world size and center, and leaves both null for an object with no geometry", () => {
    expect(index.get("torso")?.size).toEqual([1, 1.5, 0.6]);
    expect(index.get("torso")?.center).toEqual([0, 1, 0]);
    expect(index.get("figure")?.size).toBeNull();
    expect(index.get("figure")?.center).toBeNull();
  });

  it("gives the path from the top and says whether an object is inside another", () => {
    expect(index.path("head").map((step) => step.id)).toEqual(["figure", "torso", "head"]);
    expect(index.isWithin("head", "figure")).toBe(true);
    expect(index.isWithin("figure", "figure")).toBe(true);
    expect(index.isWithin("crate", "figure")).toBe(false);
  });

  it("walks a branch parents first, without the branch's own root", () => {
    expect([...index.walk("figure")].map((entry) => entry.object.id)).toEqual(["torso", "head"]);
    expect([...index.walk()].map((entry) => entry.object.id)).toEqual(["figure", "torso", "head", "crate"]);
  });

  it("treats an object whose parent is missing as top level", () => {
    const damaged = new SceneIndex(sceneOf([sceneObject({ id: "orphan", parentId: "gone" })]));
    expect(damaged.roots).toEqual(["orphan"]);
    expect(damaged.parentOf("orphan")).toBeNull();
  });

  it("leaves out objects in a parent cycle and counts them, instead of looping", () => {
    const cyclic = new SceneIndex(
      sceneOf([sceneObject({ id: "a", parentId: "b" }), sceneObject({ id: "b", parentId: "a" }), sceneObject({ id: "ok" })]),
    );
    expect(cyclic.roots).toEqual(["ok"]);
    expect(cyclic.unreachable).toBe(2);
    expect(cyclic.has("a")).toBe(false);
    expect(cyclic.isWithin("a", "b")).toBe(false);
  });

  it("treats an object that is its own parent as top level", () => {
    const own = new SceneIndex(sceneOf([sceneObject({ id: "self", parentId: "self" })]));
    expect(own.roots).toEqual(["self"]);
  });

  it("handles a very deep chain without overflowing the stack", () => {
    const chain = Array.from({ length: 2000 }, (_, at) => sceneObject({ id: `n${at}`, parentId: at === 0 ? null : `n${at - 1}` }));
    const deep = new SceneIndex(sceneOf(chain));
    expect(deep.get("n0")?.descendantCount).toBe(1999);
    expect(deep.path("n1999")).toHaveLength(64);
  });
});
