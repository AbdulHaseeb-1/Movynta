import { Box3, Ray, Vector3, type Triangle } from "three";

interface Branch {
  box: Box3;
  triangles?: Triangle[];
  children?: [Branch, Branch];
}

function build(triangles: Triangle[]): Branch {
  const box = new Box3();
  for (const triangle of triangles) box.expandByPoint(triangle.a).expandByPoint(triangle.b).expandByPoint(triangle.c);
  if (triangles.length <= 8) return { box, triangles };
  const { x, y, z } = box.getSize(new Vector3());
  const axis = x >= y && x >= z ? "x" : y >= z ? "y" : "z";
  triangles.sort((a, b) => a.a[axis] + a.b[axis] + a.c[axis] - (b.a[axis] + b.b[axis] + b.c[axis]));
  const middle = triangles.length >> 1;
  return { box, children: [build(triangles.slice(0, middle)), build(triangles.slice(middle))] };
}

/** The gap between two boxes along each axis. Zero where they overlap. */
export function boxGap(a: Box3, b: Box3): Vector3 {
  const gap = (axis: "x" | "y" | "z") => Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis]);
  return new Vector3(gap("x"), gap("y"), gap("z"));
}

function lowerBound(a: Box3, b: Box3): number {
  const x = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const y = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const z = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return x * x + y * y + z * z;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Minimum between two finite segments, including parallel and zero-length segments. */
function segmentDistance(a: Vector3, b: Vector3, c: Vector3, d: Vector3, u: Vector3, v: Vector3, w: Vector3): number {
  u.subVectors(b, a);
  v.subVectors(d, c);
  w.subVectors(a, c);
  const uu = u.lengthSq(),
    vv = v.lengthSq(),
    uv = u.dot(v),
    uw = u.dot(w),
    vw = v.dot(w);
  const denominator = uu * vv - uv * uv;
  let s = denominator > uu * vv * Number.EPSILON ? clamp((uv * vw - uw * vv) / denominator) : 0;
  let t = vv > 0 ? (uv * s + vw) / vv : 0;
  if (t < 0 || t > 1 || vv === 0) {
    t = clamp(t);
    s = uu > 0 ? clamp((uv * t - uw) / uu) : 0;
  }
  return w.addScaledVector(u, s).addScaledVector(v, -t).lengthSq();
}

/** World-space triangle surface distance. A bounded search either returns the minimum or reports its budget. */
export function closestSurface(first: Triangle[], second: Triangle[]): number {
  if (!first.length || !second.length) throw new Error("Both targets need triangle surfaces");
  const rootA = build(first),
    rootB = build(second);
  const ray = new Ray(),
    hit = new Vector3(),
    u = new Vector3(),
    v = new Vector3(),
    w = new Vector3();
  let best = Infinity;
  let comparisons = 0;
  function compare(a: Triangle, b: Triangle): void {
    if (++comparisons > 250_000)
      throw new Error("Closest-surface search exceeded its work limit. Choose smaller mesh parts.");
    const sides = [a, b] as const;
    for (const side of sides) {
      const other = side === a ? b : a;
      const points = [side.a, side.b, side.c];
      for (let i = 0; i < 3; i += 1) {
        const p = points[i],
          q = points[(i + 1) % 3];
        if (!p || !q) continue;
        best = Math.min(best, other.closestPointToPoint(p, hit).distanceToSquared(p));
        ray.origin.copy(p);
        const length = ray.direction.subVectors(q, p).length();
        if (length > 0) {
          ray.direction.divideScalar(length);
          if (
            ray.intersectTriangle(other.a, other.b, other.c, false, hit) &&
            hit.distanceToSquared(p) <= length * length
          ) {
            best = 0;
            return;
          }
        }
        if (side === a)
          best = Math.min(
            best,
            segmentDistance(p, q, b.a, b.b, u, v, w),
            segmentDistance(p, q, b.b, b.c, u, v, w),
            segmentDistance(p, q, b.c, b.a, u, v, w),
          );
      }
    }
  }
  function visit(a: Branch, b: Branch): void {
    if (lowerBound(a.box, b.box) >= best) return;
    if (a.triangles && b.triangles) {
      for (const firstTriangle of a.triangles) {
        for (const secondTriangle of b.triangles) {
          compare(firstTriangle, secondTriangle);
          if (best === 0) return;
        }
      }
      return;
    }
    if (a.children) {
      const [left, right] = a.children;
      if (lowerBound(left.box, b.box) <= lowerBound(right.box, b.box)) {
        visit(left, b);
        visit(right, b);
      } else {
        visit(right, b);
        visit(left, b);
      }
    } else if (b.children) {
      const [left, right] = b.children;
      if (lowerBound(a.box, left.box) <= lowerBound(a.box, right.box)) {
        visit(a, left);
        visit(a, right);
      } else {
        visit(a, right);
        visit(a, left);
      }
    }
  }
  visit(rootA, rootB);
  return Math.sqrt(best);
}
