import type { BriefCheck, BriefCheckResult, BriefCheckStatus, BriefEvaluation, BriefSelector } from "./brief.schema.js";
import type { EditorContext } from "./editor-context.schema.js";

type Axis = "x" | "y" | "z";
type SceneObject = EditorContext["objects"][number];
interface Box { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }
type Resolved = { readonly found: true; readonly object: SceneObject; readonly box: Box } | { readonly found: false; readonly why: string };

const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
/** Absorbs floating-point noise so a part resting exactly on the floor does not fail by 1e-16. */
const EPSILON = 1e-6;

/** A number as people read it: four significant digits, no trailing zeros. */
function format(value: number): string {
  return String(Number.parseFloat(value.toPrecision(4)));
}

function describe(selector: BriefSelector): string {
  if (selector.id !== undefined) return `id "${selector.id}"`;
  if (selector.name !== undefined) return `named "${selector.name}"`;
  return `named "${selector.namePrefix ?? ""}…"`;
}

function matching(scene: EditorContext, selector: BriefSelector): SceneObject[] {
  if (selector.id !== undefined) return scene.objects.filter((object) => object.id === selector.id);
  if (selector.name !== undefined) {
    const name = selector.name.toLowerCase();
    return scene.objects.filter((object) => object.name.toLowerCase() === name);
  }
  const prefix = (selector.namePrefix ?? "").toLowerCase();
  return scene.objects.filter((object) => object.name.toLowerCase().startsWith(prefix));
}

function resolve(scene: EditorContext, selector: BriefSelector): Resolved {
  const found = matching(scene, selector);
  const [object] = found;
  if (object === undefined) return { found: false, why: `no object ${describe(selector)} exists` };
  if (found.length > 1) {
    const ids = found.slice(0, 4).map((item) => item.id).join(", ");
    return { found: false, why: `${found.length} objects are ${describe(selector)} (${ids}${found.length > 4 ? ", …" : ""}); use the id of the one meant` };
  }
  if (!object.worldBounds) return { found: false, why: `"${object.name}" has no geometry bounds yet` };
  return { found: true, object, box: object.worldBounds };
}

function range(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && min === max) return `exactly ${format(min)}`;
  if (min !== undefined && max !== undefined) return `between ${format(min)} and ${format(max)}`;
  if (min !== undefined) return `at least ${format(min)}`;
  return `at most ${format(max ?? 0)}`;
}

function within(value: number, min: number | undefined, max: number | undefined): boolean {
  return (min === undefined || value >= min - EPSILON) && (max === undefined || value <= max + EPSILON);
}

function extent(box: Box, axis: Axis): number {
  const index = AXIS_INDEX[axis];
  return box.max[index] - box.min[index];
}

/** A tolerance that scales with the objects involved when the brief gives none: 2% of the largest side. */
function defaultTolerance(boxes: readonly Box[], fraction: number): number {
  let largest = 0;
  for (const box of boxes) for (const axis of ["x", "y", "z"] as const) largest = Math.max(largest, extent(box, axis));
  return Math.max(largest * fraction, EPSILON);
}

function result(index: number, check: BriefCheck, label: string, status: BriefCheckStatus, measured: string, expected: string): BriefCheckResult {
  return { index, label: check.label ?? label, kind: check.kind, status, measured, expected };
}

function unresolved(index: number, check: BriefCheck, label: string, why: string): BriefCheckResult {
  return result(index, check, label, "unresolved", why, "a measurable object");
}

function verdict(ok: boolean): BriefCheckStatus {
  return ok ? "pass" : "fail";
}

/** The meshes at and under `rootId`, nearest first, that have bounds. */
function partsUnder(scene: EditorContext, rootId: string): { readonly object: SceneObject; readonly box: Box }[] {
  const children = new Map<string, SceneObject[]>();
  for (const object of scene.objects) {
    if (object.parentId === null) continue;
    children.set(object.parentId, [...(children.get(object.parentId) ?? []), object]);
  }
  const byId = new Map(scene.objects.map((object) => [object.id, object] as const));
  const parts: { object: SceneObject; box: Box }[] = [];
  const seen = new Set<string>();
  const queue = [rootId];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const object = byId.get(id);
    if (object?.type === "mesh" && object.worldBounds) parts.push({ object, box: object.worldBounds });
    for (const child of children.get(id) ?? []) queue.push(child.id);
  }
  return parts;
}

