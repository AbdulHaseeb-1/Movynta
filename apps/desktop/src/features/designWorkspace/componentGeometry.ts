import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector2,
  type Camera,
  type Matrix4,
} from "three";
import {
  readTopology,
  edgeKey,
  type PolygonMesh,
} from "@/features/meshGeometry/meshTopology";
import { triangulate } from "@/features/meshGeometry/meshOutput";
import type { ComponentKind } from "./workspaceSlice";

export interface ComponentGeometry {
  mesh: PolygonMesh;
  picking: BufferGeometry;
  triangleFaces: number[];
  /** Each face's contiguous triangle range in the picking geometry. */
  faceTriangleOffsets: Uint32Array;
  edges: Map<string, [number, number]>;
}
interface PreparedComponents {
  positions: Float32Array;
  triangleFaces: number[];
  faceTriangleOffsets: Uint32Array;
  edges: Map<string, [number, number]>;
}
// readTopology returns a new mesh when the source position or index version changes.
// Weak keys keep cached arrays alive only while their source topology remains reachable.
const preparedComponents = new WeakMap<PolygonMesh, PreparedComponents>();
/** Collect the picking triangles for selected polygon faces. */
export function faceHighlightPositions(
  data: ComponentGeometry,
  ids: readonly string[],
): number[] {
  const positions: number[] = [];
  const attr = data.picking.getAttribute("position");
  for (const id of ids) {
    const face = Number(id);
    if (!Number.isInteger(face) || face < 0 || face >= data.mesh.faces.length)
      continue;
    const start = data.faceTriangleOffsets[face] ?? 0;
    const end = data.faceTriangleOffsets[face + 1] ?? start;
    for (let vertex = start * 3; vertex < end * 3; vertex++)
      positions.push(attr.getX(vertex), attr.getY(vertex), attr.getZ(vertex));
  }
  return positions;
}
/** Reuse the modifier topology reader, so a cube face is a quad rather than two triangles. */
export function componentGeometry(source: BufferGeometry): ComponentGeometry {
  const mesh = readTopology(source);
  let prepared = preparedComponents.get(mesh);
  if (!prepared) {
    const positions: number[] = [];
    const triangleFaces: number[] = [];
    const faceTriangleOffsets = new Uint32Array(mesh.faces.length + 1);
    const edges = new Map<string, [number, number]>();
    mesh.faces.forEach((face, faceId) => {
      faceTriangleOffsets[faceId] = triangleFaces.length;
      for (const triangle of triangulate(mesh, face)) {
        for (const corner of triangle) {
          const id = face[corner];
          const point = id === undefined ? undefined : mesh.positions[id];
          if (!point) throw new Error("Invalid face");
          positions.push(point.x, point.y, point.z);
        }
        triangleFaces.push(faceId);
      }
      face.forEach((a, i) => {
        const b = face[(i + 1) % face.length];
        if (b !== undefined) edges.set(edgeKey(a, b), [a, b]);
      });
    });
    faceTriangleOffsets[mesh.faces.length] = triangleFaces.length;
    prepared = {
      positions: new Float32Array(positions),
      triangleFaces,
      faceTriangleOffsets,
      edges,
    };
    preparedComponents.set(mesh, prepared);
  }
  const picking = new BufferGeometry();
  // Each picking geometry owns its attribute, so disposing one cannot affect another.
  picking.setAttribute(
    "position",
    new Float32BufferAttribute(prepared.positions, 3),
  );
  picking.computeBoundingSphere();
  return {
    mesh,
    picking,
    triangleFaces: prepared.triangleFaces,
    faceTriangleOffsets: prepared.faceTriangleOffsets,
    edges: prepared.edges,
  };
}
export function pickComponent(
  data: ComponentGeometry,
  triangle: number,
  kind: ComponentKind,
  cursor: Vector2,
  matrix: Matrix4,
  camera: Camera,
  width: number,
  height: number,
): string | undefined {
  const faceId = data.triangleFaces[triangle];
  const face = faceId === undefined ? undefined : data.mesh.faces[faceId];
  if (!face) return undefined;
  if (kind === "face") return String(faceId);
  const pixels = (id: number) => {
    const p = data.mesh.positions[id]
      ?.clone()
      .applyMatrix4(matrix)
      .project(camera);
    return p
      ? new Vector2((p.x * width) / 2, (p.y * height) / 2)
      : new Vector2(Infinity, Infinity);
  };
  const point = new Vector2((cursor.x * width) / 2, (cursor.y * height) / 2);
  let best = 12;
  let result: string | undefined;
  face.forEach((id, index) => {
    const a = pixels(id);
    const next = face[(index + 1) % face.length];
    if (next === undefined) return;
    const b = pixels(next);
    const delta = b.clone().sub(a);
    const nearest =
      kind === "vertex"
        ? a
        : a
            .clone()
            .addScaledVector(
              delta,
              Math.max(
                0,
                Math.min(
                  1,
                  point.clone().sub(a).dot(delta) / (delta.lengthSq() || 1),
                ),
              ),
            );
    const distance = nearest.distanceTo(point);
    if (distance < best) {
      best = distance;
      result = kind === "vertex" ? String(id) : edgeKey(id, next);
    }
  });
  return result;
}
