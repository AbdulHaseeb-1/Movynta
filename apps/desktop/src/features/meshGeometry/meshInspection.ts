import { Mesh, Vector3, type Object3D } from "three";
import type { MeshInspection, MeshInspectionRequest } from "@movynta/editor-protocol";
import { cageKey, faceNormal, readTopology, topology, type PolygonMesh, type Topology } from "./meshTopology";
import { modifierStack } from "./modifierStack";
const inspectionGraphs = new WeakMap<PolygonMesh, Topology>();
const inspectionNormals = new WeakMap<PolygonMesh, Vector3[]>();

export function isEditableTarget(node: Object3D | undefined): node is Mesh { return node instanceof Mesh; }
export function meshAtPath(root: Object3D | undefined, path: readonly number[]): Mesh {
  let node = root;
  for (const index of path) node = node?.children[index];
  if (!isEditableTarget(node)) throw new Error("Target is not a mesh; inspect the object and choose a meshPath from its parts");
  return node;
}

export function inspectMesh(root: Object3D | undefined, request: MeshInspectionRequest): MeshInspection {
  const result: MeshInspection = {
    objectId: request.objectId, meshPath: request.meshPath, view: request.view ?? "evaluated", status: "not_found", parts: [], partsTruncated: false,
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
    const target = meshAtPath(root, request.meshPath);
    const stack = modifierStack(target); result.modifiers = stack?.modifiers ?? [];
    const base = stack?.base ?? target.geometry;
    const geometry = request.view === "base" ? base : target.geometry;
    result.baseTriangles = (base.index?.count ?? base.getAttribute("position")?.count ?? 0) / 3;
    result.skinned = "isSkinnedMesh" in target;
    result.morphTargets = (geometry.morphAttributes.position ?? []).map((attribute, i) => attribute.name || `target_${i}`);
    const mesh = readTopology(geometry);
    let graph = inspectionGraphs.get(mesh);
    if (!graph) { graph = topology(mesh); inspectionGraphs.set(mesh, graph); }
    if (request.view === "base") result.baseKey = cageKey(mesh);
    const edges = [...graph.edges.values()];
    result.matrixWorld = target.matrixWorld.toArray();
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    result.localBounds = bounds && !bounds.isEmpty() ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null;
    result.edges = (request.includeSamples === false ? [] : edges.slice(request.offset, request.offset + request.limit)).map((incident) => {
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
      materialSlots: Array.isArray(target.material) ? target.material.length : 1,
    };
    result.vertices = (request.includeSamples === false ? [] : mesh.positions.slice(request.offset, request.offset + request.limit)).map((p, i) => ({ index: request.offset + i, position: p.toArray() }));
    result.faces = (request.includeSamples === false ? [] : mesh.faces.slice(request.offset, request.offset + request.limit)).map((vertices, i) => {
      const index = request.offset + i;
      const source = geometry === base ? undefined : mesh.faceSources?.[index];
      return { index, vertices, ...(source !== undefined && source >= 0 ? { baseFaceIndex: source } : {}) };
    });
    if (request.faceQuery) {
      const query = request.faceQuery;
      const direction = query.normal ? new Vector3().fromArray(query.normal).normalize() : null;
      let normals = direction ? inspectionNormals.get(mesh) : undefined;
      if (direction && !normals) {
        normals = mesh.faces.map((face) => faceNormal(mesh, face));
        inspectionNormals.set(mesh, normals);
      }
      const center = new Vector3();
      const ids: string[] = [];
      let total = 0;
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 100;
      mesh.faces.forEach((face, index) => {
        if (direction && (normals?.[index]?.dot(direction) ?? -1) < (query.minDot ?? 0.9)) return;
        if (query.centerMin || query.centerMax) {
          center.set(0, 0, 0);
          for (const vertex of face) {
            const position = mesh.positions[vertex];
            if (position) center.add(position);
          }
          center.divideScalar(face.length);
          if (center.toArray().some((value, axis) => value < (query.centerMin?.[axis] ?? -Infinity) || value > (query.centerMax?.[axis] ?? Infinity))) return;
        }
        if (total >= offset && ids.length < limit) ids.push(String(index));
        total += 1;
      });
      result.faceMatches = { ids, total, offset, hasMore: offset + ids.length < total };
    }
    result.status = "ok";
  } catch (error) {
    result.status = "unsupported"; result.message = (error instanceof Error ? error.message : "Cannot inspect mesh").slice(0, 500);
  }
  return result;
}
