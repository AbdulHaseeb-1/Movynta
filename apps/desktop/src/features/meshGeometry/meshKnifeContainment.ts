import { Vector2, type Vector3 } from "three";
import { faceNormal, point, type PolygonMesh } from "./meshTopology";

/** A cut must stay inside its planar face without touching another boundary in between. */
export function validateKnifeChord(
  mesh: PolygonMesh,
  face: number[],
  a: Vector3,
  b: Vector3,
): void {
  const normal = faceNormal(mesh, face);
  const axis =
    Math.abs(normal.x) > Math.abs(normal.y)
      ? Math.abs(normal.x) > Math.abs(normal.z)
        ? 0
        : 2
      : Math.abs(normal.y) > Math.abs(normal.z)
        ? 1
        : 2;
  const project = (p: Vector3) =>
    axis === 0
      ? new Vector2(p.y, p.z)
      : axis === 1
        ? new Vector2(p.x, p.z)
        : new Vector2(p.x, p.y);
  const start = project(a),
    end = project(b),
    direction = end.clone().sub(start);
  const cross = (u: Vector2, v: Vector2) => u.x * v.y - u.y * v.x;
  const polygon = face.map((id) => project(point(mesh, id)));
  let inside = false;
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  for (let i = 0; i < polygon.length; i++) {
    const from = polygon[i],
      to = polygon[(i + 1) % polygon.length];
    if (!from || !to) throw new Error("Invalid face boundary");
    const edge = to.clone().sub(from),
      delta = from.clone().sub(start),
      denominator = cross(direction, edge);
    if (Math.abs(denominator) > 1e-12 * direction.length() * edge.length()) {
      const t = cross(delta, edge) / denominator,
        u = cross(delta, direction) / denominator;
      if (t > 1e-7 && t < 1 - 1e-7 && u >= -1e-7 && u <= 1 + 1e-7)
        throw new Error("Knife cut crosses or touches another face boundary");
    }
    if (
      from.y > midpoint.y !== to.y > midpoint.y &&
      midpoint.x <
        ((to.x - from.x) * (midpoint.y - from.y)) / (to.y - from.y) + from.x
    )
      inside = !inside;
  }
  if (!inside) throw new Error("Knife cut must stay inside the face boundary");
}
