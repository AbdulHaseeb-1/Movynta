import { Vector3 } from "three";
import { FAR, smoothMin, type BodyField } from "./signedDistance";

/** A triangle mesh with outward vertex normals taken from the distance field's gradient. */
export interface SurfaceMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
}

const at = (array: ArrayLike<number>, index: number): number => array[index] ?? 0;

/** The 12 edges of a cell as pairs of corner indices (corner bit 0 = +x, bit 1 = +y, bit 2 = +z). */
const CELL_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Meshes the zero level set of the body's distance field with naive surface nets, then snaps every vertex onto the
 * exact surface. The result is one connected, closed, smoothly shaded skin: no capsules, no seams at the joints.
 */
export function meshBodySurface(field: BodyField, cellSize: number, padding = 0.1): SurfaceMesh {
  // Bounds of all strokes plus room for the radius, fillets and one margin cell.
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of field.primitives) {
    for (const point of [p.a, p.b]) {
      min.x = Math.min(min.x, point.x - p.radius);
      min.y = Math.min(min.y, point.y - p.radius);
      min.z = Math.min(min.z, point.z - p.radius);
      max.x = Math.max(max.x, point.x + p.radius);
      max.y = Math.max(max.y, point.y + p.radius);
      max.z = Math.max(max.z, point.z + p.radius);
    }
  }
  const margin = field.smoothing + padding * 0.2 + cellSize * 2;
  min.addScalar(-margin);
  max.addScalar(margin);
  const nx = Math.ceil((max.x - min.x) / cellSize);
  const ny = Math.ceil((max.y - min.y) / cellSize);
  const nz = Math.ceil((max.z - min.z) / cellSize);
  const sx = nx + 1;
  const sy = ny + 1;
  const sz = nz + 1;
  const corner = (i: number, j: number, k: number): number => i + sx * (j + sy * k);

  // Distance samples at the grid corners. Each stroke only touches the cells near it.
  const samples = new Float32Array(sx * sy * sz).fill(FAR);
  for (let chain = 0; chain < field.chains.length; chain++) {
    // Box around every stroke of the chain, grown by what can still influence the surface.
    const box = { lo: new Vector3(Infinity, Infinity, Infinity), hi: new Vector3(-Infinity, -Infinity, -Infinity) };
    let widest = 0;
    for (const index of field.chains[chain] ?? []) {
      const p = field.primitives[index];
      if (!p) continue;
      box.lo.min(p.a).min(p.b);
      box.hi.max(p.a).max(p.b);
      widest = Math.max(widest, p.radius);
    }
    const reach = widest + field.smoothing + cellSize * 2;
    const lo = {
      i: Math.max(0, Math.floor((box.lo.x - reach - min.x) / cellSize)),
      j: Math.max(0, Math.floor((box.lo.y - reach - min.y) / cellSize)),
      k: Math.max(0, Math.floor((box.lo.z - reach - min.z) / cellSize)),
    };
    const hi = {
      i: Math.min(nx, Math.ceil((box.hi.x + reach - min.x) / cellSize)),
      j: Math.min(ny, Math.ceil((box.hi.y + reach - min.y) / cellSize)),
      k: Math.min(nz, Math.ceil((box.hi.z + reach - min.z) / cellSize)),
    };
    for (let k = lo.k; k <= hi.k; k++) {
      for (let j = lo.j; j <= hi.j; j++) {
        for (let i = lo.i; i <= hi.i; i++) {
          const d = field.chainDistance(chain, min.x + i * cellSize, min.y + j * cellSize, min.z + k * cellSize);
          const c = corner(i, j, k);
          samples[c] = smoothMin(at(samples, c), d, field.smoothing);
        }
      }
    }
  }

  // One vertex per cell that the surface crosses, placed at the mean of its edge crossings.
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const cell = (i: number, j: number, k: number): number => i + nx * (j + ny * k);
  const vertices: number[] = [];
  const cornerValues = new Float64Array(8);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = at(samples, corner(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1)));
          cornerValues[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0;
        let py = 0;
        let pz = 0;
        let crossings = 0;
        for (const [c0, c1] of CELL_EDGES) {
          const v0 = at(cornerValues, c0);
          const v1 = at(cornerValues, c1);
          if (v0 < 0 === v1 < 0) continue;
          const t = v0 / (v0 - v1);
          px += (i + (c0 & 1) + t * ((c1 & 1) - (c0 & 1))) * cellSize;
          py += (j + ((c0 >> 1) & 1) + t * (((c1 >> 1) & 1) - ((c0 >> 1) & 1))) * cellSize;
          pz += (k + ((c0 >> 2) & 1) + t * (((c1 >> 2) & 1) - ((c0 >> 2) & 1))) * cellSize;
          crossings++;
        }
        cellVertex[cell(i, j, k)] = vertices.length / 3;
        vertices.push(min.x + px / crossings, min.y + py / crossings, min.z + pz / crossings);
      }
    }
  }

  // Snap each vertex onto the exact surface and take its normal from the field.
  const positions = new Float32Array(vertices);
  const normals = new Float32Array(vertices.length);
  const gradient = new Vector3();
  for (let v = 0; v < vertices.length; v += 3) {
    let x = at(positions, v);
    let y = at(positions, v + 1);
    let z = at(positions, v + 2);
    for (let iteration = 0; iteration < 2; iteration++) {
      const d = field.distance(x, y, z);
      field.gradient(x, y, z, gradient);
      x -= gradient.x * d;
      y -= gradient.y * d;
      z -= gradient.z * d;
    }
    field.gradient(x, y, z, gradient);
    positions[v] = x;
    positions[v + 1] = y;
    positions[v + 2] = z;
    normals[v] = gradient.x;
    normals[v + 1] = gradient.y;
    normals[v + 2] = gradient.z;
  }

  // One quad for every grid edge the surface crosses, joining the four cells around that edge.
  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const diagonalAC = distanceBetween(positions, a, c);
    const diagonalBD = distanceBetween(positions, b, d);
    const [p, q, r, s] = flip ? [a, d, c, b] : [a, b, c, d];
    if (diagonalAC <= diagonalBD) indices.push(p, q, r, p, r, s);
    else indices.push(q, r, s, q, s, p);
  };
  for (let k = 1; k < nz; k++) {
    for (let j = 1; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const inside = at(samples, corner(i, j, k)) < 0;
        // x edge from (i,j,k) to (i+1,j,k)
        if (inside !== at(samples, corner(i + 1, j, k)) < 0) {
          quad(at(cellVertex, cell(i, j - 1, k - 1)), at(cellVertex, cell(i, j, k - 1)), at(cellVertex, cell(i, j, k)), at(cellVertex, cell(i, j - 1, k)), !inside);
        }
        // y edge
        if (inside !== at(samples, corner(i, j + 1, k)) < 0) {
          quad(at(cellVertex, cell(i - 1, j, k - 1)), at(cellVertex, cell(i - 1, j, k)), at(cellVertex, cell(i, j, k)), at(cellVertex, cell(i, j, k - 1)), !inside);
        }
        // z edge
        if (inside !== at(samples, corner(i, j, k + 1)) < 0) {
          quad(at(cellVertex, cell(i - 1, j - 1, k)), at(cellVertex, cell(i, j - 1, k)), at(cellVertex, cell(i, j, k)), at(cellVertex, cell(i - 1, j, k)), !inside);
        }
      }
    }
  }
  return { positions, normals, indices: new Uint32Array(indices) };
}

function distanceBetween(positions: Float32Array, a: number, b: number): number {
  const dx = at(positions, a * 3) - at(positions, b * 3);
  const dy = at(positions, a * 3 + 1) - at(positions, b * 3 + 1);
  const dz = at(positions, a * 3 + 2) - at(positions, b * 3 + 2);
  return dx * dx + dy * dy + dz * dz;
}
