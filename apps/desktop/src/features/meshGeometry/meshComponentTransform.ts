import { Matrix4, Vector3 } from "three";
import { transformFaces, type FaceTransform } from "./meshFaceTransform";
import { point, topology, type PolygonMesh } from "./meshTopology";

/** Resolve welded base vertices once; vertices shared by selected edges move exactly once. */
export function componentTransformSelection(mesh: PolygonMesh, kind: "vertex" | "edge", ids: readonly string[]) {
  if (!ids.length || ids.length > 4096 || new Set(ids).size !== ids.length) throw new Error("Select 1–4096 unique components");
  const vertices = new Set<number>();
  const edges = kind === "edge" ? topology(mesh).edges : undefined;
  for (const id of ids) {
    if (kind === "vertex") {
      if (!/^(0|[1-9]\d{0,9})$/.test(id) || !mesh.positions[Number(id)]) throw new Error(`Unknown vertex ${id}`);
      vertices.add(Number(id));
    } else {
      const match = /^(0|[1-9]\d{0,9})_(0|[1-9]\d{0,9})$/.exec(id);
      if (!match || Number(match[1]) >= Number(match[2]) || !edges?.has(id)) throw new Error(`Unknown canonical edge ${id}`);
      vertices.add(Number(match[1])); vertices.add(Number(match[2]));
    }
  }
  const pivot = new Vector3();
  for (const vertex of vertices) pivot.add(point(mesh, vertex));
  return { vertices, pivot: pivot.divideScalar(vertices.size) };
}

/** Reuse the face transform's attribute-preserving rewrite and adjoining-face collapse checks. */
export function transformComponents(mesh: PolygonMesh, kind: "vertex" | "edge", ids: readonly string[],
  transform: FaceTransform, localToSpace = new Matrix4(), pivot?: readonly number[]) {
  return transformFaces(mesh, ids, transform, localToSpace, componentTransformSelection(mesh, kind, ids),
    pivot ? new Vector3().fromArray(pivot) : undefined);
}
