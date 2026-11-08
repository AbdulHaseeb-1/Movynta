import { round3, type IndexedObject, type SceneIndex, type Vec3 } from "./scene-index.js";
import { baseName, type SignatureBook } from "./signature.js";

const AXES = ["x", "y", "z"] as const;
type AxisName = (typeof AXES)[number];

/** How the members of a repeated group are laid out, worked out from their world positions. */
export type Arrangement =
  /** Evenly spaced along one axis. */
  | { kind: "line"; axis: AxisName; count: number; step: number }
  /** A regular grid over two or three axes, evenly spaced on each. */
  | { kind: "grid"; axes: AxisName[]; counts: number[]; steps: number[] }
  /** Every member sits in the same place, which is usually a mistake. */
  | { kind: "coincident" }
  /** No regular spacing was found. */
  | { kind: "scattered" };

/** A set of look-alike objects, described once: a template, its size and how its members are arranged. */
export interface RepeatGroup {
  /** The name the members share, without the numbering that tells them apart. */
  name: string;
  type: string;
  count: number;
  /** The member to treat as the original. */
  templateId: string;
  /** The members' ids, up to `MAX_MEMBER_IDS`. */
  memberIds: string[];
  memberIdsOmitted: number;
  /** World extents of one member, in axis order. */
  size: [number, number, number] | null;
  /** How many objects one member holds below itself. */
  descendantsEach: number;
  /** Distinct parents of the members, up to five, and how many there are in all. */
  parentIds: (string | null)[];
  parentCount: number;
  arrangement: Arrangement;
}

/** The groups found in a scene, and how much of the scene they cover. */
export interface RepeatReport {
  /** Objects looked at. */
  scanned: number;
  /** Objects inside the groups reported, members and what they hold. */
  covered: number;
  groups: RepeatGroup[];
  /** Groups that matched the settings but are not listed because of the limit. */
  omittedGroups: number;
}

/** Options for finding repeats: the branch to search, the smallest group, and how many groups to return. */
export interface RepeatOptions {
  rootId?: string | undefined;
  minCount: number;
  limit: number;
}

/** Members listed per group. A group with more has the rest counted, not named. */
export const MAX_MEMBER_IDS = 50;

/** Positions within this share of the member's largest side count as the same line or row. */
const POSITION_TOLERANCE = 0.01;

/** Splits sorted values into runs where neighbours are within `tolerance`. Returns each value's run, in input order. */
function clusterIndexes(values: readonly number[], tolerance: number): { index: number[]; starts: number[] } {
  const order = values.map((value, at) => ({ value, at })).sort((a, b) => a.value - b.value);
  const index = new Array<number>(values.length).fill(0);
  const starts: number[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const { value, at } of order) {
    if (value - previous > tolerance) starts.push(value);
    index[at] = starts.length - 1;
    previous = value;
  }
  return { index, starts };
}

/** The distance from the first run to the last, if the runs are evenly spaced; otherwise undefined. */
function evenSpan(starts: readonly number[], tolerance: number): number | undefined {
  const steps = starts.slice(1).map((value, at) => value - (starts[at] ?? value));
  const first = steps[0];
  if (first === undefined) return undefined;
  return steps.every((step) => Math.abs(step - first) <= tolerance)
    ? (starts[starts.length - 1] ?? 0) - (starts[0] ?? 0)
    : undefined;
}

/** Tells whether the centers form a line, a grid, one pile, or no pattern. */
export function arrangementOf(centers: readonly Vec3[], size: Vec3 | null): Arrangement {
  const tolerance = POSITION_TOLERANCE * Math.max(1e-6, ...(size ?? [1, 1, 1]));
  const perAxis = AXES.map((_, axis) =>
    clusterIndexes(
      centers.map((center) => center[axis] ?? 0),
      tolerance,
    ),
  );
  const varying = perAxis.flatMap((clusters, axis) => (clusters.starts.length > 1 ? [axis] : []));
  if (varying.length === 0) return { kind: "coincident" };

  const counts = varying.map((axis) => perAxis[axis]?.starts.length ?? 1);
  const cells = new Set(centers.map((_, member) => varying.map((axis) => perAxis[axis]?.index[member] ?? 0).join(",")));
  // Every cell of the lattice holds exactly one member, or the layout is not a regular array.
  if (cells.size !== centers.length || counts.reduce((product, count) => product * count, 1) !== centers.length)
    return { kind: "scattered" };

  const steps: number[] = [];
  for (const axis of varying) {
    const starts = perAxis[axis]?.starts ?? [];
    const span = evenSpan(starts, tolerance);
    if (span === undefined) return { kind: "scattered" };
    steps.push(round3(span / (starts.length - 1)));
  }
  const names = varying.map((axis) => AXES[axis] ?? "x");
  if (varying.length === 1) return { kind: "line", axis: names[0] ?? "x", count: centers.length, step: steps[0] ?? 0 };
  return { kind: "grid", axes: names, counts, steps };
}

function describe(index: SceneIndex, members: readonly IndexedObject[]): RepeatGroup {
  const first = members[0];
  if (!first) throw new Error("A group has at least one member");
  const parents = [...new Set(members.map((member) => index.parentOf(member.object.id)))];
  const centers = members.flatMap((member) => (member.center ? [member.center] : []));
  return {
    name: baseName(first.object.name),
    type: first.object.type,
    count: members.length,
    templateId: first.object.id,
    memberIds: members.slice(0, MAX_MEMBER_IDS).map((member) => member.object.id),
    memberIdsOmitted: Math.max(0, members.length - MAX_MEMBER_IDS),
    size: first.size ? [round3(first.size[0]), round3(first.size[1]), round3(first.size[2])] : null,
    descendantsEach: first.descendantCount,
    parentIds: parents.slice(0, 5),
    parentCount: parents.length,
    arrangement: centers.length === members.length ? arrangementOf(centers, first.size) : { kind: "scattered" },
  };
}

/**
 * Finds sets of objects that look like copies of one another: the same type, name (ignoring numbering) and size,
 * holding the same kind of parts. A group of repeated windows is reported once, not again as its frames and panes.
 * Groups are ordered by how much of the scene they stand for.
 */
export function findRepeats(index: SceneIndex, book: SignatureBook, options: RepeatOptions): RepeatReport {
  const nodes = [...index.walk(options.rootId)];
  const buckets = new Map<string, IndexedObject[]>();
  for (const node of nodes) {
    const signature = book.signatureOf(node.object.id);
    if (signature === undefined) continue;
    buckets.set(signature, [...(buckets.get(signature) ?? []), node]);
  }
  const ranked = [...buckets.values()]
    .filter((members) => members.length >= options.minCount)
    .sort(
      (a, b) =>
        b.length * (1 + (b[0]?.descendantCount ?? 0)) - a.length * (1 + (a[0]?.descendantCount ?? 0)) ||
        (a[0]?.object.name ?? "").localeCompare(b[0]?.object.name ?? ""),
    );

  const covered = new Set<string>();
  const chosen: IndexedObject[][] = [];
  for (const members of ranked) {
    // Parts of a repeated group repeat with it; reporting them again would only repeat the same fact.
    if (members.every((member) => covered.has(member.object.id))) continue;
    chosen.push(members);
    for (const member of members) {
      covered.add(member.object.id);
      for (const inside of index.walk(member.object.id)) covered.add(inside.object.id);
    }
  }
  return {
    scanned: nodes.length,
    covered: covered.size,
    groups: chosen.slice(0, options.limit).map((members) => describe(index, members)),
    omittedGroups: Math.max(0, chosen.length - options.limit),
  };
}
