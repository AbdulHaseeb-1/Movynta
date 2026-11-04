/**
 * The little matrix maths the backend needs to judge a re-parenting without three.js: compose an object's place
 * from position, rotation and scale, move it between parents, and tell whether the result can still be stored as
 * position, rotation and scale. The editor stores objects that way, as three.js does (rotation is Euler angles in
 * XYZ order, in radians), and the tests compare every function here with three.js.
 *
 * A matrix is 16 numbers in column-major order and always affine: its last row is 0, 0, 0, 1.
 */

export type Vec3 = readonly [number, number, number];
export type Mat4 = readonly number[];

/** Where an object is, relative to its parent. */
export interface Trs {
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

export const IDENTITY_MATRIX: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const IDENTITY_TRS: Trs = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

/** Below this, a matrix has no inverse for the purpose of keeping an object in place. The editor uses the same limit. */
const SINGULAR_LIMIT = 1e-12;
/**
 * How far two columns may be from perpendicular, as the cosine of the angle between them, before the matrix counts
 * as sheared. A real shear is far larger (a rotated child under a parent scaled 2:1 is about 0.4); rounding noise
 * is far smaller (about 1e-16).
 */
const SHEAR_LIMIT = 1e-6;

const at = (m: Mat4, index: number): number => m[index] ?? 0;

/** Position, rotation (XYZ Euler) and scale as one matrix: translate, then rotate, then scale. */
export function composeTrs({ position, rotation, scale }: Trs): Mat4 {
  const [x, y, z] = rotation;
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const [sx, sy, sz] = scale;
  return [
    c * e * sx, (af + be * d) * sx, (bf - ae * d) * sx, 0,
    -c * f * sy, (ae - bf * d) * sy, (be + af * d) * sy, 0,
    d * sz, -b * c * sz, a * c * sz, 0,
    position[0], position[1], position[2], 1,
  ];
}

/** `a` applied after `b`: the matrix of an object with local matrix `b` under a parent whose world matrix is `a`. */
export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += at(a, k * 4 + row) * at(b, column * 4 + k);
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** The inverse of an affine matrix, or undefined when its scale has collapsed on some axis. */
export function invertAffine(m: Mat4): Mat4 | undefined {
  const [a, b, c] = [at(m, 0), at(m, 1), at(m, 2)];
  const [d, e, f] = [at(m, 4), at(m, 5), at(m, 6)];
  const [g, h, i] = [at(m, 8), at(m, 9), at(m, 10)];
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  if (Math.abs(det) < SINGULAR_LIMIT) return undefined;
  const k = 1 / det;
  const i00 = (e * i - f * h) * k, i01 = (g * f - d * i) * k, i02 = (d * h - g * e) * k;
  const i10 = (h * c - b * i) * k, i11 = (a * i - g * c) * k, i12 = (g * b - a * h) * k;
  const i20 = (b * f - e * c) * k, i21 = (d * c - a * f) * k, i22 = (a * e - d * b) * k;
  const [tx, ty, tz] = [at(m, 12), at(m, 13), at(m, 14)];
  return [
    i00, i10, i20, 0,
    i01, i11, i21, 0,
    i02, i12, i22, 0,
    -(i00 * tx + i01 * ty + i02 * tz), -(i10 * tx + i11 * ty + i12 * tz), -(i20 * tx + i21 * ty + i22 * tz), 1,
  ];
}

function columnLength(m: Mat4, column: number): number {
  return Math.hypot(at(m, column * 4), at(m, column * 4 + 1), at(m, column * 4 + 2));
}

function determinant3(m: Mat4): number {
  const [a, b, c, d, e, f, g, h, i] = [at(m, 0), at(m, 1), at(m, 2), at(m, 4), at(m, 5), at(m, 6), at(m, 8), at(m, 9), at(m, 10)];
  return a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
}

/**
 * Position, rotation and scale of a matrix, as three.js splits it: the scale of each axis is the length of its
 * column, and one axis is negative when the matrix mirrors. Rotation comes from the columns divided by their scales.
 * Only a matrix that is a position, a rotation and a scale (see {@link isExactTrs}) is given back exactly.
 */
export function decomposeTrs(m: Mat4): Trs {
  let sx = columnLength(m, 0);
  const sy = columnLength(m, 1);
  const sz = columnLength(m, 2);
  if (determinant3(m) < 0) sx = -sx;
  const ix = sx === 0 ? 0 : 1 / sx, iy = sy === 0 ? 0 : 1 / sy, iz = sz === 0 ? 0 : 1 / sz;
  const m11 = at(m, 0) * ix, m12 = at(m, 4) * iy, m13 = at(m, 8) * iz;
  const m22 = at(m, 5) * iy, m23 = at(m, 9) * iz;
  const m32 = at(m, 6) * iy, m33 = at(m, 10) * iz;
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  const gimbal = Math.abs(m13) >= 0.9999999;
  const x = gimbal ? Math.atan2(m32, m22) : Math.atan2(-m23, m33);
  const z = gimbal ? 0 : Math.atan2(-m12, m11);
  return { position: [at(m, 12), at(m, 13), at(m, 14)], rotation: [x, y, z], scale: [sx, sy, sz] };
}

/** True when an axis of the matrix has no length: the object has been scaled to nothing in some direction. */
export function hasCollapsedAxis(m: Mat4): boolean {
  return [0, 1, 2].some((column) => columnLength(m, column) < SINGULAR_LIMIT);
}

/**
 * Whether position, rotation and scale can hold this matrix without losing anything, which is what the editor
 * needs to move an object to another parent and keep it where it is. They cannot when the axes are no longer
 * perpendicular, which is what a rotated child gets when its parent is scaled differently on different axes.
 * They cannot either when an axis has collapsed: three.js cannot split such a matrix, so the editor would fold the
 * leftover into the mesh and flatten it for good.
 */
export function isExactTrs(m: Mat4): boolean {
  if (hasCollapsedAxis(m)) return false;
  const lengths = [columnLength(m, 0), columnLength(m, 1), columnLength(m, 2)];
  for (const [first, second] of [[0, 1], [0, 2], [1, 2]] as const) {
    const dot = at(m, first * 4) * at(m, second * 4) + at(m, first * 4 + 1) * at(m, second * 4 + 1) + at(m, first * 4 + 2) * at(m, second * 4 + 2);
    if (Math.abs(dot) / ((lengths[first] ?? 1) * (lengths[second] ?? 1)) > SHEAR_LIMIT) return false;
  }
  return true;
}
