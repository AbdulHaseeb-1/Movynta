import type { Quaternion, Vector3 } from "three";

export const DEG = Math.PI / 180;
export const TWO_PI = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : clamp01((value - a) / (b - a));
}

/** Hermite ease with zero slope at both ends. */
export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Smoother ease (zero first and second derivative at both ends). */
export function smootherstep(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Fractional part in [0, 1), correct for negative values. */
export function fract(value: number): number {
  return value - Math.floor(value);
}

/** Wraps an angle to (-PI, PI]. */
export function wrapPi(angle: number): number {
  let a = (angle + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

/** Frame-rate independent exponential approach: `lambda` is the response rate in 1/s. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Moves `current` toward `target` by at most `maxDelta`. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta;
}

export function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

export function isFiniteVector(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function isValidQuaternion(q: Quaternion): boolean {
  if (!(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w))) return false;
  return Math.abs(q.lengthSq() - 1) < 1e-4;
}

/** Quaternion for a rotation about the local X, then Y, then Z axes (three.js "XYZ" order), angles in radians. */
export function quatFromEuler(out: Quaternion, x: number, y: number, z: number): Quaternion {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  out.x = s1 * c2 * c3 + c1 * s2 * s3;
  out.y = c1 * s2 * c3 - s1 * c2 * s3;
  out.z = c1 * c2 * s3 + s1 * s2 * c3;
  out.w = c1 * c2 * c3 - s1 * s2 * s3;
  return out;
}

const SCRATCH_EULER_MATRIX = { m11: 0, m12: 0, m13: 0, m22: 0, m23: 0, m33: 0 };

/** Decomposes a unit quaternion into XYZ-order Euler angles (radians). Stable for a middle angle within +-90 degrees. */
export function eulerFromQuat(q: Quaternion, out: Vector3): Vector3 {
  const { x, y, z, w } = q;
  const m = SCRATCH_EULER_MATRIX;
  m.m11 = 1 - 2 * (y * y + z * z);
  m.m12 = 2 * (x * y - z * w);
  m.m13 = 2 * (x * z + y * w);
  m.m22 = 1 - 2 * (x * x + z * z);
  m.m23 = 2 * (y * z - x * w);
  m.m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(clamp(m.m13, -1, 1));
  if (Math.abs(m.m13) < 0.9999999) {
    out.set(Math.atan2(-m.m23, m.m33), ey, Math.atan2(-m.m12, m.m11));
  } else {
    out.set(Math.atan2(2 * (y * z + x * w), m.m22), ey, 0);
  }
  return out;
}

/**
 * Critically-damped-ish spring. `update` is stable for the fixed simulation step
 * (semi-implicit Euler, `omega * dt` kept below 1 by the caller's step size).
 */
export class SpringDamper {
  value: number;
  velocity = 0;
  omega: number;
  zeta: number;

  constructor(initial = 0, omega = 12, zeta = 1) {
    this.value = initial;
    this.omega = omega;
    this.zeta = zeta;
  }

  update(target: number, dt: number): number {
    const accel = this.omega * this.omega * (target - this.value) - 2 * this.zeta * this.omega * this.velocity;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
    return this.value;
  }

  reset(value = 0): void {
    this.value = value;
    this.velocity = 0;
  }
}
