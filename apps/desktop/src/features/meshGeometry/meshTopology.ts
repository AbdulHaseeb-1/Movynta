import { InterleavedBufferAttribute, Vector3, type BufferAttribute, type BufferGeometry } from "three";
import { MAX_MESH_INPUT_TRIANGLES, MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import { basis, type Weights } from "./meshWeights";

export interface SurfaceChannels { positions: Weights[]; corners: Weights[][]; materials: number[] }
export interface PolygonMesh {
  positions: Vector3[];
  faces: number[][];
  channels?: SurfaceChannels;
  /** Base face index for each evaluated face. A generated face uses -1. */
  faceSources?: number[];
}

/** Confirms that a topology edit kept each named face in its original slot and at the same positions. */
export function retainsFaces(before: PolygonMesh, after: PolygonMesh, ids: readonly string[]): boolean {
  return ids.every((id) => {
    const face = Number(id);
    const previous = before.faces[face];
    const next = after.faces[face];
    return previous !== undefined && next !== undefined && previous.length === next.length &&
      previous.every((vertex, corner) => point(before, vertex).equals(point(after, next[corner])));
  });
}

/** Changes when the base geometry or its component numbering changes. */
export function cageKey(mesh: PolygonMesh): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  const bits = new DataView(new ArrayBuffer(8));
  const add = (value: number) => {
    first = Math.imul(first ^ value, 0x01000193);
    second = Math.imul(second ^ value, 0x85ebca6b) ^ (second >>> 13);
  };
  add(mesh.positions.length);
  for (const position of mesh.positions) {
    for (const coordinate of [position.x, position.y, position.z]) {
      bits.setFloat64(0, coordinate === 0 ? 0 : coordinate);
      add(bits.getUint32(0));
      add(bits.getUint32(4));
    }
  }
  add(mesh.faces.length);
  for (const face of mesh.faces) {
    add(face.length);
    for (const vertex of face) add(vertex);
  }
  return (first >>> 0).toString(16).padStart(8, "0") + (second >>> 0).toString(16).padStart(8, "0");
}
export function channels(mesh: PolygonMesh): SurfaceChannels {
  return mesh.channels ?? { positions: mesh.positions.map((_, index) => basis(index)), corners: mesh.faces.map((face) => face.map(basis)), materials: mesh.faces.map(() => 0) };
}
export interface HalfEdge { face: number; from: number; to: number }
export interface Topology { edges: Map<string, HalfEdge[]>; vertexFaces: number[][]; vertexEdges: string[][] }
interface CachedTopology {
  mesh: PolygonMesh;
  positions: BufferAttribute | InterleavedBufferAttribute;
  index: BufferAttribute | null;
  positionVersion: number;
  indexVersion: number;
  /** Position, index, skin, morph and every other attribute. A later edit must miss. */
  signature: string;
}
const savedTopology = new WeakMap<BufferGeometry, CachedTopology>();
export function copyTopology(source: BufferGeometry, target: BufferGeometry, materialOverride?: number): void {
  const cached = currentTopology(source);
  if (cached) rememberTopology(target, materialOverride === undefined ? cached : {
    ...cached, channels: { ...channels(cached), materials: cached.faces.map(() => materialOverride) },
  });
}
function positionVersion(attribute: BufferAttribute | InterleavedBufferAttribute): number {
  return attribute instanceof InterleavedBufferAttribute ? attribute.data.version : attribute.version;
}
function geometrySignature(geometry: BufferGeometry): string {
  const parts: string[] = [];
  for (const [name, attribute] of Object.entries(geometry.attributes))
    parts.push(`${name}:${positionVersion(attribute)}:${attribute.count}:${attribute.itemSize}`);
  for (const [name, targets] of Object.entries(geometry.morphAttributes))
    for (const target of targets ?? []) parts.push(`morph:${name}:${target.name}:${positionVersion(target)}:${target.count}:${target.itemSize}`);
  return parts.join("|");
}
function currentTopology(geometry: BufferGeometry): PolygonMesh | undefined {
  const cached = savedTopology.get(geometry);
  if (!cached || cached.positions !== geometry.getAttribute("position") || cached.index !== geometry.index ||
    cached.positionVersion !== positionVersion(cached.positions) ||
    cached.indexVersion !== (geometry.index?.version ?? 0) || cached.signature !== geometrySignature(geometry)) {
    return undefined;
  }
  return cached.mesh;
}
export function rememberTopology(geometry: BufferGeometry, mesh: PolygonMesh): void {
  const positions = geometry.getAttribute("position");
  if (positions) savedTopology.set(geometry, { mesh, positions, index: geometry.index,
    positionVersion: positionVersion(positions), indexVersion: geometry.index?.version ?? 0, signature: geometrySignature(geometry) });
}
export function edgeKey(a: number, b: number): string { return a < b ? `${a}_${b}` : `${b}_${a}`; }
export function point(mesh: PolygonMesh, index: number | undefined): Vector3 {
  const value = index === undefined ? undefined : mesh.positions[index];
  if (!value) throw new Error("Mesh contains an invalid vertex reference");
  return value;
}
/** Newell area vector, with length twice the projected area. */
export function faceAreaNormal(mesh: PolygonMesh, face: readonly number[]): Vector3 {
  const normal = new Vector3();
  for (let i = 0; i < face.length; i += 1) {
    const a = point(mesh, face[i]); const b = point(mesh, face[(i + 1) % face.length]);
    normal.x += (a.y - b.y) * (a.z + b.z);
    normal.y += (a.z - b.z) * (a.x + b.x);
    normal.z += (a.x - b.x) * (a.y + b.y);
  }
  return normal;
}
export function faceNormal(mesh: PolygonMesh, face: readonly number[]): Vector3 {
  return faceAreaNormal(mesh, face).normalize();
}
export function topology(mesh: PolygonMesh): Topology {
  const edges = new Map<string, HalfEdge[]>();
  const vertexFaces = mesh.positions.map((): number[] => []);
  const vertexEdges = mesh.positions.map((): string[] => []);
  mesh.faces.forEach((face, faceIndex) => {
    for (let i = 0; i < face.length; i += 1) {
      const from = face[i]; const to = face[(i + 1) % face.length];
      if (from === undefined || to === undefined) throw new Error("Invalid mesh face");
      vertexFaces[from]?.push(faceIndex);
      const key = edgeKey(from, to);
      const incident = edges.get(key);
      if (incident) incident.push({ face: faceIndex, from, to });
      else {
        edges.set(key, [{ face: faceIndex, from, to }]);
        vertexEdges[from]?.push(key); vertexEdges[to]?.push(key);
      }
    }
  });
  return { edges, vertexFaces, vertexEdges };
}
export function assertManifold(mesh: PolygonMesh, graph: Topology, closed = false): void {
  for (const incident of graph.edges.values()) {
    if (incident.length > 2 || (closed && incident.length !== 2)) throw new Error(closed ? "Operation requires a closed manifold surface" : "Operation requires manifold geometry");
    const [a, b] = incident;
    if (a && b && a.from === b.from) throw new Error("Mesh has inconsistent face winding");
  }
  // Check connected face fans as well as edges: two shells touching at one vertex are non-manifold.
  graph.vertexFaces.forEach((faces, vertex) => {
    const adjacency = new Map(faces.map((face) => [face, new Set<number>()]));
    let boundaries = 0;
    for (const key of graph.vertexEdges[vertex] ?? []) {
      const incident = graph.edges.get(key) ?? [];
      if (incident.length === 1) boundaries += 1;
      const [a, b] = incident;
      if (a && b) { adjacency.get(a.face)?.add(b.face); adjacency.get(b.face)?.add(a.face); }
    }
    const visited = new Set<number>(); const pending = faces.slice(0, 1);
    while (pending.length > 0) {
      const face = pending.pop(); if (face === undefined || visited.has(face)) continue;
      visited.add(face); for (const next of adjacency.get(face) ?? []) pending.push(next);
    }
    if (visited.size !== faces.length || (boundaries !== 0 && boundaries !== 2)) throw new Error("Mesh has a non-manifold vertex");
  });
  if (mesh.faces.length === 0) throw new Error("Mesh has no faces");
}

