import { channels, type PolygonMesh } from "../meshGeometry/meshTopology";
import type { ExtrudeResult } from "../meshGeometry/meshExtrude";
import { parseFaces } from "../meshGeometry/meshExtrude";

export function assignMaterial(mesh: PolygonMesh, ids: readonly string[] | undefined, slot: number): ExtrudeResult {
  const selected = ids ? parseFaces(mesh, ids) : mesh.faces.map((_, i) => i);
  const data = channels(mesh), materials = data.materials.slice();
  for (const face of selected) materials[face] = slot;
  return { mesh: { ...mesh, channels: { ...data, materials } }, selection: selected.map(String), walls: [] };
}
