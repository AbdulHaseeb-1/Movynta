import { Mesh, Vector3, type Object3D } from "three";
import {
  resolveMeshPath,
  stableMeshPath,
  stableSteps,
  type MeshInspection,
  type MeshInspectionRequest,
  type MeshPath,
  type MeshStep,
} from "@movynta/editor-protocol";
import { cageKey, faceNormal, readTopology, topology, type PolygonMesh, type Topology } from "./meshTopology";
import { modifierStack } from "./modifierStack";
import { boundaryLoops, shellSummaries } from "./meshRegions";
import { inspectMaterials, materialSlots } from "../materials/materialEdits";
const inspectionGraphs = new WeakMap<PolygonMesh, Topology>();
const inspectionNormals = new WeakMap<PolygonMesh, Vector3[]>();
const inspectionRegions = new WeakMap<
  PolygonMesh,
  { loops: ReturnType<typeof boundaryLoops>; shells: ReturnType<typeof shellSummaries> }
>();

/** Whether a scene node is a mesh that the design tools can edit. */
export function isEditableTarget(node: Object3D | undefined): node is Mesh {
  return node instanceof Mesh;
}
/** The mesh a path leads to, whether it is written with part names or with child indices. */
export function meshAtPath(root: Object3D | undefined, path: MeshPath): Mesh {
  const node = resolveMeshPath(root, path);
  if (!isEditableTarget(node))
    throw new Error("Target is not a mesh; inspect the object and choose a meshPath from its parts");
  return node;
}

/** The path to `node` inside `root`, by part names where parts have them, or undefined when it is not inside `root`. */
export function meshPathOf(root: Object3D, node: Object3D): MeshStep[] | undefined {
  const indexes: number[] = [];
  for (let current: Object3D = node; current !== root;) {
    const parent: Object3D | null = current.parent;
    if (!parent) return undefined;
    indexes.unshift(parent.children.indexOf(current));
    current = parent;
  }
  return stableMeshPath(root, indexes);
}

