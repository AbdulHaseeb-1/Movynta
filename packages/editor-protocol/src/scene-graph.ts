/**
 * Rules about the scene's structure that the backend (which checks a proposal against a snapshot) and the
 * desktop (which applies it to live objects) must agree on. They are pure and know nothing about three.js,
 * so both sides import this one implementation instead of keeping two that can drift.
 */

/** The longest object name the commands accept. A suffix added to keep siblings apart counts toward it. */
export const MAX_OBJECT_NAME_LENGTH = 80;

/**
 * Whether `candidate` is `target` itself or hangs below it. Placing `target` under such a candidate would
 * make a cycle. `parentOf` returns a node's parent, or null/undefined at the top; it is generic so that a
 * snapshot (ids) and live objects use the same walk. A loop already in the data ends the walk, not the process.
 */
export function isWithinBranch<Node>(
  candidate: Node | null | undefined,
  target: Node,
  parentOf: (node: Node) => Node | null | undefined,
): boolean {
  const seen = new Set<Node>();
  let current = candidate;
  while (current !== null && current !== undefined && !seen.has(current)) {
    if (current === target) return true;
    seen.add(current);
    current = parentOf(current);
  }
  return false;
}

/** The result of making a name unique among its siblings. */
export type NameResolution =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string };

const NUMBER_SUFFIX = /\.(\d{3,})$/;

function numbered(stem: string, number: number): string {
  return `${stem}.${String(number).padStart(3, "0")}`;
}

/** What was chosen, and the number added to the stem (0 when the name was free as it was). */
type Choice =
  | { readonly ok: true; readonly name: string; readonly stem: string; readonly number: number }
  | { readonly ok: false; readonly message: string };

/** `from` gives the number to start looking at for a stem; every lower number must already be known to be taken. */
function choose(base: string, taken: ReadonlySet<string>, from: (stem: string) => number): Choice {
  const trimmed = base.trim();
  if (trimmed.length === 0) return { ok: false, message: "A name cannot be empty" };
  if (trimmed.length > MAX_OBJECT_NAME_LENGTH) {
    return { ok: false, message: `A name can have at most ${MAX_OBJECT_NAME_LENGTH} characters` };
  }
  if (!taken.has(trimmed)) return { ok: true, name: trimmed, stem: trimmed, number: 0 };
  const stem = trimmed.replace(NUMBER_SUFFIX, "");
  let number = from(stem);
  while (taken.has(numbered(stem, number))) number += 1;
  const name = numbered(stem, number);
  if (name.length > MAX_OBJECT_NAME_LENGTH) {
    return {
      ok: false,
      message: `"${trimmed}" is taken and a numbered name would exceed ${MAX_OBJECT_NAME_LENGTH} characters; use a shorter name`,
    };
  }
  return { ok: true, name, stem, number };
}

/**
 * Makes `base` unique among the names its siblings already have. A free name is kept. Otherwise the
 * lowest free number is added: `Cube`, `Cube.001`, `Cube.002`. A name that already ends in a number
 * (`Cube.001`) is counted up from its stem, not extended to `Cube.001.001`.
 *
 * The answer depends only on the set of sibling names, never on their order, so a copy of the scene,
 * a prepared candidate and a replay all resolve the same name.
 */
export function resolveSiblingName(base: string, siblingNames: ReadonlySet<string>): NameResolution {
  const chosen = choose(base, siblingNames, () => 1);
  return chosen.ok ? { ok: true, name: chosen.name } : chosen;
}

/**
 * The names under one parent while a run of objects is added to it. `claim` gives exactly the name
 * `resolveSiblingName` would give for the names so far, and records it, but it does not scan the siblings
 * again for each object and it resumes the search for a free number where the last one stopped. That is what
 * keeps a batch of hundreds of same-named shapes from costing time quadratic in the batch.
 *
 * Only names are added here. If a name is removed or changed in between, make a new index.
 */
export class SiblingNames {
  private readonly names: Set<string>;
  /** For each stem, the lowest number that may still be free: every lower one has been taken. */
  private readonly next = new Map<string, number>();

  constructor(names: Iterable<string>) {
    this.names = new Set(names);
  }

  claim(base: string): NameResolution {
    // The hint only skips numbers that are known to be taken, so the answer is the one a search from 1 would give.
    const chosen = choose(base, this.names, (stem) => this.next.get(stem) ?? 1);
    if (!chosen.ok) return chosen;
    this.names.add(chosen.name);
    if (chosen.number > 0) this.next.set(chosen.stem, chosen.number + 1);
    return { ok: true, name: chosen.name };
  }
}
