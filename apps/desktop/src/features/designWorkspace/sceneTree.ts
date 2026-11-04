import { isWithinBranch } from "@movynta/editor-protocol";
import type { CollectionEntry, OutlineEntry } from "@/features/assistant";

/**
 * What a line of the list stands for. Objects are listed under the collection they are in, collections under the
 * collection they sit in, and the scene itself is the top. Ids of lines are made so that they cannot be confused: an
 * object's line is its id, which has no ":" in it, and the others have one.
 */
export type RowKind = "mesh" | "empty" | "collection" | "root";

export const ROOT_ROW_ID = ":scene";
const COLLECTION_PREFIX = "collection:";
export const collectionRowId = (collectionId: string): string => `${COLLECTION_PREFIX}${collectionId}`;

/** The thing a line stands for. */
export type RowTarget = { readonly kind: "object"; readonly id: string } | { readonly kind: "collection"; readonly id: string } | { readonly kind: "root" };
export function rowTarget(rowId: string): RowTarget {
  if (rowId === ROOT_ROW_ID) return { kind: "root" };
  return rowId.startsWith(COLLECTION_PREFIX) ? { kind: "collection", id: rowId.slice(COLLECTION_PREFIX.length) } : { kind: "object", id: rowId };
}

/** The scene's objects and collections arranged for a list. Built once per change of the scene, not once per render. */
export interface SceneTree {
  readonly entries: ReadonlyMap<string, OutlineEntry>;
  readonly collections: ReadonlyMap<string, CollectionEntry>;
  /** The object each object hangs under (where it is in space), or null at the top. A parent that is not in the scene counts as the top. */
  readonly parents: ReadonlyMap<string, string | null>;
  /** The collection each collection sits in, or null at the top. */
  readonly collectionParents: ReadonlyMap<string, string | null>;
  /** The line each line is listed under. The top has none. */
  readonly displayParent: ReadonlyMap<string, string>;
  /** The lines listed under each line: collections first, then objects, each in the order they were made. */
  readonly displayChildren: ReadonlyMap<string, readonly string[]>;
  /** The lines listed directly in the scene itself. */
  readonly roots: readonly string[];
}

/** One line of the list. */
export interface TreeRow {
  readonly id: string;
  readonly name: string;
  readonly kind: RowKind;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly collapsed: boolean;
  /** The object's or collection's own flag. */
  readonly visible: boolean;
  /** Whether it is actually drawn: its own flag and that of everything it is listed under. */
  readonly effectiveVisible: boolean;
}

export function buildSceneTree(list: readonly OutlineEntry[], collectionList: readonly CollectionEntry[] = []): SceneTree {
  const entries = new Map<string, OutlineEntry>();
  for (const entry of list) entries.set(entry.id, entry);
  const collections = new Map<string, CollectionEntry>();
  for (const collection of collectionList) collections.set(collection.id, collection);

  const parents = new Map<string, string | null>();
  for (const entry of list) {
    parents.set(entry.id, entry.parentId !== null && entry.parentId !== entry.id && entries.has(entry.parentId) ? entry.parentId : null);
  }
  cutLoops(parents);
  const collectionParents = new Map<string, string | null>();
  for (const collection of collectionList) {
    collectionParents.set(collection.id, collection.parentId !== null && collection.parentId !== collection.id && collections.has(collection.parentId) ? collection.parentId : null);
  }
  cutLoops(collectionParents);

  const displayParent = new Map<string, string>();
  const displayChildren = new Map<string, string[]>();
  const place = (child: string, parent: string) => {
    displayParent.set(child, parent);
    const siblings = displayChildren.get(parent);
    if (siblings) siblings.push(child);
    else displayChildren.set(parent, [child]);
  };
  // Collections before objects, so a collection lists what it holds after the collections inside it.
  for (const collection of collectionList) {
    const above = collectionParents.get(collection.id) ?? null;
    place(collectionRowId(collection.id), above === null ? ROOT_ROW_ID : collectionRowId(above));
  }
  for (const entry of list) {
    const parent = parents.get(entry.id) ?? null;
    const parentEntry = parent === null ? undefined : entries.get(parent);
    // An object hangs under its parent when they are in the same collection; otherwise it is listed in its own collection.
    if (parentEntry && parentEntry.collectionId === entry.collectionId) {
      place(entry.id, parentEntry.id);
    } else {
      place(entry.id, entry.collectionId !== null && collections.has(entry.collectionId) ? collectionRowId(entry.collectionId) : ROOT_ROW_ID);
    }
  }
  return { entries, collections, parents, collectionParents, displayParent, displayChildren, roots: displayChildren.get(ROOT_ROW_ID) ?? [] };
}

