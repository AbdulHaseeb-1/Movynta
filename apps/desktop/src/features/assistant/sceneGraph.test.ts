import { describe, expect, it } from "vitest";
import { isWithinBranch, MAX_OBJECT_NAME_LENGTH, resolveSiblingName, SiblingNames } from "@movynta/editor-protocol";

const names = (...values: string[]) => new Set(values);

/** A small deterministic shuffle, so a failing order can be reproduced. */
function shuffled<T>(values: readonly T[], seed: number): T[] {
  const copy = [...values];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

describe("isWithinBranch", () => {
  const parents = new Map<string, string | null>([["root", null], ["arm", "root"], ["hand", "arm"], ["other", null]]);
  const parentOf = (id: string) => parents.get(id);

  it("is true for the target itself and for anything below it", () => {
    expect(isWithinBranch("arm", "arm", parentOf)).toBe(true);
    expect(isWithinBranch("hand", "arm", parentOf)).toBe(true);
    expect(isWithinBranch("hand", "root", parentOf)).toBe(true);
  });

  it("is false for what is above or beside the target, and for nothing", () => {
    expect(isWithinBranch("root", "arm", parentOf)).toBe(false);
    expect(isWithinBranch("other", "arm", parentOf)).toBe(false);
    expect(isWithinBranch(null, "arm", parentOf)).toBe(false);
    expect(isWithinBranch(undefined, "arm", parentOf)).toBe(false);
  });

  it("ends when the data already contains a loop", () => {
    const loop = new Map<string, string | null>([["a", "b"], ["b", "a"]]);
    expect(isWithinBranch("a", "missing", (id) => loop.get(id))).toBe(false);
  });

  it("walks live objects the same way as ids", () => {
    interface Node { parent: Node | null }
    const top: Node = { parent: null };
    const middle: Node = { parent: top };
    const bottom: Node = { parent: middle };
    expect(isWithinBranch(bottom, top, (node) => node.parent)).toBe(true);
    expect(isWithinBranch(top, bottom, (node) => node.parent)).toBe(false);
  });
});

describe("resolveSiblingName", () => {
  it("keeps a free name", () => {
    expect(resolveSiblingName("Cube", names())).toEqual({ ok: true, name: "Cube" });
    expect(resolveSiblingName("  Cube  ", names())).toEqual({ ok: true, name: "Cube" });
  });

  it("adds the lowest free number to a taken name", () => {
    expect(resolveSiblingName("Cube", names("Cube"))).toEqual({ ok: true, name: "Cube.001" });
    expect(resolveSiblingName("Cube", names("Cube", "Cube.001"))).toEqual({ ok: true, name: "Cube.002" });
  });

  it("reuses a number freed by a deletion instead of renumbering", () => {
    expect(resolveSiblingName("Cube", names("Cube", "Cube.002"))).toEqual({ ok: true, name: "Cube.001" });
  });

  it("counts up from the stem of a name that already ends in a number", () => {
    expect(resolveSiblingName("Cube.001", names("Cube", "Cube.001"))).toEqual({ ok: true, name: "Cube.002" });
  });

  it("keeps side suffixes as part of the name", () => {
    expect(resolveSiblingName("Arm.L", names("Arm.L"))).toEqual({ ok: true, name: "Arm.L.001" });
  });

  it("gives the same answer whatever order the siblings were created in", () => {
    const taken = ["Cube", "Cube.001", "Cube.003", "Sphere", "Cube.010"];
    for (let seed = 1; seed <= 25; seed += 1) {
      const result = resolveSiblingName("Cube", new Set(shuffled(taken, seed)));
      expect(result).toEqual({ ok: true, name: "Cube.002" });
    }
  });

  it("gives every sibling in a run its own name", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const result = resolveSiblingName("Part", taken);
      if (!result.ok) throw new Error(result.message);
      expect(taken.has(result.name)).toBe(false);
      taken.add(result.name);
    }
    expect(taken.size).toBe(50);
  });

  it("refuses an empty name and one that is too long", () => {
    expect(resolveSiblingName("   ", names()).ok).toBe(false);
    expect(resolveSiblingName("x".repeat(MAX_OBJECT_NAME_LENGTH + 1), names()).ok).toBe(false);
  });

  it("refuses to number a name that would then be too long, rather than cutting it", () => {
    const full = "x".repeat(MAX_OBJECT_NAME_LENGTH);
    expect(resolveSiblingName(full, names()).ok).toBe(true);
    const result = resolveSiblingName(full, names(full));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("shorter");
  });
});

describe("SiblingNames", () => {
  it("gives the names that resolving one at a time would give, whatever is claimed", () => {
    const bases = ["Cube", "Cube", "Cube.001", "Arm.L", "Arm.L", "Cube.007", "Sphere", "Cube", "Cube.001", "Arm.L.001", "  Cube  "];
    for (let seed = 1; seed <= 40; seed += 1) {
      const initial = shuffled(["Cube", "Cube.002", "Sphere.001", "Arm.L"], seed).slice(0, 1 + (seed % 4));
      const sequence = Array.from({ length: 60 }, (_, i) => bases[(i * 7 + seed * 3) % bases.length] ?? "Cube");
      const plain = new Set(initial);
      const index = new SiblingNames(initial);
      for (const base of sequence) {
        const expected = resolveSiblingName(base, plain);
        const actual = index.claim(base);
        expect(actual).toEqual(expected);
        if (expected.ok) plain.add(expected.name);
      }
    }
  });

  it("claims hundreds of identical names without searching from the start each time", () => {
    const index = new SiblingNames([]);
    const claimed = Array.from({ length: 2000 }, () => {
      const result = index.claim("box");
      if (!result.ok) throw new Error(result.message);
      return result.name;
    });
    expect(claimed[0]).toBe("box");
    expect(claimed[1]).toBe("box.001");
    expect(claimed[1999]).toBe("box.1999");
    expect(new Set(claimed).size).toBe(2000);
  });

  it("reports a name that is too long without recording it", () => {
    const full = "x".repeat(MAX_OBJECT_NAME_LENGTH);
    const index = new SiblingNames([full]);
    expect(index.claim(full).ok).toBe(false);
    expect(index.claim("y").ok).toBe(true);
  });
});
