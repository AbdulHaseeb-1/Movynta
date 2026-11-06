import { topology, type PolygonMesh } from "@/features/meshGeometry/meshTopology";

const cache = new WeakMap<PolygonMesh, { boundary: string[]; nonManifold: string[]; inconsistent: string[] }>();

/** Classify edges in the same welded topology used by component selection. */
export function meshEdgeDiagnostics(mesh: PolygonMesh) {
  const cached = cache.get(mesh);
  if (cached) return cached;
  const boundary: string[] = [];
  const nonManifold: string[] = [];
  const inconsistent: string[] = [];
  for (const [id, incident] of topology(mesh).edges) {
    if (incident.length === 1) boundary.push(id);
    else if (incident.length > 2) nonManifold.push(id);
    else if (incident.length === 2 && incident[0]?.from === incident[1]?.from) inconsistent.push(id);
  }
  const result = { boundary, nonManifold, inconsistent };
  cache.set(mesh, result);
  return result;
}
