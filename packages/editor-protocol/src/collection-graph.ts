import { isWithinBranch, resolveSiblingName } from "./scene-graph.js";

/**
 * Collections organize the scene without moving anything: a collection has a name, can sit inside another
 * collection, and can be hidden, which hides what is in it. An object is in exactly one collection (an object in
 * none is in the scene itself, the top). A collection has no place in space, so it is separate from an object's parent,
 * which is about where the object is. Collections have their own ids, apart from object ids.
 *
 * The backend judges a proposal on a snapshot and the editor applies it to the live scene with this one class, so the
 * two cannot disagree about what is allowed. Methods that can fail return the reason, which says how to fix it.
 */

export interface CollectionEntry {
  readonly id: string;
  readonly name: string;
  /** The collection it sits in, or null at the top. */
  readonly parentId: string | null;
  readonly visible: boolean;
}

interface Node {
  name: string;
  parentId: string | null;
  visible: boolean;
}

/** The outcome of a change that may rename: the name the collection ended up with, or why it cannot be done. */
export type CollectionResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string };

const fail = (message: string): CollectionResult => ({ ok: false, message });

/** The collections of a scene, as a graph. It checks that each collection's parent exists and that no collection sits inside itself, and says how to fix each problem. */
export class CollectionModel {
  private readonly nodes = new Map<string, Node>();
  private readonly membership = new Map<string, string>();

  constructor(collections: Iterable<CollectionEntry> = [], members: Iterable<readonly [string, string | null]> = []) {
    for (const entry of collections)
      this.nodes.set(entry.id, { name: entry.name, parentId: entry.parentId, visible: entry.visible });
    for (const [objectId, collectionId] of members)
      if (collectionId !== null) this.membership.set(objectId, collectionId);
  }

  clone(): CollectionModel {
    const copy = new CollectionModel();
    for (const [id, node] of this.nodes) copy.nodes.set(id, { ...node });
    for (const [objectId, collectionId] of this.membership) copy.membership.set(objectId, collectionId);
    return copy;
  }

  get size(): number {
    return this.nodes.size;
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  entries(): CollectionEntry[] {
    return [...this.nodes].map(([id, node]) => ({ id, ...node }));
  }

  parentOf(id: string): string | null | undefined {
    return this.nodes.get(id)?.parentId;
  }

  /** The collection an object is in, or null when it is in the scene itself. */
  collectionOf(objectId: string): string | null {
    return this.membership.get(objectId) ?? null;
  }

  /** The collections directly inside `parentId` (null: the top), in the order they were made. */
  collectionsIn(parentId: string | null): string[] {
    const found: string[] = [];
    for (const [id, node] of this.nodes) if (node.parentId === parentId) found.push(id);
    return found;
  }

  /** The objects directly in a collection. Objects in none are not listed: that is every object the model does not know. */
  objectsIn(collectionId: string): string[] {
    const found: string[] = [];
    for (const [objectId, id] of this.membership) if (id === collectionId) found.push(objectId);
    return found;
  }

  /** Whether the collection and everything it sits in are shown. The top is always shown. */
  effectiveVisible(collectionId: string | null): boolean {
    const seen = new Set<string>();
    for (let current = collectionId; current !== null && !seen.has(current); ) {
      seen.add(current);
      const node = this.nodes.get(current);
      if (!node) return true;
      if (!node.visible) return false;
      current = node.parentId;
    }
    return true;
  }

  private siblingNames(parentId: string | null, except?: string): Set<string> {
    const names = new Set<string>();
    for (const [id, node] of this.nodes) if (node.parentId === parentId && id !== except) names.add(node.name);
    return names;
  }

  /** Adds a collection. A name that a collection in the same place already has is made unique with a number. */
  create(id: string, name: string, parentId: string | null): CollectionResult {
    if (this.nodes.has(id)) return fail(`collectionId "${id}" already exists; use a fresh id for the collection`);
    if (parentId !== null && !this.nodes.has(parentId))
      return fail(
        `parentCollectionId "${parentId}" does not exist; create that collection first or use an id from editor.get_context`,
      );
    const resolved = resolveSiblingName(name, this.siblingNames(parentId));
    if (!resolved.ok) return fail(resolved.message);
    this.nodes.set(id, { name: resolved.name, parentId, visible: true });
    return { ok: true, name: resolved.name };
  }

  rename(id: string, name: string): CollectionResult {
    const node = this.nodes.get(id);
    if (!node) return fail(`collectionId "${id}" does not exist`);
    const resolved = resolveSiblingName(name, this.siblingNames(node.parentId, id));
    if (!resolved.ok) return fail(resolved.message);
    node.name = resolved.name;
    return { ok: true, name: resolved.name };
  }

  setVisible(id: string, visible: boolean): string | undefined {
    const node = this.nodes.get(id);
    if (!node) return `collectionId "${id}" does not exist`;
    node.visible = visible;
    return undefined;
  }

  /** Puts a collection inside another, or at the top. It cannot go inside itself or inside what it contains. */
  move(id: string, parentId: string | null): CollectionResult {
    const node = this.nodes.get(id);
    if (!node) return fail(`collectionId "${id}" does not exist`);
    if (parentId !== null && !this.nodes.has(parentId)) return fail(`parentCollectionId "${parentId}" does not exist`);
    if (parentId !== null && isWithinBranch(parentId, id, (above) => this.nodes.get(above)?.parentId)) {
      return fail(
        `collection "${id}" cannot be placed inside "${parentId}": that would put it inside itself or inside something it contains`,
      );
    }
    const resolved = resolveSiblingName(node.name, this.siblingNames(parentId, id));
    if (!resolved.ok) return fail(resolved.message);
    node.parentId = parentId;
    node.name = resolved.name;
    return { ok: true, name: resolved.name };
  }

  /** Removes an empty collection. One with objects or collections inside is refused, so nothing is deleted by accident. */
  remove(id: string): string | undefined {
    if (!this.nodes.has(id)) return `collectionId "${id}" does not exist, so it cannot be deleted`;
    const inside = [...this.collectionsIn(id).map((child) => `collection ${child}`), ...this.objectsIn(id)];
    if (inside.length > 0) {
      return `collectionId "${id}" is not empty (${inside.slice(0, 5).join(", ")}${inside.length > 5 ? ", …" : ""}); move or delete what is in it first, in earlier commands`;
    }
    this.nodes.delete(id);
    return undefined;
  }

  /** Puts an object in a collection, or in the scene itself with null. The object's existence is the caller's to check. */
  assign(objectId: string, collectionId: string | null): string | undefined {
    if (collectionId === null) {
      this.membership.delete(objectId);
      return undefined;
    }
    if (!this.nodes.has(collectionId))
      return `collectionId "${collectionId}" does not exist; create it first or use an id from editor.get_context`;
    this.membership.set(objectId, collectionId);
    return undefined;
  }

  /** Drops what is known of an object that has been deleted. */
  forget(objectId: string): void {
    this.membership.delete(objectId);
  }
}