/** Reads a mesh's topology and samples for the assistant's inspection, one page at a time. */
export function inspectMesh(root: Object3D | undefined, request: MeshInspectionRequest): MeshInspection {
  const result: MeshInspection = {
    objectId: request.objectId,
    meshPath: request.meshPath,
    view: request.view ?? "evaluated",
    status: "not_found",
    parts: [],
    partsTruncated: false,
    offset: request.offset,
    vertices: [],
    faces: [],
    edges: [],
  };
  if (!root) {
    result.message = "Object does not exist";
    return result;
  }
  // Paths are given by part name where a part has one, so they keep meaning the same part when others are added or reordered.
  const pending = [{ node: root, path: [] as MeshStep[] }];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    if (isEditableTarget(entry.node)) result.parts.push({ path: entry.path, name: entry.node.name.slice(0, 120) });
    if (result.parts.length >= 100) {
      result.partsTruncated = pending.length > 0 || entry.node.children.length > 0;
      break;
    }
    if (entry.path.length >= 32) {
      if (entry.node.children.length > 0) result.partsTruncated = true;
      continue;
    }
    const steps = stableSteps(entry.node);
    for (let i = entry.node.children.length - 1; i >= 0; i -= 1) {
      const child = entry.node.children[i];
      const step = steps[i];
      if (child && step !== undefined) pending.push({ node: child, path: [...entry.path, step] });
    }
  }
  try {
    const target = meshAtPath(root, request.meshPath);
    result.materials = inspectMaterials(target, request.offset, request.limit);
    result.materialSlotCount = materialSlots(target).length;
    if (request.materialsOnly) {
      result.status = "ok";
      return result;
    }
    const stack = modifierStack(target);
    result.modifiers = stack?.modifiers ?? [];
    const base = stack?.base ?? target.geometry;
    const geometry = request.view === "base" ? base : target.geometry;
    result.baseTriangles = (base.index?.count ?? base.getAttribute("position")?.count ?? 0) / 3;
    result.skinned = "isSkinnedMesh" in target;
    result.morphTargets = (geometry.morphAttributes.position ?? []).map(
      (attribute, i) => attribute.name || `target_${i}`,
    );
    const mesh = readTopology(geometry);
    let graph = inspectionGraphs.get(mesh);
    if (!graph) {
      graph = topology(mesh);
      inspectionGraphs.set(mesh, graph);
    }
    if (request.view === "base") result.baseKey = cageKey(mesh);
    const edges = [...graph.edges.values()];
    result.matrixWorld = target.matrixWorld.toArray();
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    result.localBounds = bounds && !bounds.isEmpty() ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null;
    result.edges = (
      request.includeSamples === false ? [] : edges.slice(request.offset, request.offset + request.limit)
    ).map((incident) => {
      const half = incident[0];
      if (!half) throw new Error("Invalid empty edge");
      return { vertices: [half.from, half.to], faces: incident.map((edge) => edge.face) };
    });
    result.stats = {
      renderVertices: geometry.getAttribute("position")?.count ?? 0,
      vertices: mesh.positions.length,
      edges: graph.edges.size,
      faces: mesh.faces.length,
      triangles: (geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0) / 3,
      boundaryEdges: edges.filter((edge) => edge.length === 1).length,
      nonManifoldEdges: edges.filter((edge) => edge.length > 2).length,
      inconsistentEdges: edges.filter((edge) => edge.length === 2 && edge[0]?.from === edge[1]?.from).length,
      attributes: Object.keys(geometry.attributes).slice(0, 32),
      materialGroups: geometry.groups.length,
      materialSlots: Array.isArray(target.material) ? target.material.length : 1,
    };
    result.vertices = (
      request.includeSamples === false ? [] : mesh.positions.slice(request.offset, request.offset + request.limit)
    ).map((p, i) => ({ index: request.offset + i, position: p.toArray() }));
    result.faces = (
      request.includeSamples === false ? [] : mesh.faces.slice(request.offset, request.offset + request.limit)
    ).map((vertices, i) => {
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
          if (
            center
              .toArray()
              .some(
                (value, axis) =>
                  value < (query.centerMin?.[axis] ?? -Infinity) || value > (query.centerMax?.[axis] ?? Infinity),
              )
          )
            return;
        }
        if (total >= offset && ids.length < limit) ids.push(String(index));
        total += 1;
      });
      result.faceMatches = { ids, total, offset, hasMore: offset + ids.length < total };
    }
    if (request.openings || request.shells) {
      // Both walks are made once per cage: an assistant often asks for them on every look at the same mesh.
      let regions = inspectionRegions.get(mesh);
      if (!regions) {
        regions = { loops: boundaryLoops(graph), shells: shellSummaries(mesh, graph) };
        inspectionRegions.set(mesh, regions);
      }
      if (request.openings) {
        const offset = request.openings.offset ?? 0,
          limit = request.openings.limit ?? 20,
          all = regions.loops.loops;
        result.openings = {
          loops: all.slice(offset, offset + limit).map((loop) => {
            const min = new Vector3(Infinity, Infinity, Infinity),
              max = new Vector3(-Infinity, -Infinity, -Infinity);
            for (const vertex of loop.vertices) {
              const p = mesh.positions[vertex];
              if (p) {
                min.min(p);
                max.max(p);
              }
            }
            return {
              edges: loop.edges.slice(0, 256),
              edgeCount: loop.edges.length,
              truncated: loop.edges.length > 256,
              center: min.clone().add(max).multiplyScalar(0.5).toArray(),
              min: min.toArray(),
              max: max.toArray(),
            };
          }),
          total: all.length,
          offset,
          hasMore: offset + limit < all.length,
          irregularEdges: regions.loops.irregular,
        };
      }
      if (request.shells) {
        const offset = request.shells.offset ?? 0,
          limit = request.shells.limit ?? 20,
          all = regions.shells;
        result.shells = {
          shells: all.slice(offset, offset + limit),
          total: all.length,
          offset,
          hasMore: offset + limit < all.length,
        };
      }
    }
    result.status = "ok";
  } catch (error) {
    result.status = "unsupported";
    result.message = (error instanceof Error ? error.message : "Cannot inspect mesh").slice(0, 500);
  }
  return result;
}
