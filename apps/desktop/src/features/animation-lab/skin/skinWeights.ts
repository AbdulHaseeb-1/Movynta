import { BONE_NAMES, type BoneName } from "@/engine/character/types";
import type { BodyField } from "./signedDistance";
import type { SurfaceMesh } from "./surfaceNets";

/** Bones that can influence one vertex. Three.js skinning reads four per vertex. */
export const MAX_INFLUENCES = 4;
const BONE_COUNT = BONE_NAMES.length;

const BONE_INDEX: Readonly<Record<string, number | undefined>> = Object.fromEntries(BONE_NAMES.map((name, index) => [name, index]));

export function boneIndex(name: BoneName): number {
  return BONE_INDEX[name] ?? 0;
}

/** Skin weights in the layout three.js wants: four bone indices and four weights per vertex. */
export interface SkinWeights {
  readonly indices: Uint16Array;
  readonly weights: Float32Array;
  /** Full per-bone weights (vertex-major, `BONE_NAMES` order) kept for the corrective-joint influence. */
  readonly dense: Float32Array;
}

export interface SkinWeightOptions {
  /** Half-width of the blend around each joint, measured along the limb (meters). */
  readonly blendHalfWidth: number;
  /** Number of Laplacian smoothing passes over the mesh surface. */
  readonly smoothingPasses: number;
  /** How far each pass moves a vertex toward the mean of its neighbours. */
  readonly smoothingStrength: number;
}

export const DEFAULT_WEIGHT_OPTIONS: SkinWeightOptions = { blendHalfWidth: 0.07, smoothingPasses: 3, smoothingStrength: 0.5 };

const at = (array: ArrayLike<number>, index: number): number => array[index] ?? 0;
const smooth01 = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/**
 * Weights from the stroke each surface point belongs to. A point follows its stroke's bone, and within
 * `blendHalfWidth` of a joint it moves toward the bone across that joint, reaching an even 50/50 split exactly at the
 * joint. Smoothing over the surface then removes any step where different strokes meet (shoulders, hips).
 */
export function computeSkinWeights(mesh: SurfaceMesh, field: BodyField, options: SkinWeightOptions = DEFAULT_WEIGHT_OPTIONS): SkinWeights {
  const vertexCount = mesh.positions.length / 3;
  let dense: Float32Array<ArrayBuffer> = new Float32Array(vertexCount * BONE_COUNT);

  for (let v = 0; v < vertexCount; v++) {
    const x = at(mesh.positions, v * 3);
    const y = at(mesh.positions, v * 3 + 1);
    const z = at(mesh.positions, v * 3 + 2);
    const { index, t } = field.nearest(x, y, z);
    const primitive = field.primitives[index];
    if (!primitive) continue;
    const length = primitive.a.distanceTo(primitive.b);
    const along = t * length;
    const half = options.blendHalfWidth;
    const start = primitive.startNeighbor ? 0.5 * smooth01(1 - along / half) : 0;
    const end = primitive.endNeighbor ? 0.5 * smooth01(1 - (length - along) / half) : 0;
    const base = v * BONE_COUNT;
    dense[base + boneIndex(primitive.owner)] = 1 - start - end;
    if (primitive.startNeighbor) dense[base + boneIndex(primitive.startNeighbor)] = at(dense, base + boneIndex(primitive.startNeighbor)) + start;
    if (primitive.endNeighbor) dense[base + boneIndex(primitive.endNeighbor)] = at(dense, base + boneIndex(primitive.endNeighbor)) + end;
  }

  dense = smoothOverSurface(dense, mesh, options);

  const indices = new Uint16Array(vertexCount * MAX_INFLUENCES);
  const weights = new Float32Array(vertexCount * MAX_INFLUENCES);
  const order = Array.from({ length: BONE_COUNT }, (_, i) => i);
  for (let v = 0; v < vertexCount; v++) {
    const base = v * BONE_COUNT;
    order.sort((a, b) => at(dense, base + b) - at(dense, base + a));
    let total = 0;
    for (let slot = 0; slot < MAX_INFLUENCES; slot++) total += at(dense, base + (order[slot] ?? 0));
    for (let slot = 0; slot < MAX_INFLUENCES; slot++) {
      const bone = order[slot] ?? 0;
      indices[v * MAX_INFLUENCES + slot] = bone;
      weights[v * MAX_INFLUENCES + slot] = total > 0 ? at(dense, base + bone) / total : slot === 0 ? 1 : 0;
    }
  }
  return { indices, weights, dense: Float32Array.from(dense) };
}

function smoothOverSurface(dense: Float32Array<ArrayBuffer>, mesh: SurfaceMesh, options: SkinWeightOptions): Float32Array<ArrayBuffer> {
  const vertexCount = mesh.positions.length / 3;
  // Neighbour lists in compressed form.
  const degree = new Uint32Array(vertexCount + 1);
  const edgeKey = new Set<number>();
  const pairs: number[] = [];
  const addEdge = (a: number, b: number): void => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * vertexCount + hi;
    if (edgeKey.has(key)) return;
    edgeKey.add(key);
    pairs.push(a, b);
    degree[a + 1] = at(degree, a + 1) + 1;
    degree[b + 1] = at(degree, b + 1) + 1;
  };
  for (let f = 0; f < mesh.indices.length; f += 3) {
    const a = at(mesh.indices, f);
    const b = at(mesh.indices, f + 1);
    const c = at(mesh.indices, f + 2);
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  for (let v = 0; v < vertexCount; v++) degree[v + 1] = at(degree, v + 1) + at(degree, v);
  const fill = Uint32Array.from(degree);
  const neighbours = new Uint32Array(pairs.length);
  for (let p = 0; p < pairs.length; p += 2) {
    const a = at(pairs, p);
    const b = at(pairs, p + 1);
    neighbours[at(fill, a)] = b;
    fill[a] = at(fill, a) + 1;
    neighbours[at(fill, b)] = a;
    fill[b] = at(fill, b) + 1;
  }

  let current = dense;
  let next = new Float32Array(dense.length);
  const strength = options.smoothingStrength;
  for (let pass = 0; pass < options.smoothingPasses; pass++) {
    for (let v = 0; v < vertexCount; v++) {
      const first = at(degree, v);
      const last = at(degree, v + 1);
      const count = last - first;
      for (let bone = 0; bone < BONE_COUNT; bone++) {
        let sum = 0;
        for (let n = first; n < last; n++) sum += at(current, at(neighbours, n) * BONE_COUNT + bone);
        const own = at(current, v * BONE_COUNT + bone);
        next[v * BONE_COUNT + bone] = count > 0 ? own + (sum / count - own) * strength : own;
      }
    }
    [current, next] = [next, current];
  }
  return current;
}
