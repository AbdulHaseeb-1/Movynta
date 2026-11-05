import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import type { ExtrudeResult } from "./meshExtrude";
import { triangulate } from "./meshOutput";
import { assertManifold, faceAreaNormal, topology, type PolygonMesh } from "./meshTopology";

export function requireIds(ids: readonly string[], minimum = 1): void {
  if (ids.length < minimum || ids.length > 4096 || new Set(ids).size !== ids.length) throw new Error(`Select ${minimum}–4096 unique components`);
}

/** Validate the complete candidate before the editor stages any resource changes. */
export function validateTopologyEdit(before: PolygonMesh, after: PolygonMesh): void {
  const graph = topology(before); assertManifold(before, graph);
  const closed = [...graph.edges.values()].every((edges) => edges.length === 2);
  assertManifold(after, topology(after), closed);
  if (after.faces.reduce((sum, face) => sum + face.length - 2, 0) > MAX_MESH_OUTPUT_TRIANGLES) throw new Error("Topology edit exceeds the geometry output budget");
  const faceKeys = new Set<string>();
  for (const face of after.faces) {
    const key = face.slice().sort((a, b) => a - b).join(",");
    if (faceKeys.has(key)) throw new Error("Topology edit creates coincident faces");
    faceKeys.add(key);
    if (face.length < 3 || new Set(face).size !== face.length || faceAreaNormal(after, face).lengthSq() < 1e-20 || triangulate(after, face).length !== face.length - 2) {
      throw new Error("Topology edit creates a collapsed, repeated or untriangulatable face");
    }
    for (let i = 0; i < face.length; i += 1) {
      const a = after.positions[face[i] ?? -1], b = after.positions[face[(i + 1) % face.length] ?? -1];
      if (!a || !b || !a.toArray().every(Number.isFinite) || a.toArray().every((value, axis) => Math.fround(value) === Math.fround(b.getComponent(axis)))) {
        throw new Error("Topology edit collapses an edge at Float32 precision");
      }
    }
  }
}

export function topologyResult(before: PolygonMesh, after: PolygonMesh, selection: string[]): ExtrudeResult {
  validateTopologyEdit(before, after);
  return { mesh: after, selection, walls: [] };
}
