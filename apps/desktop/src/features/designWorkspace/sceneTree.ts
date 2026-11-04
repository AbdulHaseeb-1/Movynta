import { isWithinBranch } from "@movynta/editor-protocol";
import type { OutlineEntry } from "@/features/assistant";

/** The scene's objects arranged by parent. Built once per change of the scene, not once per render. */
export interface SceneTree {
  readonly entries: ReadonlyMap<string, OutlineEntry>;
  /** The parent each object hangs under, or null at the top level. A parent that is not in the scene counts as the top. */
  readonly parents: ReadonlyMap<string, string | null>;
  readonly roots: readonly string[];
  /** Each object's children in the order they were created. */
  readonly children: ReadonlyMap<string, readonly string[]>;
}

/** One line of the list. */
export interface TreeRow {
  readonly id: string;
  readonly name: string;
  readonly kind: OutlineEntry["kind"];
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly collapsed: boolean;
  /** The object's own flag. */
  readonly visible: boolean;
  /** Whether it is actually drawn: its own flag and that of everything above it. */
  readonly effectiveVisible: boolean;
}

export function buildSceneTree(list: readonly OutlineEntry[]): SceneTree {
  const entries = new Map<string, OutlineEntry>();
  for (const entry of list) entries.set(entry.id, entry);
  const parents = new Map<string, string | null>();
  for (const entry of list) {
    parents.set(entry.id, entry.parentId !== null && entry.parentId !== entry.id && entries.has(entry.parentId) ? entry.parentId : null);
  }
  cutLoops(parents);
  const roots: string[] = [];
  const children = new Map<string, string[]>();
  for (const entry of list) {
    const parent = parents.get(entry.id) ?? null;
    if (parent === null) {
      roots.push(entry.id);
      continue;
    }
    const siblings = children.get(parent);
    if (siblings) siblings.push(entry.id);
    else children.set(parent, [entry.id]);
  }
  return { entries, parents, roots, children };
}

/**
 * The scene never has a parent loop, but a list that is drawn from data should not lose objects or hang if it
 * does. Each loop is cut at the first object found in it, which then goes to the top level. One pass, each
 * object visited once.
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
 * The lines to show, parents before their children, skipping what is under a collapsed object. It walks with
 * its own stack, so a chain of thousands of objects cannot overflow the call stack.
 */
export function flattenTree(tree: SceneTree, collapsed: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const stack: { id: string; depth: number; above: boolean }[] = [];
  for (let i = tree.roots.length - 1; i >= 0; i -= 1) {
    const id = tree.roots[i];
    if (id !== undefined) stack.push({ id, depth: 0, above: true });
  }
  for (let top = stack.pop(); top; top = stack.pop()) {
    const entry = tree.entries.get(top.id);
    if (!entry) continue;
    const kids = tree.children.get(top.id) ?? [];
    const isCollapsed = kids.length > 0 && collapsed.has(top.id);
    rows.push({
      id: top.id,
      name: entry.name,
      kind: entry.kind,
      depth: top.depth,
      hasChildren: kids.length > 0,
      collapsed: isCollapsed,
      visible: entry.visible,
      effectiveVisible: top.above && entry.visible,
    });
    if (isCollapsed) continue;
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const kid = kids[i];
      if (kid !== undefined) stack.push({ id: kid, depth: top.depth + 1, above: top.above && entry.visible });
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

/** Collapsed ids with every object above `id` taken out, so `id` has a line in the list. */
export function revealed(tree: SceneTree, collapsed: ReadonlySet<string>, id: string): ReadonlySet<string> {
  let next: Set<string> | undefined;
  const seen = new Set<string>([id]);
  for (let above = tree.parents.get(id); above !== null && above !== undefined && !seen.has(above); above = tree.parents.get(above)) {
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
} as const;
