import type { Vector3 } from "three";
import type { ExtrudeResult } from "./meshExtrude";
import { channels, type PolygonMesh } from "./meshTopology";
import { topologyResult } from "./meshTopologyEdit";
import type { Weights } from "./meshWeights";

/** What is deleted: faces, edges or vertices. */
export type DeleteKind = "face" | "edge" | "vertex";
/** The result of a delete operation. */
export interface DeleteResult extends ExtrudeResult {
  removedFaces: number;
  removedVertices: number;
}

const INTEGER = /^(0|[1-9]\d{0,9})$/;
const EDGE = /^(0|[1-9]\d{0,9})_(0|[1-9]\d{0,9})$/;

/**
 * Delete faces, like Blender's X menu. A face goes alone; an edge or vertex takes every face that touches it,
 * because a polygon cage cannot keep a face with a missing edge or corner. Vertices no face uses any more are
 * dropped. Surviving faces keep their order and so do surviving vertices, which makes the new numbering predictable:
 * each ID drops by the number of removed entries before it. Opening a closed mesh is the point, so it is allowed;
 * faces that would then touch only at a vertex are refused.
 */
export function deleteComponents(mesh: PolygonMesh, kind: DeleteKind, ids: readonly string[]): DeleteResult {
  const doomed = new Set<number>();
  if (kind === "face") {
    for (const id of ids) {
      if (!INTEGER.test(id) || !mesh.faces[Number(id)])
        throw new Error(`Face ${id} does not exist; inspect the base cage for current face IDs`);
      doomed.add(Number(id));
    }
  } else if (kind === "vertex") {
    const wanted = new Set<number>();
    for (const id of ids) {
      if (!INTEGER.test(id) || Number(id) >= mesh.positions.length)
        throw new Error(`Vertex ${id} does not exist; inspect the base cage for current vertex IDs`);
      wanted.add(Number(id));
    }
    mesh.faces.forEach((face, index) => {
      if (face.some((vertex) => wanted.has(vertex))) doomed.add(index);
    });
  } else {
    const count = mesh.positions.length;
    const wanted = new Map<number, string>();
    for (const id of ids) {
      const match = EDGE.exec(id);
      if (!match || Number(match[1]) >= Number(match[2]) || Number(match[2]) >= count)
        throw new Error(`Edge ${id} is not a canonical smaller_larger edge ID of this mesh`);
      wanted.set(Number(match[1]) * count + Number(match[2]), id);
    }
    const found = new Set<number>();
    mesh.faces.forEach((face, index) =>
      face.forEach((from, corner) => {
        const to = face[(corner + 1) % face.length] ?? from;
        const key = from < to ? from * count + to : to * count + from;
        if (wanted.has(key)) {
          found.add(key);
          doomed.add(index);
        }
      }),
    );
    for (const [key, id] of wanted)
      if (!found.has(key)) throw new Error(`Edge ${id} does not exist; inspect the base cage for current edge IDs`);
  }
  if (doomed.size === 0) throw new Error("Nothing to delete: the selection touches no faces");
  if (doomed.size === mesh.faces.length)
    throw new Error(
      "Deleting these components would remove every face; delete the object with scene.delete_object instead",
    );
  const data = channels(mesh);
  const used = new Uint8Array(mesh.positions.length);
  const faces: number[][] = [],
    corners: Weights[][] = [],
    materials: number[] = [];
  mesh.faces.forEach((face, index) => {
    if (doomed.has(index)) return;
    for (const vertex of face) used[vertex] = 1;
    faces.push(face);
    corners.push(data.corners[index] ?? []);
    materials.push(data.materials[index] ?? 0);
  });
  const remap = new Int32Array(mesh.positions.length).fill(-1);
  const positions: Vector3[] = [],
    weights: Weights[] = [];
  for (let vertex = 0; vertex < mesh.positions.length; vertex += 1) {
    if (!used[vertex]) continue;
    remap[vertex] = positions.length;
    const position = mesh.positions[vertex];
    if (position) positions.push(position);
    weights.push(data.positions[vertex] ?? new Map());
  }
  const mapped = faces.map((face) => face.map((vertex) => remap[vertex] ?? -1));
  // The new rim: edges that now have one face and were shared with a deleted face.
  const count = positions.length,
    keyOf = (a: number, b: number) => (a < b ? a * count + b : b * count + a);
  const edgeCount = new Map<number, number>();
  for (const face of mapped)
    face.forEach((from, corner) => {
      const key = keyOf(from, face[(corner + 1) % face.length] ?? from);
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    });
  const rim = new Set<number>();
  for (const index of doomed) {
    const face = mesh.faces[index] ?? [];
    face.forEach((from, corner) => {
      const a = remap[from] ?? -1,
        b = remap[face[(corner + 1) % face.length] ?? -1] ?? -1;
      if (a < 0 || b < 0) return;
      const key = keyOf(a, b);
      if (edgeCount.get(key) === 1) rim.add(key);
    });
  }
  const selection = [...rim].map((key) => `${Math.floor(key / count)}_${key % count}`);
  const result: PolygonMesh = { positions, faces: mapped, channels: { positions: weights, corners, materials } };
  return {
    ...topologyResult(mesh, result, selection, { allowOpening: true }),
    removedFaces: doomed.size,
    removedVertices: mesh.positions.length - positions.length,
  };
}
