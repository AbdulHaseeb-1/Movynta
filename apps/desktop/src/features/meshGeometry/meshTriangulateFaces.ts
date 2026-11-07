import type { ExtrudeResult } from "./meshExtrude";
import { triangulate } from "./meshOutput";
import { channels, type PolygonMesh } from "./meshTopology";
import { topologyResult } from "./meshTopologyEdit";
import type { Weights } from "./meshWeights";

export interface TriangulateResult extends ExtrudeResult {
  triangulatedFaces: number;
}

/**
 * Split polygons with more than three corners into triangles (Blender's Ctrl+T). Each triangle keeps the corner
 * attributes and material of its polygon, and the winding. Triangles replace their polygon in place, so faces
 * before it keep their IDs. Triangles are always planar, which makes this the way to prepare a bent quad for the knife.
 * With no `ids` every polygon is split.
 */
export function triangulateFaces(mesh: PolygonMesh, ids?: readonly string[]): TriangulateResult {
  const chosen = new Set<number>();
  if (ids === undefined) mesh.faces.forEach((_, index) => chosen.add(index));
  else
    for (const id of ids) {
      if (!/^(0|[1-9]\d{0,9})$/.test(id) || !mesh.faces[Number(id)])
        throw new Error(`Face ${id} does not exist; inspect the base cage for current face IDs`);
      chosen.add(Number(id));
    }
  const data = channels(mesh);
  const faces: number[][] = [],
    corners: Weights[][] = [],
    materials: number[] = [];
  let split = 0;
  mesh.faces.forEach((face, index) => {
    const samples = data.corners[index] ?? [],
      material = data.materials[index] ?? 0;
    if (!chosen.has(index) || face.length === 3) {
      faces.push(face);
      corners.push(samples);
      materials.push(material);
      return;
    }
    const triangles = triangulate(mesh, face);
    if (triangles.length !== face.length - 2)
      throw new Error(
        `Face ${index} is bent or self-intersecting and cannot be triangulated cleanly; move its vertices or delete it`,
      );
    split += 1;
    for (const triangle of triangles) {
      faces.push(triangle.map((corner) => face[corner] ?? -1));
      corners.push(triangle.map((corner) => samples[corner] ?? new Map()));
      materials.push(material);
    }
  });
  if (split === 0) throw new Error("Nothing to triangulate: every selected face is already a triangle");
  const result: PolygonMesh = {
    positions: mesh.positions,
    faces,
    channels: { positions: data.positions, corners, materials },
  };
  return { ...topologyResult(mesh, result, []), triangulatedFaces: split };
}
