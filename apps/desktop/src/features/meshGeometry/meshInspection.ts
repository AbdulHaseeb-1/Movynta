import { Mesh, type Object3D } from "three";
import type { MeshInspection, MeshInspectionRequest } from "@movynta/editor-protocol";
import { readTopology, topology } from "./meshTopology";
import { modifierStack } from "./modifierStack";

export function isEditableTarget(node: Object3D | undefined): node is Mesh { return node instanceof Mesh; }
export function meshAtPath(root: Object3D | undefined, path: readonly number[]): Mesh {
  let node = root;
  for (const index of path) node = node?.children[index];
  if (!isEditableTarget(node)) throw new Error("Target is not a mesh; inspect the object and choose a meshPath from its parts");
  return node;
}

export function inspectMesh(root: Object3D | undefined, request: MeshInspectionRequest): MeshInspection {
  const result: MeshInspection = {
    objectId: request.objectId, meshPath: request.meshPath, status: "not_found", parts: [], partsTruncated: false,
    offset: request.offset, vertices: [], faces: [], edges: [],
  };
  if (!root) { result.message = "Object does not exist"; return result; }
  const pending = [{ node: root, path: [] as number[] }];
  while (pending.length > 0) {
    const entry = pending.pop(); if (!entry) continue;
    if (isEditableTarget(entry.node)) result.parts.push({ path: entry.path, name: entry.node.name.slice(0, 120) });
    if (result.parts.length >= 100) { result.partsTruncated = pending.length > 0 || entry.node.children.length > 0; break; }
    if (entry.path.length >= 32) { if (entry.node.children.length > 0) result.partsTruncated = true; continue; }
    for (let i = entry.node.children.length - 1; i >= 0; i -= 1) {
      const child = entry.node.children[i]; if (child) pending.push({ node: child, path: [...entry.path, i] });
    }
  }
  try {
    const target = meshAtPath(root, request.meshPath); const geometry = target.geometry;
    const stack = modifierStack(target); result.modifiers = stack?.modifiers ?? [];
    const base = stack?.base ?? geometry;
    result.baseTriangles = (base.index?.count ?? base.getAttribute("position")?.count ?? 0) / 3;
    result.skinned = "isSkinnedMesh" in target;
    result.morphTargets = (geometry.morphAttributes.position ?? []).map((attribute, i) => attribute.name || `target_${i}`);
    const mesh = readTopology(geometry); const graph = topology(mesh);
    const edges = [...graph.edges.values()];
    result.matrixWorld = target.matrixWorld.toArray();
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    result.localBounds = bounds && !bounds.isEmpty() ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null;
    result.edges = edges.slice(request.offset, request.offset + request.limit).map((incident) => {
      const half = incident[0];
      if (!half) throw new Error("Invalid empty edge");
      return { vertices: [half.from, half.to], faces: incident.map((edge) => edge.face) };
    });
    result.stats = {
      renderVertices: geometry.getAttribute("position")?.count ?? 0, vertices: mesh.positions.length,
      edges: graph.edges.size, faces: mesh.faces.length, triangles: (geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0) / 3,
      boundaryEdges: edges.filter((edge) => edge.length === 1).length,
      nonManifoldEdges: edges.filter((edge) => edge.length > 2).length,
      inconsistentEdges: edges.filter((edge) => edge.length === 2 && edge[0]?.from === edge[1]?.from).length,
      attributes: Object.keys(geometry.attributes).slice(0, 32), materialGroups: geometry.groups.length,
    };
    result.vertices = mesh.positions.slice(request.offset, request.offset + request.limit).map((p, i) => ({ index: request.offset + i, position: p.toArray() }));
    result.faces = mesh.faces.slice(request.offset, request.offset + request.limit).map((vertices, i) => ({ index: request.offset + i, vertices }));
    result.status = "ok";
  } catch (error) {
    result.status = "unsupported"; result.message = (error instanceof Error ? error.message : "Cannot inspect mesh").slice(0, 500);
  }
  return result;
}
