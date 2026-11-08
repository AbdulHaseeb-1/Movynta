import { edgeKey, topology, type PolygonMesh } from "@/features/meshGeometry/meshTopology";
import type { ComponentKind } from "./workspaceSlice";

/** Convert through the vertices represented by the source selection. */
export function convertComponentSelection(
  mesh: PolygonMesh,
  from: ComponentKind,
  to: ComponentKind,
  ids: readonly string[],
): string[] {
  if (from === to) return [...ids];
  const vertices = new Set<number>();
  for (const id of ids) {
    if (from === "vertex") vertices.add(Number(id));
    else if (from === "edge") id.split("_").forEach((vertex) => vertices.add(Number(vertex)));
    else for (const vertex of mesh.faces[Number(id)] ?? []) vertices.add(vertex);
  }
  if (to === "vertex") return [...vertices].filter((id) => mesh.positions[id] !== undefined).map(String);
  if (to === "edge")
    return [...topology(mesh).edges.values()].flatMap((incident) => {
      const edge = incident[0];
      return edge && vertices.has(edge.from) && vertices.has(edge.to) ? [edgeKey(edge.from, edge.to)] : [];
    });
  return mesh.faces.flatMap((face, id) => (face.every((vertex) => vertices.has(vertex)) ? [String(id)] : []));
}
