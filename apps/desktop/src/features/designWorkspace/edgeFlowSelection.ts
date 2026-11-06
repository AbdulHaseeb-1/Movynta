import { edgeKey, topology, type PolygonMesh } from "@/features/meshGeometry/meshTopology";

/** Follow quad topology; stop at boundaries, poles, non-quads and non-manifold edges. */
export function selectEdgeFlow(mesh: PolygonMesh, seeds: readonly string[], mode: "loop" | "ring"): string[] {
  const graph = topology(mesh);
  const selected = new Set(seeds.filter((id) => graph.edges.has(id)));
  const queue = [...selected];
  const add = (id: string) => { if (!selected.has(id)) { selected.add(id); queue.push(id); } };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const edge = queue[cursor];
    if (!edge) continue;
    const sides = graph.edges.get(edge) ?? [];
    if (sides.length > 2) continue;
    if (mode === "ring") {
      for (const side of sides) {
        const face = mesh.faces[side.face];
        if (!face || face.length !== 4) continue;
        const index = face.findIndex((vertex, i) => edgeKey(vertex, face[(i + 1) % face.length] ?? -1) === edge);
        const a = face[(index + 2) % 4], b = face[(index + 3) % 4];
        if (index >= 0 && a !== undefined && b !== undefined) add(edgeKey(a, b));
      }
    } else {
      const first = sides[0];
      if (!first) continue;
      for (const vertex of [first.from, first.to]) {
        const incident = graph.vertexEdges[vertex] ?? [];
        const faces = graph.vertexFaces[vertex] ?? [];
        if (incident.length !== 4 || faces.length !== 4 || faces.some((id) => mesh.faces[id]?.length !== 4)) continue;
        const adjacentFaces = new Set(sides.map((side) => side.face));
        const opposite = incident.filter((candidate) => candidate !== edge && !(graph.edges.get(candidate) ?? []).some((side) => adjacentFaces.has(side.face)));
        if (opposite.length === 1 && opposite[0] !== undefined && (graph.edges.get(opposite[0])?.length ?? 0) === 2) add(opposite[0]);
      }
    }
  }
  return [...selected];
}
