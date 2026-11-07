import type { BufferGeometry } from "three";
import { writeGeometry, type CornerUvPatch } from "./meshOutput";
import { faceAreaNormal, readTopology, rememberTopology, type PolygonMesh } from "./meshTopology";

/** How a mesh part is shaded. `angle` (degrees) makes smooth shading keep edges sharper than it. */
export interface ShadingChoice {
  mode: "flat" | "smooth";
  angle?: number;
}

/**
 * Write a cage with the shading asked for: flat gives every face its own normal; smooth blends them at shared
 * corners; smooth with an angle blends only across edges whose faces bend less than the angle (Blender's
 * "shade smooth by angle"), so a cylinder is round around its side but crisp at its caps.
 */
export function shadeGeometry(
  source: BufferGeometry,
  mesh: PolygonMesh,
  choice: ShadingChoice,
  patchUv?: CornerUvPatch,
): BufferGeometry {
  if (choice.mode === "flat") return writeGeometry(source, mesh, true, undefined, patchUv);
  const geometry = writeGeometry(source, mesh, false, undefined, patchUv);
  // Plain smooth is smooth across every edge. The write's own blend weights by triangle, which favours the corners a quad's diagonal touches.
  assignCornerNormals(geometry, mesh, choice.angle ?? 180);
  return geometry;
}

/**
 * Give every face corner the area-weighted normal of the faces around its vertex that connect to it through edges
 * that are not sharp. A per-vertex flag cannot say this: a vertex on a sharp rim also belongs to smooth side faces.
 * The smooth write emits one render vertex per face corner in face order, so corner (face, c) is `first[face] + c`.
 */
function assignCornerNormals(geometry: BufferGeometry, mesh: PolygonMesh, angleDegrees: number): void {
  const normals = geometry.getAttribute("normal");
  if (!normals) return;
  // The write recorded this cage for the geometry. Changing the buffers below makes that record stale, and without
  // it the next edit would rebuild the cage from triangles and could number its faces differently.
  const cage = readTopology(geometry);
  const limit = Math.cos((angleDegrees * Math.PI) / 180);
  const first: number[] = [];
  let total = 0;
  for (const face of mesh.faces) {
    first.push(total);
    total += face.length;
  }
  const weighted = mesh.faces.map((face) => faceAreaNormal(mesh, face));
  const unit = weighted.map((vector) => {
    const length = vector.length();
    return length > 0 ? vector.clone().divideScalar(length) : vector.clone();
  });
  const parent = Int32Array.from({ length: total }, (_, index) => index);
  const find = (corner: number): number => {
    let root = corner;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    for (let walk = corner; walk !== root;) {
      const next = parent[walk] ?? root;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const join = (a: number, b: number) => {
    const x = find(a),
      y = find(b);
    if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
  };
  const count = mesh.positions.length,
    seen = new Map<number, { face: number; corner: number }>();
  mesh.faces.forEach((face, index) =>
    face.forEach((from, corner) => {
      const to = face[(corner + 1) % face.length] ?? from,
        key = from < to ? from * count + to : to * count + from;
      const other = seen.get(key);
      if (!other) {
        seen.set(key, { face: index, corner });
        return;
      }
      const neighbour = mesh.faces[other.face] ?? [];
      const here = unit[index],
        there = unit[other.face];
      if (!here || !there || here.dot(there) < limit) return; // a sharp edge keeps its two sides apart
      // The neighbour runs the shared edge the other way: its corner `other.corner` is at `to`, the next one at `from`.
      join((first[index] ?? 0) + corner, (first[other.face] ?? 0) + ((other.corner + 1) % neighbour.length));
      join((first[index] ?? 0) + ((corner + 1) % face.length), (first[other.face] ?? 0) + other.corner);
    }),
  );
  const sums = new Map<number, [number, number, number]>();
  mesh.faces.forEach((face, index) =>
    face.forEach((_, corner) => {
      const root = find((first[index] ?? 0) + corner),
        vector = weighted[index];
      if (!vector) return;
      const sum = sums.get(root) ?? [0, 0, 0];
      sum[0] += vector.x;
      sum[1] += vector.y;
      sum[2] += vector.z;
      sums.set(root, sum);
    }),
  );
  for (let corner = 0; corner < total; corner += 1) {
    const sum = sums.get(find(corner));
    const length = sum ? Math.hypot(sum[0], sum[1], sum[2]) : 0;
    if (sum && length > 1e-12) normals.setXYZ(corner, sum[0] / length, sum[1] / length, sum[2] / length);
  }
  if (geometry.getAttribute("tangent") && geometry.getAttribute("uv")) geometry.computeTangents();
  rememberTopology(geometry, cage);
}
