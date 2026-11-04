import { describe, expect, it } from "vitest";
import { meshPathSchema, resolveMeshPath, stableMeshPath, stableSteps, stepInto, type PathNode } from "@movynta/editor-protocol";

const part = (name: string, ...children: PathNode[]): PathNode => ({ name, children });
const names = (node: PathNode | undefined) => node?.name;

describe("following a mesh path", () => {
  const model = part("model", part("Head"), part("Body", part("Arm"), part("Arm"), part("")), part("Arm"));

  it("follows indexes as it always did", () => {
    expect(names(resolveMeshPath(model, [1, 1]))).toBe("Arm");
    expect(resolveMeshPath(model, [1, 1])).toBe(model.children[1]?.children[1]);
    expect(resolveMeshPath(model, [])).toBe(model);
  });

  it("follows a name to the child with that name, wherever it is among its siblings", () => {
    expect(resolveMeshPath(model, ["Body", "Arm"])).toBe(model.children[1]?.children[0]);
    expect(resolveMeshPath(model, ["Head"])).toBe(model.children[0]);
  });

  it("follows #n to the n-th child with that name, counting from 0", () => {
    expect(resolveMeshPath(model, ["Body", "Arm#0"])).toBe(model.children[1]?.children[0]);
    expect(resolveMeshPath(model, ["Body", "Arm#1"])).toBe(model.children[1]?.children[1]);
    expect(resolveMeshPath(model, ["Body", "Arm#2"])).toBeUndefined();
  });

  it("mixes the two forms, step by step", () => {
    expect(resolveMeshPath(model, ["Body", 1])).toBe(model.children[1]?.children[1]);
    expect(resolveMeshPath(model, [1, "Arm#1"])).toBe(model.children[1]?.children[1]);
  });

  it("leads nowhere for a part that is not there, and does not guess", () => {
    expect(resolveMeshPath(model, ["Leg"])).toBeUndefined();
    expect(resolveMeshPath(model, [9])).toBeUndefined();
    expect(resolveMeshPath(model, ["Head", "Arm"])).toBeUndefined();
    expect(resolveMeshPath(undefined, ["Head"])).toBeUndefined();
    expect(stepInto(model, "#1")).toBeUndefined();
  });

  it("matches the whole name when it only looks like a count", () => {
    const odd = part("root", part("Part#1x"), part("Part#1"));
    expect(resolveMeshPath(odd, ["Part#1x"])).toBe(odd.children[0]);
    // "Part#1" is read as the second child named "Part", of which there is none.
    expect(resolveMeshPath(odd, ["Part#1"])).toBeUndefined();
  });
});

describe("the steps that keep meaning the same part", () => {
  it("is the name where it is alone among its siblings, and #n for later ones with the same name", () => {
    const model = part("m", part("Head"), part("Arm"), part("Arm"), part("Arm"));
    expect(stableSteps(model)).toEqual(["Head", "Arm", "Arm#1", "Arm#2"]);
  });

  it("is the index for a part with no name", () => {
    expect(stableSteps(part("m", part(""), part("Head"), part("")))).toEqual([0, "Head", 2]);
  });

  it("writes #0 for a name that ends like a count, so it is not read as one", () => {
    const model = part("m", part("Arm#1"), part("Arm#1"));
    expect(stableSteps(model)).toEqual(["Arm#1#0", "Arm#1#1"]);
    expect(resolveMeshPath(model, ["Arm#1#0"])).toBe(model.children[0]);
    expect(resolveMeshPath(model, ["Arm#1#1"])).toBe(model.children[1]);
  });

  it("leads back to each part, for every part, whatever the names", () => {
    const model = part("m", part("A", part("A"), part("B"), part("A")), part(""), part("A"), part("C#2"), part("C#2"));
    const walk = (node: PathNode, path: readonly (string | number)[]) => {
      const steps = stableSteps(node);
      node.children.forEach((child, index) => {
        const next = [...path, steps[index] ?? index];
        expect(resolveMeshPath(model, next)).toBe(child);
        walk(child, next);
      });
    };
    walk(model, []);
  });

  it("is not changed by parts that are added elsewhere, or by a part moving to another position", () => {
    const before = part("m", part("Head"), part("Body"), part("Arm"));
    const arm = resolveMeshPath(before, ["Arm"]);
    const after = part("m", part("Hat"), part("Arm"), part("Head"), part("Body"));
    expect(names(resolveMeshPath(after, ["Arm"]))).toBe(names(arm));
    // The index it had now leads to something else, which is what names are for.
    expect(names(resolveMeshPath(after, [2]))).toBe("Head");
  });

  it("costs the number of children, not their square", () => {
    const wide = part("m", ...Array.from({ length: 20_000 }, () => part("Same")));
    const start = performance.now();
    const steps = stableSteps(wide);
    expect(steps[19_999]).toBe("Same#19999");
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("turning a path into its stable form", () => {
  const model = part("model", part("Head"), part("Body", part("Arm"), part("Arm")));

  it("turns indexes into names, and leaves names as they are", () => {
    expect(stableMeshPath(model, [1, 1])).toEqual(["Body", "Arm#1"]);
    expect(stableMeshPath(model, ["Body", "Arm#1"])).toEqual(["Body", "Arm#1"]);
    expect(stableMeshPath(model, [])).toEqual([]);
  });

  it("gives the same part before and after", () => {
    for (const path of [[0], [1], [1, 0], [1, 1], ["Body", 1]] as const) {
      expect(resolveMeshPath(model, stableMeshPath(model, path))).toBe(resolveMeshPath(model, path));
    }
  });

  it("leaves a step that leads nowhere as it was, rather than pointing it at something else", () => {
    expect(stableMeshPath(model, [1, 7, 3])).toEqual(["Body", 7, 3]);
    expect(stableMeshPath(model, ["Leg", 0])).toEqual(["Leg", 0]);
  });
});

describe("the path schema", () => {
  it("accepts indexes, names and a mixture, and refuses what is neither", () => {
    expect(meshPathSchema.safeParse([0, 2]).success).toBe(true);
    expect(meshPathSchema.safeParse(["Body", "Arm#1"]).success).toBe(true);
    expect(meshPathSchema.safeParse(["Body", 3]).success).toBe(true);
    for (const bad of [[""], [-1], [1.5], [null], [{}], ["x".repeat(131)], Array.from({ length: 33 }, () => 0)]) {
      expect(meshPathSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 40)).toBe(false);
    }
  });
});
