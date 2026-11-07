import { channels, point, topology, type PolygonMesh } from "./meshTopology";
import { componentTransformSelection } from "./meshComponentTransform";
import { topologyResult } from "./meshTopologyEdit";

export interface SlideRail {
  vertex: string;
  toward: string;
}
/** Move every selected edge endpoint along an explicitly identified adjacent edge. */
export function slideEdges(mesh: PolygonMesh, ids: readonly string[], rails: readonly SlideRail[], factor: number) {
  if (!(factor > 0 && factor < 1)) throw new Error("Slide factor must be between 0 and 1, excluding endpoints");
  const { vertices } = componentTransformSelection(mesh, "edge", ids),
    graph = topology(mesh);
  if (rails.length !== vertices.size) throw new Error("Provide one rail for each unique selected vertex");
  const seen = new Set<number>(),
    positions = mesh.positions.slice();
  for (const rail of rails) {
    if (![rail.vertex, rail.toward].every((id) => /^(0|[1-9]\d{0,9})$/.test(id)))
      throw new Error("Rails require canonical vertex IDs");
    const vertex = Number(rail.vertex),
      toward = Number(rail.toward);
    const edge = vertex < toward ? `${vertex}_${toward}` : `${toward}_${vertex}`;
    if (!vertices.has(vertex) || vertices.has(toward) || seen.has(vertex) || !graph.edges.has(edge))
      throw new Error("Each rail must connect a selected vertex to an unselected adjacent vertex");
    seen.add(vertex);
    positions[vertex] = point(mesh, vertex).clone().lerp(point(mesh, toward), factor);
  }
  return topologyResult(mesh, { ...mesh, positions, channels: channels(mesh) }, [...ids]);
}
