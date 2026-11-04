import {
  composeTrs,
  decomposeTrs,
  hasCollapsedAxis,
  IDENTITY_MATRIX,
  IDENTITY_TRS,
  invertAffine,
  isExactTrs,
  multiplyMat4,
  type Mat4,
  type Trs,
  type Vec3,
} from "./transform-math.js";

/** A transform as a command carries it: every part is optional. */
interface PartialTransform {
  readonly position?: readonly number[] | undefined;
  readonly rotation?: readonly number[] | undefined;
  readonly scale?: readonly number[] | undefined;
}

function vec3(value: readonly number[] | undefined, fallback: Vec3): Vec3 {
  return value ? [value[0] ?? fallback[0], value[1] ?? fallback[1], value[2] ?? fallback[2]] : fallback;
}

/**
 * Follows where each object is while a batch is checked, so that a move under another parent can be judged before
 * it is made. The editor keeps an object where it is in the world when it is given a new parent; that is only exact
 * when the object's new place can be stored as position, rotation and scale. Otherwise the editor folds the leftover
 * into the mesh and its children, which a proposal from the assistant must not do silently.
 *
 * This is only needed by a batch that moves an object to a new parent, so it is made only for such a batch.
 */
export class PlacementTracker {
  private readonly places = new Map<string, Trs>();

  constructor(
    objects: readonly { readonly id: string; readonly transform: PartialTransform }[],
    /** The parent of an object as the batch has left it so far. */
    private readonly parentOf: (id: string) => string | null | undefined,
  ) {
    for (const object of objects) this.created(object.id, object.transform);
  }

  created(id: string, transform?: PartialTransform): void {
    this.places.set(id, {
      position: vec3(transform?.position, IDENTITY_TRS.position),
      rotation: vec3(transform?.rotation, IDENTITY_TRS.rotation),
      scale: vec3(transform?.scale, IDENTITY_TRS.scale),
    });
  }

  transformed(id: string, transform: PartialTransform): void {
    const before = this.places.get(id) ?? IDENTITY_TRS;
    this.places.set(id, {
      position: vec3(transform.position, before.position),
      rotation: vec3(transform.rotation, before.rotation),
      scale: vec3(transform.scale, before.scale),
    });
  }

  moved(id: string, delta: readonly number[]): void {
    const before = this.places.get(id) ?? IDENTITY_TRS;
    this.places.set(id, {
      ...before,
      position: [before.position[0] + (delta[0] ?? 0), before.position[1] + (delta[1] ?? 0), before.position[2] + (delta[2] ?? 0)],
    });
  }

  removed(id: string): void {
    this.places.delete(id);
  }

  /**
   * Moves `id` under `parentId` (null: the top level) without moving it in the world, as the editor does. Returns
   * what is wrong with that, or undefined when it can be done exactly, in which case the object's new place is
   * remembered for the commands that follow. Call it before the parents are updated.
   */
  reparent(id: string, parentId: string | null): string | undefined {
    const inverse = invertAffine(parentId === null ? IDENTITY_MATRIX : this.world(parentId));
    if (!inverse) {
      return `"${parentId}" has no size along one of its axes (a scale of 0), so nothing can be placed under it and kept where it is; give it a small positive scale first`;
    }
    const local = multiplyMat4(inverse, this.world(id));
    if (hasCollapsedAxis(local)) {
      return `"${id}" has no size along one of its axes (a scale of 0), so it cannot be moved to another parent without flattening its mesh for good; give it a small positive scale first`;
    }
    if (!isExactTrs(local)) {
      const where = parentId === null ? "the top level" : `"${parentId}"`;
      return `"${id}" cannot be moved to ${where} and stay where it is without shearing its mesh: something above it or above ${where} is scaled by different amounts on different axes and "${id}" is turned relative to it. Give that group the same scale on every axis, or create the part under the group with parentId instead of moving it there`;
    }
    this.places.set(id, decomposeTrs(local));
    return undefined;
  }

  /** The world matrix of `id`: its own place after those of everything above it. */
  private world(id: string): Mat4 {
    const chain: string[] = [];
    const seen = new Set<string>();
    for (let current: string | null | undefined = id; current !== null && current !== undefined && !seen.has(current); current = this.parentOf(current)) {
      seen.add(current);
      chain.push(current);
    }
    let matrix: Mat4 = IDENTITY_MATRIX;
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const link = chain[i];
      matrix = multiplyMat4(matrix, composeTrs((link === undefined ? undefined : this.places.get(link)) ?? IDENTITY_TRS));
    }
    return matrix;
  }
}
