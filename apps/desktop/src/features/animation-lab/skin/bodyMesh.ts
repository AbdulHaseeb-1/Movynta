import { BONE_NAMES, type CharacterConfig } from "@/engine/character/types";
import { buildBodyPrimitives, createBindPose, type BindPose, type BodyPrimitive } from "./bodyPrimitives";
import { computeJointInfluence } from "./jointCorrectives";
import { computeSkinWeights, DEFAULT_WEIGHT_OPTIONS, type SkinWeightOptions } from "./skinWeights";
import { BodyField } from "./signedDistance";
import { meshBodySurface } from "./surfaceNets";

/** Everything needed to build the skinned geometry, as plain typed arrays (no GPU or DOM involved). */
export interface BodyMeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly skinIndices: Uint16Array;
  readonly skinWeights: Float32Array;
  /** Per vertex: corrective joint index (or -1) and influence. */
  readonly jointInfluence: Float32Array;
  readonly primitives: readonly BodyPrimitive[];
  readonly bindPose: BindPose;
}

export interface BodyMeshOptions {
  /** Edge length of the meshing grid (meters). Smaller is smoother and heavier. */
  readonly cellSize: number;
  /** Width over which neighbouring strokes are filleted into each other (meters). */
  readonly joinSmoothing: number;
  readonly weights: SkinWeightOptions;
}

export const DEFAULT_BODY_MESH_OPTIONS: BodyMeshOptions = { cellSize: 0.011, joinSmoothing: 0.02, weights: DEFAULT_WEIGHT_OPTIONS };

/** Meshes the stickman once in its bind pose and computes its skin weights. Deterministic; takes a few hundred ms. */
export function buildBodyMeshData(config: CharacterConfig, options: BodyMeshOptions = DEFAULT_BODY_MESH_OPTIONS): BodyMeshData {
  const bindPose = createBindPose(config);
  const primitives = buildBodyPrimitives(config, bindPose);
  const field = new BodyField(primitives, options.joinSmoothing);
  const surface = meshBodySurface(field, options.cellSize);
  const skin = computeSkinWeights(surface, field, options.weights);
  const vertexCount = surface.positions.length / 3;
  return {
    positions: surface.positions,
    normals: surface.normals,
    indices: surface.indices,
    skinIndices: skin.indices,
    skinWeights: skin.weights,
    jointInfluence: computeJointInfluence(skin.dense, vertexCount, BONE_NAMES.length),
    primitives,
    bindPose,
  };
}

const cache = new WeakMap<CharacterConfig, BodyMeshData>();

/** Same as `buildBodyMeshData` with default options, reused for the same config (React strict mode, lab reloads). */
export function cachedBodyMeshData(config: CharacterConfig): BodyMeshData {
  const cached = cache.get(config);
  if (cached) return cached;
  const data = buildBodyMeshData(config);
  cache.set(config, data);
  return data;
}