/**
 * The scene never has a parent loop, but a list that is drawn from data should not lose lines or hang if it does.
 * Each loop is cut at the first line found in it, which then goes to the top. One pass, each line visited once.
 */
function cutLoops(parents: Map<string, string | null>): void {
  const done = new Set<string>();
  for (const start of parents.keys()) {
    if (done.has(start)) continue;
    const path = new Set<string>();
    let current: string | null | undefined = start;
    while (current !== null && current !== undefined && !done.has(current)) {
      if (path.has(current)) {
        parents.set(current, null);
        break;
      }
      path.add(current);
      current = parents.get(current);
    }
    for (const id of path) done.add(id);
  }
}

/**
 * The lines to show, parents before their children, skipping what is under a collapsed line. A line for the scene
 * itself comes first once there is a collection to drop things on; with none, the list is just the objects, as before.
 * It walks with its own stack, so a chain of thousands of objects cannot overflow the call stack.
 */
export function flattenTree(tree: SceneTree, collapsed: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const showRoot = tree.collections.size > 0;
  const stack: { id: string; depth: number; above: boolean }[] = [];
  if (showRoot) stack.push({ id: ROOT_ROW_ID, depth: 0, above: true });
  else for (let i = tree.roots.length - 1; i >= 0; i -= 1) stack.push({ id: tree.roots[i] ?? "", depth: 0, above: true });
  for (let top = stack.pop(); top; top = stack.pop()) {
    const target = rowTarget(top.id);
    const kids = tree.displayChildren.get(top.id) ?? [];
    const isCollapsed = kids.length > 0 && collapsed.has(top.id);
    let name: string;
    let kind: RowKind;
    let visible = true;
    if (target.kind === "root") {
      name = "Scene collection";
      kind = "root";
    } else if (target.kind === "collection") {
      const collection = tree.collections.get(target.id);
      if (!collection) continue;
      name = collection.name;
      kind = "collection";
      visible = collection.visible;
    } else {
      const entry = tree.entries.get(target.id);
      if (!entry) continue;
      name = entry.name;
      kind = entry.kind;
      visible = entry.visible;
    }
    rows.push({ id: top.id, name, kind, depth: top.depth, hasChildren: kids.length > 0, collapsed: isCollapsed, visible, effectiveVisible: top.above && visible });
    if (isCollapsed) continue;
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const kid = kids[i];
      if (kid !== undefined) stack.push({ id: kid, depth: top.depth + 1, above: top.above && visible });
    }
  }
  return rows;
}

/**
 * Whether `id` can be dropped under `parentId` (null: the top level). It cannot go where it already is, under
 * itself, or under something that hangs below it: the same rule the backend and the editor apply.
 */
export function canMoveUnder(tree: SceneTree, id: string, parentId: string | null): boolean {
  if (!tree.entries.has(id)) return false;
  if (tree.parents.get(id) === parentId) return false;
  if (parentId === null) return true;
  if (!tree.entries.has(parentId)) return false;
  return !isWithinBranch(parentId, id, (node) => tree.parents.get(node));
}

/** What dropping one line on another does. The editor applies the same rules again when it is saved. */
export type DropAction =
  | { readonly kind: "parent"; readonly objectId: string; readonly parentId: string | null }
  | { readonly kind: "collect"; readonly objectId: string; readonly collectionId: string | null }
  | { readonly kind: "nest"; readonly collectionId: string; readonly parentCollectionId: string | null };

/**
 * What dropping the line `dragged` on the line `onto` would do, or undefined when it would do nothing or is not
 * allowed. `onto` is null for the strip that takes an object out of its parent. An object dropped on an object
 * becomes its child; on a collection (or the scene) it goes into it; a collection dropped on a collection (or the
 * scene) goes inside it.
 */
