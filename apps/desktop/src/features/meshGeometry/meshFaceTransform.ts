import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { ExtrudeResult } from "./meshExtrude";
import { faceAreaNormal, point, type PolygonMesh } from "./meshTopology";

export interface FaceTransform {
  position?: readonly number[] | undefined;
  rotation?: readonly number[] | undefined;
  scale?: readonly number[] | undefined;
}

export function faceTransformSelection(mesh: PolygonMesh, ids: readonly string[]) {
  const vertices = new Set<number>();
  for (const id of ids) {
    const face = mesh.faces[Number(id)];
    if (!face) throw new Error(`Unknown face ${id}`);
    for (const vertex of face) vertices.add(vertex);
  }
  if (!vertices.size) throw new Error("Select faces to transform");
  const pivot = new Vector3();
  for (const vertex of vertices) pivot.add(point(mesh, vertex));
  return { vertices, pivot: pivot.divideScalar(vertices.size) };
}

/** Move shared vertices around the selection centroid while preserving face and edge IDs. */
export function transformFaces(
  mesh: PolygonMesh,
  ids: readonly string[],
  transform: FaceTransform,
  localToSpace = new Matrix4(),
  selected = faceTransformSelection(mesh, ids),
): ExtrudeResult {
  const { vertices, pivot } = selected;
  const inverse = localToSpace.clone().invert();
  if (!inverse.determinant()) throw new Error("The mesh transform is singular");
  const origin = pivot.clone().applyMatrix4(localToSpace);
  const rotation = new Quaternion().setFromEuler(new Euler(
    transform.rotation?.[0] ?? 0, transform.rotation?.[1] ?? 0, transform.rotation?.[2] ?? 0,
  ));
  const position = new Vector3().fromArray(transform.position ?? [0, 0, 0]);
  const scale = new Vector3().fromArray(transform.scale ?? [1, 1, 1]);
  const positions = mesh.positions.slice();
  for (const vertex of vertices) {
    const next = point(mesh, vertex).clone().applyMatrix4(localToSpace).sub(origin)
      .multiply(scale).applyQuaternion(rotation).add(origin).add(position).applyMatrix4(inverse);
    if (!next.toArray().every(Number.isFinite)) throw new Error("Face transform exceeds the coordinate range");
    positions[vertex] = next;
  }
  const result = { ...mesh, positions };
  for (const face of mesh.faces) {
    if (face.some((vertex) => vertices.has(vertex)) && faceAreaNormal(result, face).lengthSq() < 1e-20) {
      throw new Error("Face transform collapses an adjoining face");
    }
  }
  return { mesh: result, selection: [...ids], walls: [] };
}