function touching(a: Box, b: Box, tolerance: number): boolean {
  return [0, 1, 2].every((axis) => (a.min[axis] ?? 0) <= (b.max[axis] ?? 0) + tolerance && (b.min[axis] ?? 0) <= (a.max[axis] ?? 0) + tolerance);
}

function evaluateCheck(scene: EditorContext, check: BriefCheck, index: number): BriefCheckResult {
  switch (check.kind) {
    case "count": {
      const found = matching(scene, check.selector).length;
      const min = check.min ?? 1;
      const expected = check.max === undefined ? `at least ${min}` : min === check.max ? `exactly ${min}` : `${min} to ${check.max}`;
      return result(index, check, `count of objects ${describe(check.selector)}`, verdict(found >= min && (check.max === undefined || found <= check.max)), `${found} found`, expected);
    }
    case "size": {
      const target = resolve(scene, check.target);
      const label = `size ${check.axis} of ${describe(check.target)}`;
      if (!target.found) return unresolved(index, check, label, target.why);
      const value = extent(target.box, check.axis);
      return result(index, check, label, verdict(within(value, check.min, check.max)), format(value), range(check.min, check.max));
    }
    case "position": {
      const target = resolve(scene, check.target);
      const label = `${check.anchor} ${check.axis} of ${describe(check.target)}`;
      if (!target.found) return unresolved(index, check, label, target.why);
      const at = AXIS_INDEX[check.axis];
      const value = check.anchor === "min" ? target.box.min[at] : check.anchor === "max" ? target.box.max[at] : (target.box.min[at] + target.box.max[at]) / 2;
      return result(index, check, label, verdict(within(value, check.min, check.max)), format(value), range(check.min, check.max));
    }
    case "gap": {
      const first = resolve(scene, check.first);
      const second = resolve(scene, check.second);
      const label = `gap on ${check.axis} from ${describe(check.first)} to ${describe(check.second)}`;
      if (!first.found) return unresolved(index, check, label, first.why);
      if (!second.found) return unresolved(index, check, label, second.why);
      const at = AXIS_INDEX[check.axis];
      const value = second.box.min[at] - first.box.max[at];
      return result(index, check, label, verdict(within(value, check.min, check.max)), format(value), range(check.min, check.max));
    }
    case "symmetric": {
      const first = resolve(scene, check.first);
      const second = resolve(scene, check.second);
      const label = `${describe(check.first)} mirrors ${describe(check.second)} across ${check.axis}`;
      if (!first.found) return unresolved(index, check, label, first.why);
      if (!second.found) return unresolved(index, check, label, second.why);
      const plane = check.planeAt ?? 0;
      const tolerance = check.tolerance ?? defaultTolerance([first.box, second.box], 0.02);
      const mirrored = AXIS_INDEX[check.axis];
      let worst = 0;
      let worstAxis: Axis = check.axis;
      for (const axis of ["x", "y", "z"] as const) {
        const at = AXIS_INDEX[axis];
        // Mirroring swaps the low and high edges on the mirrored axis and leaves the others as they are.
        const expectedMin = at === mirrored ? 2 * plane - first.box.max[at] : first.box.min[at];
        const expectedMax = at === mirrored ? 2 * plane - first.box.min[at] : first.box.max[at];
        const off = Math.max(Math.abs(second.box.min[at] - expectedMin), Math.abs(second.box.max[at] - expectedMax));
        if (off > worst) { worst = off; worstAxis = axis; }
      }
      return result(index, check, label, verdict(worst <= tolerance + EPSILON), worst <= EPSILON ? "exact mirror" : `off by ${format(worst)} on ${worstAxis}`, `within ${format(tolerance)}`);
    }
    case "aligned": {
      const first = resolve(scene, check.first);
      const second = resolve(scene, check.second);
      const label = `${describe(check.first)} and ${describe(check.second)} share a center on ${check.axis}`;
      if (!first.found) return unresolved(index, check, label, first.why);
      if (!second.found) return unresolved(index, check, label, second.why);
      const at = AXIS_INDEX[check.axis];
      const off = Math.abs((first.box.min[at] + first.box.max[at]) / 2 - (second.box.min[at] + second.box.max[at]) / 2);
      const tolerance = check.tolerance ?? defaultTolerance([first.box, second.box], 0.02);
      return result(index, check, label, verdict(off <= tolerance + EPSILON), `centers differ by ${format(off)}`, `within ${format(tolerance)}`);
    }
    case "connected": {
      const group = resolve(scene, check.group);
      const label = `parts of ${describe(check.group)} form one piece`;
      if (!group.found) return unresolved(index, check, label, group.why);
      const parts = partsUnder(scene, group.object.id);
      if (parts.length < 2) return result(index, check, label, "pass", `${parts.length} part, nothing to join`, "every part touching the rest");
      const tolerance = check.tolerance ?? defaultTolerance([group.box], 0.01);
      // Parts are joined into pieces wherever their bounds touch; the largest piece is the body, the rest are loose.
      const piece = parts.map((_, position) => position);
      const root = (position: number): number => {
        let at = position;
        while (piece[at] !== at) { piece[at] = piece[piece[at] ?? at] ?? at; at = piece[at] ?? at; }
        return at;
      };
      for (let a = 0; a < parts.length; a += 1) {
        for (let b = a + 1; b < parts.length; b += 1) {
          const first = parts[a];
          const second = parts[b];
          if (first && second && touching(first.box, second.box, tolerance)) piece[root(a)] = root(b);
        }
      }
      const sizes = new Map<number, number>();
      for (let position = 0; position < parts.length; position += 1) sizes.set(root(position), (sizes.get(root(position)) ?? 0) + 1);
      let body = root(0);
      for (const [key, size] of sizes) if (size > (sizes.get(body) ?? 0)) body = key;
      const loose = parts.filter((_, position) => root(position) !== body).map((part) => part.object.name || part.object.id);
      const shown = loose.slice(0, 5).join(", ") + (loose.length > 5 ? ", …" : "");
      return result(index, check, label, verdict(loose.length === 0), loose.length === 0 ? `${parts.length} parts form one piece` : `${loose.length} of ${parts.length} parts are detached: ${shown}`, "every part touching the rest");
    }
    case "contained": {
      const inner = resolve(scene, check.inner);
      const outer = resolve(scene, check.outer);
      const label = `${describe(check.inner)} lies inside ${describe(check.outer)}`;
      if (!inner.found) return unresolved(index, check, label, inner.why);
      if (!outer.found) return unresolved(index, check, label, outer.why);
      const tolerance = check.tolerance ?? defaultTolerance([outer.box], 0.01);
      let worst = 0;
      let where = "";
      for (const axis of ["x", "y", "z"] as const) {
        const at = AXIS_INDEX[axis];
        const below = outer.box.min[at] - inner.box.min[at];
        const above = inner.box.max[at] - outer.box.max[at];
        if (below > worst) { worst = below; where = `-${axis}`; }
        if (above > worst) { worst = above; where = `+${axis}`; }
      }
      return result(index, check, label, verdict(worst <= tolerance + EPSILON), worst <= EPSILON ? "inside" : `sticks out by ${format(worst)} toward ${where}`, `within ${format(tolerance)} of the outside`);
    }
  }
}

/**
 * Measures every check of a brief against a scene snapshot. Pure and synchronous, so the assistant's own checks,
 * the run's completion rules and the quality benchmarks all judge a scene the same way.
 */
export function evaluateBrief(scene: EditorContext, brief: { readonly checks: readonly BriefCheck[] }): BriefEvaluation {
  const results = brief.checks.map((check, index) => evaluateCheck(scene, check, index));
  const count = (status: BriefCheckStatus) => results.filter((entry) => entry.status === status).length;
  return {
    revision: scene.revision,
    // Editors that predate bounds report none at all; an empty scene still has something to say (nothing exists).
    measurable: scene.objects.length === 0 || scene.objects.some((object) => object.worldBounds !== undefined),
    passed: count("pass"),
    failed: count("fail"),
    unresolved: count("unresolved"),
    results,
  };
}

/** True when every check passed and the editor could measure them. */
export function briefPassed(evaluation: BriefEvaluation): boolean {
  return evaluation.measurable && evaluation.failed === 0 && evaluation.unresolved === 0;
}