const CONTINUITY_SKIP = new Set(["position", "normal", "tangent", "skinIndex", "skinWeight"]);
export type ContinuityChannel = BufferAttribute | InterleavedBufferAttribute;

/** Attributes that must stay continuous for two triangles to become one polygon, and for a subdivision chart to stay smooth. */
export function continuityChannels(geometry: BufferGeometry): ContinuityChannel[] {
  const result: ContinuityChannel[] = [];
  for (const [name, attribute] of Object.entries(geometry.attributes)) if (!CONTINUITY_SKIP.has(name)) result.push(attribute);
  for (const [name, targets] of Object.entries(geometry.morphAttributes)) {
    if (name === "position" || name === "normal") continue;
    for (const target of targets ?? []) result.push(target);
  }
  return result;
}

/** Weld position seams and dissolve connected coplanar triangles into polygon control faces. */
export function readTopology(geometry: BufferGeometry, solidVertexIds?: Uint32Array): PolygonMesh {
  const attribute = geometry.getAttribute("position");
  if (!attribute || attribute.itemSize !== 3) throw new Error("Mesh needs three-dimensional positions");
  const saved = solidVertexIds ? undefined : currentTopology(geometry);
  if (saved) return saved;
  const count = geometry.index?.count ?? attribute.count;
  const maximum = solidVertexIds ? MAX_MESH_OUTPUT_TRIANGLES : MAX_MESH_INPUT_TRIANGLES;
  if (count % 3 !== 0 || count / 3 > maximum) throw new Error(`Mesh inspection/modification supports at most ${maximum} input triangles`);
  const positions: Vector3[] = []; const sources: number[] = []; const deformKeys: string[] = [];
  const buckets = new Map<string, number[]>(); const remap = new Map<number, number>();
  const solidVertices = new Map<number, number>();
  geometry.computeBoundingBox();
  const size = geometry.boundingBox?.getSize(new Vector3()).length() ?? 1;
  const epsilon = Math.max(size * 1e-7, 1e-10);
  const cell = (value: number) => Math.floor(value / epsilon);
  const deformationKey = (index: number): string => {
    const deformation: number[] = [];
    for (const name of ["skinIndex", "skinWeight"]) {
      const data = geometry.getAttribute(name);
      if (data) for (let c = 0; c < data.itemSize; c += 1) deformation.push(data.getComponent(index, c));
    }
    for (const target of geometry.morphAttributes.position ?? []) for (let c = 0; c < target.itemSize; c += 1) deformation.push(target.getComponent(index, c));
    return deformation.join(",");
  };
  const vertex = (index: number): number => {
    const known = remap.get(index); if (known !== undefined) return known;
    if (index < 0 || index >= attribute.count) throw new Error("Mesh index is outside its position buffer");
    const p = new Vector3().fromBufferAttribute(attribute, index);
    if (![p.x, p.y, p.z].every(Number.isFinite)) throw new Error("Mesh positions must be finite");
    if (solidVertexIds) {
      const canonical = solidVertexIds[index];
      if (canonical === undefined) throw new Error("Invalid Boolean seam");
      let id = solidVertices.get(canonical);
      if (id === undefined) {
        id = positions.length;
        solidVertices.set(canonical, id);
        positions.push(p);
        sources.push(index);
      }
      remap.set(index, id);
      return id;
    }
    const deform = deformationKey(index);
    const cx = cell(p.x); const cy = cell(p.y); const cz = cell(p.z);
    const limit = epsilon * epsilon;
    let id: number | undefined;
    for (let dx = -1; dx <= 1 && id === undefined; dx += 1) for (let dy = -1; dy <= 1 && id === undefined; dy += 1) for (let dz = -1; dz <= 1 && id === undefined; dz += 1) {
      for (const candidate of buckets.get(`${cx + dx}_${cy + dy}_${cz + dz}`) ?? []) {
        const existing = positions[candidate];
        if (!existing || deformKeys[candidate] !== deform || existing.distanceToSquared(p) > limit) continue;
        id = candidate; break;
      }
    }
    if (id === undefined) {
      id = positions.length; positions.push(p); sources.push(index); deformKeys.push(deform);
      const key = `${cx}_${cy}_${cz}`; const list = buckets.get(key);
      if (list) list.push(id); else buckets.set(key, [id]);
    }
    remap.set(index, id); return id;
  };
  const groupMaterials = new Map<number, number>();
  for (const group of geometry.groups) {
    if (group.start % 3 !== 0 || group.count % 3 !== 0) throw new Error("Material groups must align with triangles");
    for (let i = group.start; i < Math.min(count, group.start + group.count); i += 3) groupMaterials.set(i, group.materialIndex ?? 0);
  }
  const triangles: number[][] = [];
  const samples: number[][] = []; const materials: number[] = [];
  for (let i = 0; i < count; i += 3) {
    const raw = [0, 1, 2].map((n) => geometry.index?.getX(i + n) ?? i + n);
    const face = raw.map(vertex);
    if (new Set(face).size !== 3) continue; // Common sphere poles contain collapsed triangles.
    const [a, b, c] = face.map((id) => positions[id]);
    if (!a || !b || !c || b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() <= (solidVertexIds ? 0 : epsilon ** 4)) continue;
    triangles.push(face);
    samples.push(raw); materials.push(groupMaterials.get(i) ?? 0);
  }
  const mesh = { positions, faces: triangles }; const graph = topology(mesh);
  const normals = triangles.map((face) => faceNormal(mesh, face));
  const neighbors = triangles.map((): number[] => []);
  const continuity = continuityChannels(geometry);
  const componentsMatch = (channel: ContinuityChannel, left: number, right: number): boolean => {
    for (let c = 0; c < channel.itemSize; c += 1) if (Math.abs(channel.getComponent(left, c) - channel.getComponent(right, c)) > 1e-6) return false;
    return true;
  };
  for (const incident of graph.edges.values()) {
    const [a, b] = incident;
    if (incident.length !== 2 || !a || !b || a.from === b.from) continue;
    const na = normals[a.face]; const nb = normals[b.face];
    const sameSamples = (vertexId: number): boolean => {
      const fa = triangles[a.face] ?? []; const fb = triangles[b.face] ?? [];
      const ia = samples[a.face]?.[fa.indexOf(vertexId)]; const ib = samples[b.face]?.[fb.indexOf(vertexId)];
      if (ia === undefined || ib === undefined) return false;
      return continuity.every((channel) => componentsMatch(channel, ia, ib));
    };
    const affineChannels = (): boolean => {
      const source = samples[a.face]; const other = samples[b.face]; if (!source || !other) return false;
      const [ia, ib, ic] = source; if (ia === undefined || ib === undefined || ic === undefined) return false;
      const p = new Vector3().fromBufferAttribute(attribute, ia); const u = new Vector3().fromBufferAttribute(attribute, ib).sub(p); const v = new Vector3().fromBufferAttribute(attribute, ic).sub(p);
      const uu = u.dot(u); const vv = v.dot(v); const uv = u.dot(v); const determinant = uu * vv - uv * uv;
      if (determinant <= 0) return false;
      for (const id of other) {
        const delta = new Vector3().fromBufferAttribute(attribute, id).sub(p);
        const x = (delta.dot(u) * vv - delta.dot(v) * uv) / determinant; const y = (delta.dot(v) * uu - delta.dot(u) * uv) / determinant;
        for (const channel of continuity) for (let c = 0; c < channel.itemSize; c += 1) {
          const expected = (1 - x - y) * channel.getComponent(ia, c) + x * channel.getComponent(ib, c) + y * channel.getComponent(ic, c);
          if (Math.abs(channel.getComponent(id, c) - expected) > 1e-6) return false;
        }
      }
      return true;
    };
    if (materials[a.face] === materials[b.face] && sameSamples(a.from) && sameSamples(a.to) && na && nb && na.dot(nb) > 1 - 1e-10 && affineChannels()) { neighbors[a.face]?.push(b.face); neighbors[b.face]?.push(a.face); }
  }
  const visited = new Set<number>(); const faces: number[][] = [];
  const faceSamples: Weights[][] = []; const faceMaterials: number[] = [];
  const addFace = (face: number[], component: readonly number[]): void => {
    const lookup = new Map<number, number>();
    for (const index of component) (triangles[index] ?? []).forEach((id, corner) => { const raw = samples[index]?.[corner]; if (raw !== undefined) lookup.set(id, raw); });
    faces.push(face); faceSamples.push(face.map((id) => basis(lookup.get(id) ?? sources[id] ?? 0))); faceMaterials.push(materials[component[0] ?? 0] ?? 0);
  };
  triangles.forEach((triangle, seed) => {
    if (visited.has(seed)) return;
    const component = new Set<number>(); const pending = [seed];
    while (pending.length > 0) {
      const current = pending.pop(); if (current === undefined || visited.has(current)) continue;
      visited.add(current); component.add(current);
      for (const next of neighbors[current] ?? []) pending.push(next);
    }
    if (component.size === 1) { addFace(triangle, [seed]); return; }
    const boundary = new Map<number, number>(); let valid = true;
    for (const index of component) {
      const face = triangles[index] ?? [];
      for (let i = 0; i < face.length; i += 1) {
        const from = face[i]; const to = face[(i + 1) % face.length];
        if (from === undefined || to === undefined) continue;
        const incident = graph.edges.get(edgeKey(from, to)) ?? [];
        if (incident.some((edge) => edge.face !== index && component.has(edge.face))) continue;
        if (boundary.has(from)) valid = false;
        boundary.set(from, to);
      }
    }
    const polygon: number[] = []; const walked = new Set<number>(); const start = boundary.keys().next().value;
    let current = start;
    while (current !== undefined && !walked.has(current)) { polygon.push(current); walked.add(current); current = boundary.get(current); }
    if (valid && current === start && polygon.length === boundary.size && polygon.length <= 256) addFace(polygon, [...component]);
    else for (const index of component) { const face = triangles[index]; if (face) addFace(face, [index]); }
  });
  // Dissolving planar triangles leaves unused interior vertices (for example cylinder-cap centers).
  const compact: Vector3[] = []; const used = new Map<number, number>();
  const compactFaces = faces.map((face) => face.map((id) => {
    let next = used.get(id);
    if (next === undefined) { next = compact.length; compact.push(point(mesh, id)); used.set(id, next); }
    return next;
  }));
  const positionWeights: Weights[] = [];
  for (const [original, index] of used) positionWeights[index] = basis(sources[original] ?? 0);
  const result = { positions: compact, faces: compactFaces, channels: { positions: positionWeights, corners: faceSamples, materials: faceMaterials } };
  rememberTopology(geometry, result);
  return result;
}
