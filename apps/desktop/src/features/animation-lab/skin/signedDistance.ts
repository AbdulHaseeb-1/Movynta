import type { Vector3 } from "three";
import type { BodyPrimitive } from "./bodyPrimitives";

/** Sentinel for "far from everything" in a grid; larger than any distance the body can produce. */
export const FAR = 1e3;

/** Polynomial smooth minimum: a union whose creases are filleted over a width of `k`. */
export function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Distance from a point to the axis segment of a primitive, and where along it the nearest point lies (0..1). */
export interface SegmentHit {
  readonly distance: number;
  readonly t: number;
}

/** Signed distance to the surface of the union of all strokes (negative inside), smoothed at the joints. */
export class BodyField {
  readonly primitives: readonly BodyPrimitive[];
  /** Width over which neighbouring strokes are filleted into each other. */
  readonly smoothing: number;
  private readonly lengthSquared: number[];
  /** Primitive indices grouped by chain, in order. */
  readonly chains: readonly (readonly number[])[];

  constructor(primitives: readonly BodyPrimitive[], smoothing: number) {
    this.primitives = primitives;
    this.smoothing = smoothing;
    this.lengthSquared = primitives.map((p) => p.a.distanceToSquared(p.b));
    const byChain = new Map<string, number[]>();
    primitives.forEach((p, index) => byChain.set(p.chain, [...(byChain.get(p.chain) ?? []), index]));
    this.chains = Array.from(byChain.values());
  }

  /** Signed distance of one stroke at a point: distance to its axis segment minus its radius. */
  primitiveDistance(index: number, x: number, y: number, z: number): number {
    const hit = this.segment(index, x, y, z);
    return hit.distance - (this.primitives[index]?.radius ?? 0);
  }

  segment(index: number, x: number, y: number, z: number): SegmentHit {
    const p = this.primitives[index];
    if (!p) return { distance: FAR, t: 0 };
    const abx = p.b.x - p.a.x;
    const aby = p.b.y - p.a.y;
    const abz = p.b.z - p.a.z;
    const apx = x - p.a.x;
    const apy = y - p.a.y;
    const apz = z - p.a.z;
    const len2 = this.lengthSquared[index] ?? 0;
    let t = len2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = apx - abx * t;
    const dy = apy - aby * t;
    const dz = apz - abz * t;
    return { distance: Math.sqrt(dx * dx + dy * dy + dz * dz), t };
  }

  /** Exact union of the strokes of one chain (a straight run of tubes has no fillet bulge at its joins). */
  chainDistance(chain: number, x: number, y: number, z: number): number {
    let d = FAR;
    for (const index of this.chains[chain] ?? []) d = Math.min(d, this.primitiveDistance(index, x, y, z));
    return d;
  }

  /** Signed distance to the whole body: exact within a chain, smoothly filleted between chains. */
  distance(x: number, y: number, z: number): number {
    let d = FAR;
    for (let c = 0; c < this.chains.length; c++) d = smoothMin(d, this.chainDistance(c, x, y, z), this.smoothing);
    return d;
  }

  /** Unit gradient (the outward surface direction) by central differences. */
  gradient(x: number, y: number, z: number, out: Vector3): Vector3 {
    const e = 1e-4;
    out.set(
      this.distance(x + e, y, z) - this.distance(x - e, y, z),
      this.distance(x, y + e, z) - this.distance(x, y - e, z),
      this.distance(x, y, z + e) - this.distance(x, y, z - e),
    );
    const length = out.length();
    return length > 1e-12 ? out.multiplyScalar(1 / length) : out.set(0, 1, 0);
  }

  /** The stroke whose surface is nearest to a point. Used to decide which bones a surface point follows. */
  nearest(x: number, y: number, z: number): { index: number; t: number } {
    let best = 0;
    let bestDistance = Infinity;
    let bestT = 0;
    for (let i = 0; i < this.primitives.length; i++) {
      const hit = this.segment(i, x, y, z);
      const d = hit.distance - (this.primitives[i]?.radius ?? 0);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
        bestT = hit.t;
      }
    }
    return { index: best, t: bestT };
  }
}