export function dropAction(tree: SceneTree, dragged: string, onto: string | null): DropAction | undefined {
  const source = rowTarget(dragged);
  if (source.kind === "root") return undefined;
  if (onto === null) {
    return source.kind === "object" && canMoveUnder(tree, source.id, null) ? { kind: "parent", objectId: source.id, parentId: null } : undefined;
  }
  const target = rowTarget(onto);
  if (source.kind === "object") {
    const entry = tree.entries.get(source.id);
    if (!entry) return undefined;
    if (target.kind === "object") return canMoveUnder(tree, source.id, target.id) ? { kind: "parent", objectId: source.id, parentId: target.id } : undefined;
    const into = target.kind === "root" ? null : target.id;
    if (into !== null && !tree.collections.has(into)) return undefined;
    return entry.collectionId === into ? undefined : { kind: "collect", objectId: source.id, collectionId: into };
  }
  if (target.kind === "object") return undefined;
  const into = target.kind === "root" ? null : target.id;
  if (!tree.collections.has(source.id) || (into !== null && !tree.collections.has(into))) return undefined;
  if (tree.collectionParents.get(source.id) === into) return undefined;
  if (into !== null && isWithinBranch(into, source.id, (node) => tree.collectionParents.get(node))) return undefined;
  return { kind: "nest", collectionId: source.id, parentCollectionId: into };
}

/** Collapsed lines with every line above `id` taken out, so `id` has a line in the list. */
export function revealed(tree: SceneTree, collapsed: ReadonlySet<string>, id: string): ReadonlySet<string> {
  let next: Set<string> | undefined;
  const seen = new Set<string>([id]);
  for (let above = tree.displayParent.get(id); above !== undefined && !seen.has(above); above = tree.displayParent.get(above)) {
    seen.add(above);
    if (!collapsed.has(above)) continue;
    next ??= new Set(collapsed);
    next.delete(above);
  }
  return next ?? collapsed;
}

/** The lines to draw for a list scrolled to `scrollTop`: the ones in view and a few either side of them. */
export function visibleRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 6): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewport)) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

/** The scroll position that brings line `index` into view with the least movement, or the current one if it already is. */
export function scrollToRow(scrollTop: number, viewport: number, rowHeight: number, index: number): number {
  const top = index * rowHeight;
  if (top < scrollTop) return top;
  if (top + rowHeight > scrollTop + viewport) return top + rowHeight - viewport;
  return scrollTop;
}

/** The commands a change in the list saves. They are the same commands the assistant proposes. */
export const outlineCommands = {
  rename: (objectId: string, name: string) => ({ commandId: `rename_${crypto.randomUUID()}`, type: "scene.rename_object", objectId, name }),
  move: (objectId: string, parentId: string | null) => ({ commandId: `parent_${crypto.randomUUID()}`, type: "scene.set_parent", objectId, parentId }),
  show: (objectId: string, visible: boolean) => ({ commandId: `visibility_${crypto.randomUUID()}`, type: "scene.set_visibility", objectId, visible }),
  makeCollection: (collectionId: string, name: string, parentCollectionId: string | null) => ({
    commandId: `collection_${crypto.randomUUID()}`, type: "scene.create_collection", collectionId, name, ...(parentCollectionId === null ? {} : { parentCollectionId }),
  }),
  renameCollection: (collectionId: string, name: string) => ({ commandId: `rename_${crypto.randomUUID()}`, type: "scene.rename_collection", collectionId, name }),
  showCollection: (collectionId: string, visible: boolean) => ({ commandId: `visibility_${crypto.randomUUID()}`, type: "scene.set_collection_visibility", collectionId, visible }),
  nestCollection: (collectionId: string, parentCollectionId: string | null) => ({ commandId: `nest_${crypto.randomUUID()}`, type: "scene.move_collection", collectionId, parentCollectionId }),
  deleteCollection: (collectionId: string) => ({ commandId: `delete_${crypto.randomUUID()}`, type: "scene.delete_collection", collectionId }),
  collect: (objectId: string, collectionId: string | null) => ({ commandId: `collect_${crypto.randomUUID()}`, type: "scene.move_to_collection", objectId, collectionId, includeChildren: true }),
} as const;

/** The commands for a drop that `dropAction` allowed. */
export function dropCommands(action: DropAction) {
  if (action.kind === "parent") return [outlineCommands.move(action.objectId, action.parentId)];
  if (action.kind === "collect") return [outlineCommands.collect(action.objectId, action.collectionId)];
  return [outlineCommands.nestCollection(action.collectionId, action.parentCollectionId)];
}
