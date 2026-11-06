import {
  Vector2,
  Vector4,
  type Vector3,
  type Camera,
  type Matrix4,
} from "three";
import {
  edgeKey,
  point,
  topology,
  type PolygonMesh,
} from "@/features/meshGeometry/meshTopology";
import type { KnifePoint } from "@/features/meshGeometry/meshKnifeChord";
import type { KnifeSegment } from "@/features/meshGeometry/meshKnifeSession";

const graphs = new WeakMap<PolygonMesh, ReturnType<typeof topology>>();
export function knifeGraph(mesh: PolygonMesh): ReturnType<typeof topology> {
  let graph = graphs.get(mesh);
  if (!graph) {
    graph = topology(mesh);
    graphs.set(mesh, graph);
  }
  return graph;
}
export interface ProjectedVertex {
  screen: Vector2;
  w: number;
  local: Vector3;
}
export function projectKnife(
  mesh: PolygonMesh,
  matrix: Matrix4,
  camera: Camera,
  width: number,
  height: number,
): ProjectedVertex[] {
  camera.updateMatrixWorld();
  return mesh.positions.map((local) => {
    const p = new Vector4(local.x, local.y, local.z, 1)
      .applyMatrix4(matrix)
      .applyMatrix4(camera.matrixWorldInverse)
      .applyMatrix4(camera.projectionMatrix);
    return {
      local,
      w: p.w,
      screen: new Vector2(
        ((p.x / p.w + 1) * width) / 2,
        ((1 - p.y / p.w) * height) / 2,
      ),
    };
  });
}
function cross(a: Vector2, b: Vector2): number {
  return a.x * b.y - a.y * b.x;
}
/** Convert a projected edge fraction to the actual local-space fraction under perspective. */
export function perspectiveEdgeFactor(u: number, a: number, b: number): number {
  return (u * a) / ((1 - u) * b + u * a);
}
export function knifePointPosition(
  mesh: PolygonMesh,
  value: KnifePoint,
): Vector3 {
  if ("vertex" in value) return point(mesh, Number(value.vertex)).clone();
  const [a, b] = value.edge.split("_").map(Number);
  return point(mesh, a).clone().lerp(point(mesh, b), value.factor);
}
interface Crossing {
  along: number;
  endpoint: KnifePoint;
  screen: Vector2;
}
/** Boundary crossings in screen order. Collinear boundary runs are excluded. */
export function projectedKnifeSegments(
  mesh: PolygonMesh,
  projected: ProjectedVertex[],
  start: Vector2,
  end: Vector2,
): { segment: KnifeSegment; midpoint: Vector2 }[] {
  const direction = end.clone().sub(start),
    length = direction.length();
  if (length < 0.5) return [];
  const output: { segment: KnifeSegment; midpoint: Vector2 }[] = [];
  mesh.faces.forEach((face, faceId) => {
    const crossings: Crossing[] = [];
    for (let i = 0; i < face.length; i++) {
      const from = face[i],
        to = face[(i + 1) % face.length];
      if (from === undefined || to === undefined) continue;
      const a = projected[from],
        b = projected[to];
      if (!a || !b || a.w <= 0 || b.w <= 0) continue;
      const edge = b.screen.clone().sub(a.screen),
        delta = a.screen.clone().sub(start),
        divisor = cross(direction, edge);
      if (Math.abs(divisor) < 1e-9) continue;
      const t = cross(delta, edge) / divisor,
        u = cross(delta, direction) / divisor;
      if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) continue;
      const ratio = perspectiveEdgeFactor(
        Math.max(0, Math.min(1, u)),
        a.w,
        b.w,
      );
      const endpoint: KnifePoint =
        ratio <= 1e-8
          ? { vertex: String(from) }
          : ratio >= 1 - 1e-8
            ? { vertex: String(to) }
            : {
                edge: edgeKey(from, to),
                factor: from < to ? ratio : 1 - ratio,
              };
      if (crossings.some((entry) => Math.abs(entry.along - t) * length < 1e-5))
        continue;
      crossings.push({
        along: t,
        endpoint,
        screen: start.clone().addScaledVector(direction, t),
      });
    }
    crossings.sort((a, b) => a.along - b.along);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const a = crossings[i],
        b = crossings[i + 1];
      if (!a || !b || a.screen.distanceTo(b.screen) < 1e-5) continue;
      // A line already on a polygon boundary is not a new face split.
      if (
        "vertex" in a.endpoint &&
        "vertex" in b.endpoint &&
        topologyEdge(face, Number(a.endpoint.vertex), Number(b.endpoint.vertex))
      )
        continue;
      if (
        "edge" in a.endpoint &&
        "edge" in b.endpoint &&
        a.endpoint.edge === b.endpoint.edge
      )
        continue;
      output.push({
        segment: { face: faceId, start: a.endpoint, end: b.endpoint },
        midpoint: a.screen.clone().add(b.screen).multiplyScalar(0.5),
      });
    }
  });
  return output;
}
function topologyEdge(face: number[], a: number, b: number): boolean {
  return face.some(
    (v, i) =>
      v === a &&
      (face[(i + 1) % face.length] === b ||
        face[(i + face.length - 1) % face.length] === b),
  );
}
export function snapKnife(
  mesh: PolygonMesh,
  projected: ProjectedVertex[],
  cursor: Vector2,
  midpoint: boolean,
): Vector2 {
  let best = 12,
    result = cursor.clone();
  if (!midpoint)
    projected.forEach((vertex) => {
      const distance = vertex.screen.distanceTo(cursor);
      if (vertex.w > 0 && distance < best) {
        best = distance;
        result = vertex.screen.clone();
      }
    });
  if (best < 12) return result;
  for (const incident of knifeGraph(mesh).edges.values()) {
    const half = incident[0];
    if (!half) continue;
    const a = projected[half.from],
      b = projected[half.to];
    if (!a || !b || a.w <= 0 || b.w <= 0) continue;
    const delta = b.screen.clone().sub(a.screen);
    const u = midpoint
      ? b.w / (a.w + b.w)
      : Math.max(
          0,
          Math.min(
            1,
            cursor.clone().sub(a.screen).dot(delta) / (delta.lengthSq() || 1),
          ),
        );
    const target = a.screen.clone().addScaledVector(delta, u),
      distance = target.distanceTo(cursor);
    if (distance < best) {
      best = distance;
      result = target;
    }
  }
  return result;
}
