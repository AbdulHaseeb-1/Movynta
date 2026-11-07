import type { EditorContext, EditorObject } from "@movynta/editor-protocol";

export type Vec3 = readonly [number, number, number];

/** One object of the scene with what a summary needs, worked out once so no tool walks the hierarchy twice. */
export interface IndexedObject {
  readonly object: EditorObject;
  /** Ids of the direct children, in the order the editor lists them. */
  readonly children: readonly string[];
  /** Everything below this object, at any depth. */
  readonly descendantCount: number;
  /** Descendants by type, only for types that occur. */
  readonly descendantKinds: Readonly<Record<string, number>>;
  /** World-space extents of the bounds including descendants, or null when there is no geometry. */
  readonly size: Vec3 | null;
  /** World-space center of those bounds, or null. */
  readonly center: Vec3 | null;
}

/** Rounds to three decimals, so results stay short and a value does not carry floating-point noise. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function roundVec(vector: Vec3): [number, number, number] {
  return [round3(vector[0]), round3(vector[1]), round3(vector[2])];
}

function boundsOf(object: EditorObject): { size: Vec3; center: Vec3 } | null {
  const bounds = object.worldBounds;
  if (!bounds) return null;
  const { min, max } = bounds;
  return {
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}

/**
 * The scene as a tree that can be read one branch at a time. Built from the flat snapshot the editor sends.
 * An object whose parent is missing is treated as a top-level one, and objects caught in a parent cycle are left
 * out of the tree and counted, so a damaged scene cannot make a read loop or fail.
 */
export class SceneIndex {
  readonly revision: number;
  /** Ids of the top-level objects, in scene order. */
  readonly roots: readonly string[];
  /** Objects that belong to no tree because their parents form a cycle. */
  readonly unreachable: number;
  readonly total: number;
  private readonly entries = new Map<string, IndexedObject>();
  private readonly parents = new Map<string, string | null>();

  constructor(scene: EditorContext) {
    this.revision = scene.revision;
    this.total = scene.objects.length;
    const byId = new Map(scene.objects.map((object) => [object.id, object]));
    const children = new Map<string, string[]>();
    const roots: string[] = [];
    for (const object of scene.objects) {
      const parent = object.parentId !== null && byId.has(object.parentId) && object.parentId !== object.id ? object.parentId : null;
      this.parents.set(object.id, parent);
      if (parent === null) roots.push(object.id);
      else children.set(parent, [...(children.get(parent) ?? []), object.id]);
    }
    this.roots = roots;

    // Children are summarised before their parents: visit from the roots, then settle in reverse order.
    const order: string[] = [];
    const stack = [...roots];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      order.push(id);
      for (const child of children.get(id) ?? []) stack.push(child);
    }
    this.unreachable = scene.objects.length - order.length;
    for (let at = order.length - 1; at >= 0; at -= 1) {
      const id = order[at];
      const object = id === undefined ? undefined : byId.get(id);
      if (id === undefined || !object) continue;
      const own = children.get(id) ?? [];
      let descendantCount = 0;
      const kinds: Record<string, number> = {};
      for (const childId of own) {
        const child = this.entries.get(childId);
        if (!child) continue;
        descendantCount += 1 + child.descendantCount;
        kinds[child.object.type] = (kinds[child.object.type] ?? 0) + 1;
        for (const [kind, count] of Object.entries(child.descendantKinds)) kinds[kind] = (kinds[kind] ?? 0) + count;
      }
      const bounds = boundsOf(object);
      this.entries.set(id, {
        object,
        children: own,
        descendantCount,
        descendantKinds: kinds,
        size: bounds?.size ?? null,
        center: bounds?.center ?? null,
      });
    }
  }

  get(id: string): IndexedObject | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** The object above this one, or null at the top. */
  parentOf(id: string): string | null {
    return this.parents.get(id) ?? null;
  }

  /** The names from the top of the scene down to the object, itself included. */
  path(id: string): { id: string; name: string }[] {
    const path: { id: string; name: string }[] = [];
    for (let at: string | null = id; at !== null && path.length < 64; at = this.parentOf(at)) {
      const entry = this.entries.get(at);
      if (!entry) break;
      path.unshift({ id: at, name: entry.object.name });
    }
    return path;
  }

  /** Whether `id` is `ancestor` or sits anywhere below it. */
  isWithin(id: string, ancestor: string): boolean {
    if (!this.entries.has(id)) return false;
    for (let at: string | null = id, steps = 0; at !== null && steps <= this.total; at = this.parentOf(at), steps += 1) {
      if (at === ancestor) return true;
    }
    return false;
  }

  /** Every object below `rootId` (or the whole tree, when it is undefined), parents before children. */
  *walk(rootId?: string): Generator<IndexedObject> {
    const stack = rootId === undefined ? [...this.roots].reverse() : [...(this.entries.get(rootId)?.children ?? [])].reverse();
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      yield entry;
      for (let at = entry.children.length - 1; at >= 0; at -= 1) {
        const child = entry.children[at];
        if (child !== undefined) stack.push(child);
      }
    }
  }
}
