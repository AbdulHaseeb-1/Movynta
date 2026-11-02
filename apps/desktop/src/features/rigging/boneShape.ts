/** A bone is drawn as an octahedron stretched from its joint to the joint of its child, as in Blender. */
export const SEGMENT_VERTICES = 24;
export const SEGMENT_FLOATS = SEGMENT_VERTICES * 3;

/** Where the widest part of the shape lies along the bone, and how wide it is, as fractions of its length. */
const WAIST_AT = 0.1;
const WAIST_WIDTH = 0.1;

/** Scratch space for the four corners of the waist, so drawing a bone allocates nothing. */
const waist = new Float64Array(12);

function put(out: Float32Array, at: number, x: number, y: number, z: number): number {
  out[at] = x;
  out[at + 1] = y;
  out[at + 2] = z;
  return at + 3;
}

/**
 * Writes the twelve edges of the bone shape from joint `head` to joint `tail` as line segments, at
 * `out[at]` onwards ({@link SEGMENT_FLOATS} numbers). `joints` holds x, y, z for each bone. A bone with
 * no length is written as a point, so the buffer stays valid.
 */
export function writeBoneSegment(
  out: Float32Array,
  at: number,
  joints: Float64Array,
  head: number,
  tail: number,
): void {
  const hx = joints[head * 3] ?? 0;
  const hy = joints[head * 3 + 1] ?? 0;
  const hz = joints[head * 3 + 2] ?? 0;
  const dx = (joints[tail * 3] ?? 0) - hx;
  const dy = (joints[tail * 3 + 1] ?? 0) - hy;
  const dz = (joints[tail * 3 + 2] ?? 0) - hz;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-9) {
    for (let vertex = 0; vertex < SEGMENT_VERTICES; vertex += 1) put(out, at + vertex * 3, hx, hy, hz);
    return;
  }
  const nx = dx / length;
  const ny = dy / length;
  const nz = dz / length;
  // Two unit vectors across the bone: the first from the axis least aligned with it, the second from both.
  const useY = Math.abs(ny) < 0.9;
  let ux = useY ? nz : 0;
  let uy = useY ? 0 : -nz;
  let uz = useY ? -nx : ny;
  const ulength = Math.hypot(ux, uy, uz);
  ux /= ulength;
  uy /= ulength;
  uz /= ulength;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;

  const half = length * WAIST_WIDTH;
  const cx = hx + dx * WAIST_AT;
  const cy = hy + dy * WAIST_AT;
  const cz = hz + dz * WAIST_AT;
  waist[0] = cx + ux * half;
  waist[1] = cy + uy * half;
  waist[2] = cz + uz * half;
  waist[3] = cx + vx * half;
  waist[4] = cy + vy * half;
  waist[5] = cz + vz * half;
  waist[6] = cx - ux * half;
  waist[7] = cy - uy * half;
  waist[8] = cz - uz * half;
  waist[9] = cx - vx * half;
  waist[10] = cy - vy * half;
  waist[11] = cz - vz * half;

  const tx = hx + dx;
  const ty = hy + dy;
  const tz = hz + dz;
  let cursor = at;
  for (let corner = 0; corner < 4; corner += 1) {
    const x = waist[corner * 3] ?? 0;
    const y = waist[corner * 3 + 1] ?? 0;
    const z = waist[corner * 3 + 2] ?? 0;
    const next = (corner + 1) % 4;
    // From the head to the corner, from the corner to the tail, and on round the waist to the next corner.
    cursor = put(out, cursor, hx, hy, hz);
    cursor = put(out, cursor, x, y, z);
    cursor = put(out, cursor, x, y, z);
    cursor = put(out, cursor, tx, ty, tz);
    cursor = put(out, cursor, x, y, z);
    cursor = put(out, cursor, waist[next * 3] ?? 0, waist[next * 3 + 1] ?? 0, waist[next * 3 + 2] ?? 0);
  }
}
