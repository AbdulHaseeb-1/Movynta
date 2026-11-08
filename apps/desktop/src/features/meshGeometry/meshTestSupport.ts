import { triangulate } from "./meshOutput";
import type { PolygonMesh } from "./meshTopology";

/** Total surface area and enclosed volume of a cage, from its triangulation. */
export function measureSurface(mesh: PolygonMesh): { area: number; volume: number } {
  let area = 0,
    volume = 0;
  for (const face of mesh.faces) {
    for (const triangle of triangulate(mesh, face)) {
      const [a, b, c] = triangle.map((corner) => mesh.positions[face[corner] ?? -1]);
      if (!a || !b || !c) throw new Error("bad triangle");
      area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      volume += a.dot(b.clone().cross(c)) / 6;
    }
  }
  return { area, volume };
}
