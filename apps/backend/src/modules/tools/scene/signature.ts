import { createHash } from "node:crypto";
import type { IndexedObject, SceneIndex, Vec3 } from "./scene-index.js";

/** Digits kept when sizes are compared: two sizes match when they agree to about this many significant digits. */
const SIGNIFICANT_DIGITS = 3;

/**
 * An object's name without the numbering that copies carry: "Window.003", "Window_12", "Window copy 2" and
 * "Window 4" are all "Window". Case is kept, for showing; compare with `nameStem`.
 */
export function baseName(name: string): string {
  const trimmed = name.trim();
  let base = trimmed;
  // "Window.001.002" carries two numberings; take them off until none is left.
  for (let previous = ""; previous !== base; ) {
    previous = base;
    base = base
      .replace(/[\s._-]*(copy|clone|duplicate)[\s._-]*\d*$/i, "")
      .replace(/[\s._-]*\d+$/, "")
      .trim();
  }
  return base === "" ? trimmed : base;
}

/** `baseName` without regard to case, which is how names are compared. */
export function nameStem(name: string): string {
  return baseName(name).toLowerCase();
}

function extentsKey(size: Vec3): string {
  // Sorted, so an object turned a quarter turn about an axis still matches its twin.
  return [...size]
    .sort((a, b) => a - b)
    .map((value) => Number(value.toPrecision(SIGNIFICANT_DIGITS)).toString())
    .join("x");
}

/**
 * Describes what an object is made of closely enough to tell copies from different things: its type, name stem and
 * extents, and, for a group, the signatures of what is inside it. Returns undefined for an object that cannot be
 * compared, such as a mesh the editor sent no bounds for.
 *
 * Geometry itself is not compared, because the editor's snapshot does not carry it, so two objects can share a
 * signature without being identical. Callers must say so.
 */
export class SignatureBook {
  private readonly cache = new Map<string, string | undefined>();

  constructor(private readonly index: SceneIndex) {}

  signatureOf(id: string): string | undefined {
    if (this.cache.has(id)) return this.cache.get(id);
    const entry = this.index.get(id);
    const value = entry ? this.compute(entry) : undefined;
    this.cache.set(id, value);
    return value;
  }

  private compute(entry: IndexedObject): string | undefined {
    const { object } = entry;
    const shape = entry.size ? extentsKey(entry.size) : "nobounds";
    if (entry.children.length === 0) {
      // A leaf with no geometry has nothing to compare, and would match every other such leaf.
      if (!entry.size) return undefined;
      return `${object.type}|${nameStem(object.name)}|${shape}`;
    }
    const inside: string[] = [];
    for (const child of entry.children) {
      const signature = this.signatureOf(child);
      // One child that cannot be compared makes the whole group impossible to compare.
      if (signature === undefined) return undefined;
      inside.push(signature);
    }
    inside.sort();
    // Hashed, so a signature stays short however much is inside the group.
    const contents = createHash("sha1").update(inside.join(",")).digest("hex").slice(0, 16);
    return `${object.type}|${nameStem(object.name)}|${shape}|${inside.length}:${contents}`;
  }
}
