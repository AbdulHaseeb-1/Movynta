import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import type { ExtrudeResult } from "./meshExtrude";
import { checkManifold } from "./meshManifold";
import { triangulate } from "./meshOutput";
import type { Vector3 } from "three";
import type { PolygonMesh } from "./meshTopology";

export function requireIds(ids: readonly string[], minimum = 1): void {
  if (ids.length < minimum || ids.length > 4096 || new Set(ids).size !== ids.length) throw new Error(`Select ${minimum}–4096 unique components`);
}

/**
 * Meshes whose every face passed the geometry checks, recorded as a face list together with the vertex positions it
 * was checked against, so a later edit can skip the faces it did not touch. Both halves must match: the same faces
 * on moved vertices are a different surface.
 */
const faceChecked = new WeakMap<readonly (readonly number[])[], WeakSet<readonly Vector3[]>>();

export interface TopologyEditOptions {
  /** The edit may open a closed mesh (delete, or a cut that keeps one side). Otherwise a closed mesh must stay closed. */
  allowOpening?: boolean;
}

/** An order-independent hash of a face's vertices, so coincident faces meet without building a string per face. */
function faceHash(face: readonly number[]): number {
  let sum = 0, mix = 0;
  for (const vertex of face) {
    const scrambled = Math.imul(vertex + 1, 0x9e3779b1);
    sum = (sum + scrambled) | 0;
    mix = (mix ^ Math.imul(scrambled ^ (scrambled >>> 15), 0x85ebca6b)) | 0;
  }
  return (sum >>> 0) * 2097152 + (mix >>> 11);
}
function sameVertices(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.slice().sort((x, y) => x - y), right = b.slice().sort((x, y) => x - y);
  return left.every((vertex, index) => vertex === right[index]);
}

/** Validate the complete candidate before the editor stages any resource changes. */
export function validateTopologyEdit(before: PolygonMesh, after: PolygonMesh, options: TopologyEditOptions = {}): void {
  const { closed } = checkManifold(before);
  if (after !== before) checkManifold(after, closed && options.allowOpening !== true);
  let triangles = 0;
  for (const face of after.faces) triangles += face.length - 2;
  if (triangles > MAX_MESH_OUTPUT_TRIANGLES) throw new Error("Topology edit exceeds the geometry output budget");
  const seen = new Map<number, number | number[]>();
  const positions = after.positions;
  // A face of the base that is unchanged, with every vertex where it was, passed these checks already.
  const trusted = after !== before && faceChecked.get(before.faces)?.has(before.positions) ? new Set<readonly number[]>(before.faces) : undefined;
  for (let index = 0; index < after.faces.length; index += 1) {
    const face = after.faces[index] ?? [];
    const hash = faceHash(face);
    const previous = seen.get(hash);
    if (previous === undefined) seen.set(hash, index);
    else {
      const candidates = typeof previous === "number" ? [previous] : previous;
      if (candidates.some((other) => sameVertices(after.faces[other] ?? [], face))) throw new Error("Topology edit creates coincident faces");
      seen.set(hash, [...candidates, index]);
    }
    if (trusted?.has(face) && face.every((vertex) => positions[vertex] === before.positions[vertex])) continue;
    if (face.length < 3 || new Set(face).size !== face.length) throw new Error("Topology edit creates a collapsed, repeated or untriangulatable face");
    // Newell area vector, inline: this runs for every face of every topology edit.
    let nx = 0, ny = 0, nz = 0, collapsed = false;
    for (let i = 0; i < face.length; i += 1) {
      const a = positions[face[i] ?? -1], b = positions[face[(i + 1) % face.length] ?? -1];
      if (!a || !b) throw new Error("Mesh contains an invalid vertex reference");
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
      if (!Number.isFinite(a.x + a.y + a.z) || (Math.fround(a.x) === Math.fround(b.x) && Math.fround(a.y) === Math.fround(b.y) && Math.fround(a.z) === Math.fround(b.z))) collapsed = true;
    }
    if (nx * nx + ny * ny + nz * nz < 1e-20 || (face.length > 3 && triangulate(after, face).length !== face.length - 2)) {
      throw new Error("Topology edit creates a collapsed, repeated or untriangulatable face");
    }
    if (collapsed) throw new Error("Topology edit collapses an edge at Float32 precision");
  }
  const checkedWith = faceChecked.get(after.faces) ?? new WeakSet<readonly Vector3[]>();
  checkedWith.add(after.positions);
  faceChecked.set(after.faces, checkedWith);
}

export function topologyResult(before: PolygonMesh, after: PolygonMesh, selection: string[], options: TopologyEditOptions = {}): ExtrudeResult {
  validateTopologyEdit(before, after, options);
  return { mesh: after, selection, walls: [] };
}
