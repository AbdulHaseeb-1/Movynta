import { z } from "zod";

/**
 * A mesh path says which mesh inside an object a command is about: an imported model is one scene object with many
 * meshes in a tree of parts. Each step goes from a part to one of its children, in one of two forms:
 *
 * - a name, `"Arm"`, for the child with that name, or `"Arm#1"` for the second child with that name (the first is
 *   `"Arm"` or `"Arm#0"`). A name stays the same when other parts are added, removed or reordered.
 * - an index, `2`, for the child at that position. This is the form paths had before names existed, and it still
 *   means what it meant. It is also what a part with no name has to use. An index points at whatever is at that
 *   position now, so it can quietly come to mean another part when the parts change.
 *
 * `editor.inspect_mesh` and the editor's context give names wherever a part has one.
 */
export const meshStepSchema = z.union([z.number().int().nonnegative().max(100_000), z.string().min(1).max(130)]);
/** The schema for a path to a mesh inside an object. */
export const meshPathSchema = z.array(meshStepSchema).max(32);
/** One step of a mesh path: a part name, a repeat, or a child index. */
export type MeshStep = z.infer<typeof meshStepSchema>;
/** A path to a mesh inside an object. */
export type MeshPath = readonly MeshStep[];

/** What a part must have for a path to go through it. A three.js object has these. */
export interface PathNode {
  readonly name: string;
  readonly children: readonly PathNode[];
}

const ORDINAL = /^(.*)#(\d+)$/;

/** The name and which of the children with that name a step stands for. An index step has neither. */
function parseNamedStep(step: string): { name: string; ordinal: number } {
  const match = ORDINAL.exec(step);
  return match ? { name: match[1] ?? "", ordinal: Number(match[2]) } : { name: step, ordinal: 0 };
}

/** The part a step leads to from `node`, or undefined when there is none. */
export function stepInto<Node extends PathNode>(node: Node, step: MeshStep): Node | undefined {
  if (typeof step === "number") return node.children[step] as Node | undefined;
  const { name, ordinal } = parseNamedStep(step);
  if (name === "") return undefined;
  let seen = 0;
  for (const child of node.children) {
    if (child.name !== name) continue;
    if (seen === ordinal) return child as Node;
    seen += 1;
  }
  return undefined;
}

/** The part a path leads to, or undefined when a step has none. The empty path is the root itself. */
export function resolveMeshPath<Node extends PathNode>(root: Node | undefined, path: MeshPath): Node | undefined {
  let node = root;
  for (const step of path) {
    if (node === undefined) return undefined;
    node = stepInto(node, step);
  }
  return node;
}

/**
 * The step to each child of `parent`, in the form that keeps meaning the same part: its name, with `#n` when
 * another child earlier in the list has the same name (or when the name itself ends in `#` and a number, which
 * would otherwise be read as a count), and its index when it has no name. Counted once, so it costs the number of
 * children and not their square.
 */
export function stableSteps(parent: PathNode): MeshStep[] {
  const seen = new Map<string, number>();
  return parent.children.map((child, index) => {
    if (child.name === "") return index;
    const before = seen.get(child.name) ?? 0;
    seen.set(child.name, before + 1);
    return before > 0 || ORDINAL.test(child.name) ? `${child.name}#${before}` : child.name;
  });
}

/**
 * The same path in its stable form, by names where parts have them. Steps that lead nowhere are left as they were,
 * so the result still leads nowhere in the same way instead of silently going somewhere else.
 */
export function stableMeshPath<Node extends PathNode>(root: Node | undefined, path: MeshPath): MeshStep[] {
  const result: MeshStep[] = [];
  let node: PathNode | undefined = root;
  for (const step of path) {
    const next: PathNode | undefined = node === undefined ? undefined : stepInto(node, step);
    if (node === undefined || next === undefined) {
      result.push(step);
      node = undefined;
      continue;
    }
    const index = node.children.indexOf(next);
    result.push(stableSteps(node)[index] ?? step);
    node = next;
  }
  return result;
}
