import { roundVec, type IndexedObject, type SceneIndex } from "./scene-index.js";
import { baseName, type SignatureBook } from "./signature.js";

/** Entries a single read returns at most, so reading a huge scene never floods the conversation. */
export const MAX_BRANCH_ENTRIES = 300;

/** A run of this many siblings that look alike is shown as one entry. */
export const DEFAULT_FOLD_FROM = 4;

/** How many members of a folded run are named. */
const EXAMPLE_IDS = 3;

/** The summary of one object in a tree read. */
export interface ObjectSummary {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  /** World extents including what is inside, or null for an object with no geometry. */
  size: [number, number, number] | null;
  center: [number, number, number] | null;
  childCount: number;
  descendantCount: number;
  /** What is below, by type; only when there is something below. */
  descendants?: Record<string, number>;
}

/** Siblings that look alike, shown once. */
export interface RepeatEntry {
  repeat: true;
  name: string;
  type: string;
  count: number;
  templateId: string;
  exampleIds: string[];
  size: [number, number, number] | null;
  /** Objects inside each one. */
  descendantsEach: number;
}

/** One entry of a tree read: an object summary with its children, or a folded run of look-alikes. */
export type BranchEntry = (ObjectSummary & { children?: BranchEntry[]; childrenOmitted?: number }) | RepeatEntry;

/** The options of one tree read: the object to open, the depth, the paging, and whether look-alikes fold. */
export interface BranchOptions {
  rootId?: string | undefined;
  depth: number;
  childLimit: number;
  childOffset: number;
  /** Smallest run of look-alike siblings shown as one entry; 0 shows every sibling. */
  foldFrom: number;
}

/** The result of one tree read: the opened object if any, its children, and how to continue. */
export interface BranchRead {
  node?: ObjectSummary;
  path?: { id: string; name: string }[];
  children: BranchEntry[];
  /** Entries after the ones returned, at the level that was opened. */
  childrenOmitted: number;
  nextOffset?: number;
  /** True when the read stopped opening branches because it reached its size limit. */
  truncated: boolean;
}

/** Describes one indexed object for a tree read: its size, its center and what it holds. */
export function summarize(entry: IndexedObject): ObjectSummary {
  const summary: ObjectSummary = {
    id: entry.object.id,
    name: entry.object.name,
    type: entry.object.type,
    visible: entry.object.visible ?? true,
    size: entry.size ? roundVec(entry.size) : null,
    center: entry.center ? roundVec(entry.center) : null,
    childCount: entry.children.length,
    descendantCount: entry.descendantCount,
  };
  if (entry.descendantCount > 0) summary.descendants = { ...entry.descendantKinds };
  return summary;
}

/** Child ids in order, with each run of look-alike siblings replaced by one entry at the place its first member stood. */
function foldSiblings(
  index: SceneIndex,
  book: SignatureBook,
  ids: readonly string[],
  foldFrom: number,
): (string | RepeatEntry)[] {
  if (foldFrom <= 0) return [...ids];
  const bySignature = new Map<string, string[]>();
  for (const id of ids) {
    const signature = book.signatureOf(id);
    if (signature !== undefined) bySignature.set(signature, [...(bySignature.get(signature) ?? []), id]);
  }
  const folded = new Set<string>();
  const entries: (string | RepeatEntry)[] = [];
  for (const id of ids) {
    if (folded.has(id)) continue;
    const signature = book.signatureOf(id);
    const run = signature === undefined ? undefined : bySignature.get(signature);
    const first = run ? index.get(run[0] ?? id) : undefined;
    if (!run || run.length < foldFrom || !first) {
      entries.push(id);
      continue;
    }
    for (const member of run) folded.add(member);
    entries.push({
      repeat: true,
      name: baseName(first.object.name),
      type: first.object.type,
      count: run.length,
      templateId: first.object.id,
      exampleIds: run.slice(0, EXAMPLE_IDS),
      size: first.size ? roundVec(first.size) : null,
      descendantsEach: first.descendantCount,
    });
  }
  return entries;
}

/**
 * Reads one level of the scene tree, and optionally a few below it. The size of the answer follows how deep it looks
 * and how many different things are there, not how many objects the scene holds: look-alike siblings are folded, a
 * level is capped, and a read stops at a fixed number of entries.
 */
export function readBranch(index: SceneIndex, book: SignatureBook, options: BranchOptions): BranchRead {
  const root = options.rootId === undefined ? undefined : index.get(options.rootId);
  const topIds = root ? root.children : index.roots;
  let budget = MAX_BRANCH_ENTRIES;
  let truncated = false;

  const open = (
    ids: readonly string[],
    levelsLeft: number,
    offset: number,
  ): { entries: BranchEntry[]; omitted: number } => {
    const folded = foldSiblings(index, book, ids, options.foldFrom);
    const page = folded.slice(offset, offset + options.childLimit);
    const entries: BranchEntry[] = [];
    let taken = 0;
    for (const item of page) {
      if (budget <= 0) {
        truncated = true;
        break;
      }
      budget -= 1;
      taken += 1;
      if (typeof item !== "string") {
        entries.push(item);
        continue;
      }
      const child = index.get(item);
      if (!child) continue;
      const entry: BranchEntry = summarize(child);
      if (levelsLeft > 1 && child.children.length > 0) {
        const inner = open(child.children, levelsLeft - 1, 0);
        entry.children = inner.entries;
        if (inner.omitted > 0) entry.childrenOmitted = inner.omitted;
      }
      entries.push(entry);
    }
    return { entries, omitted: Math.max(0, folded.length - offset - taken) };
  };

  const opened = open(topIds, options.depth, options.childOffset);
  const read: BranchRead = { children: opened.entries, childrenOmitted: opened.omitted, truncated };
  if (root) {
    read.node = summarize(root);
    read.path = index.path(root.object.id);
  }
  if (opened.omitted > 0) read.nextOffset = options.childOffset + opened.entries.length;
  return read;
}
