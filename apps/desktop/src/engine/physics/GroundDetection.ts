import { Vector3 } from "three";

export interface GroundHit {
  found: boolean;
  /** World height of the surface under the query point. */
  height: number;
  /** Unit surface normal (pointing up). */
  readonly normal: Vector3;
}

export function createGroundHit(): GroundHit {
  return { found: false, height: 0, normal: new Vector3(0, 1, 0) };
}

/** Anything that can answer "how high is the floor here?". Foot placement depends only on this. */
export interface GroundProvider {
  /**
   * Finds the surface below (x, z). `aboveY` is a height known to be above the surface of
   * interest (typically the ankle height plus a margin); the query ignores anything higher.
   */
  sample(x: number, z: number, aboveY: number, out: GroundHit): GroundHit;
}

/** An infinite horizontal floor. Used by tests that do not need collision. */
export class FlatGround implements GroundProvider {
  readonly height: number;

  constructor(height = 0) {
    this.height = height;
  }

  sample(_x: number, _z: number, _aboveY: number, out: GroundHit): GroundHit {
    out.found = true;
    out.height = this.height;
    out.normal.set(0, 1, 0);
    return out;
  }
}
