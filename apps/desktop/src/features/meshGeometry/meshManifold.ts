import type { PolygonMesh } from "./meshTopology";

/**
 * Face lists that already passed, mapped to whether they are closed. Keyed by the list, not the mesh object: an edit
 * that is stored for the next one is wrapped in a new object but keeps its list. Face lists are never edited in place,
 * and connectivity does not depend on where the vertices are, so the answer holds for any positions.
 */
const verified = new WeakMap<readonly (readonly number[])[], { closed: boolean; vertices: number }>();

export interface ManifoldReport { closed: boolean }

/**
 * Checks that every edge has one or two faces wound consistently, and that the faces around every vertex form one
 * fan. Same rules and messages as `assertManifold`, but numeric edge keys and flat arrays: a validation of a
 * 20,000-face cage is a few milliseconds instead of a few hundred. A passing mesh is remembered, so the candidate
 * of one edit is not checked again when it becomes the base of the next.
 */
export function checkManifold(mesh: PolygonMesh, requireClosed = false): ManifoldReport {
  const known = verified.get(mesh.faces);
  // A shorter vertex list could leave a face pointing past its end, which only a full pass notices.
  if (known !== undefined && mesh.positions.length >= known.vertices) {
    if (requireClosed && !known.closed) throw new Error("Operation requires a closed manifold surface");
    return { closed: known.closed };
  }
  const { faces } = mesh;
  const vertexCount = mesh.positions.length;
  let corners = 0;
  for (const face of faces) corners += face.length;
  // Half-edge h = faceStart[f] + c runs from corner c to corner c + 1 of face f.
  const faceStart = new Int32Array(faces.length + 1);
  const faceOf = new Int32Array(corners);
  const fromVertex = new Int32Array(corners);
  const edgeOf = new Int32Array(corners);
  const first = new Int32Array(corners).fill(-1);
  const second = new Int32Array(corners).fill(-1);
  const count = new Uint8Array(corners);
  const edgeIndex = new Map<number, number>();
  let edges = 0;
  let cursor = 0;
  for (let f = 0; f < faces.length; f += 1) {
    const face = faces[f] ?? [];
    faceStart[f] = cursor;
    for (let c = 0; c < face.length; c += 1) {
      const from = face[c], to = face[(c + 1) % face.length];
      if (from === undefined || to === undefined || from < 0 || to < 0 || from >= vertexCount || to >= vertexCount) {
        throw new Error("Mesh contains an invalid vertex reference");
      }
      const key = from < to ? from * vertexCount + to : to * vertexCount + from;
      let edge = edgeIndex.get(key);
      if (edge === undefined) { edge = edges; edges += 1; edgeIndex.set(key, edge); }
      const half = cursor + c;
      faceOf[half] = f;
      fromVertex[half] = from;
      edgeOf[half] = edge;
      const seen = count[edge] ?? 0;
      if (seen === 0) first[edge] = half; else if (seen === 1) second[edge] = half;
      count[edge] = Math.min(seen + 1, 3);
    }
    cursor += face.length;
  }
  faceStart[faces.length] = cursor;
  let closed = true;
  for (let edge = 0; edge < edges; edge += 1) {
    const incident = count[edge] ?? 0;
    if (incident !== 2) closed = false;
    if (incident > 2 || (requireClosed && incident !== 2)) {
      throw new Error(requireClosed ? "Operation requires a closed manifold surface" : "Operation requires manifold geometry");
    }
    if (incident === 2 && fromVertex[first[edge] ?? 0] === fromVertex[second[edge] ?? 0]) throw new Error("Mesh has inconsistent face winding");
  }
  // Fans: group the half-edges that start at each vertex, then join their faces across shared edges.
  const vertexStart = new Int32Array(vertexCount + 1);
  for (let half = 0; half < corners; half += 1) { const v = (fromVertex[half] ?? 0) + 1; vertexStart[v] = (vertexStart[v] ?? 0) + 1; }
  for (let v = 0; v < vertexCount; v += 1) vertexStart[v + 1] = (vertexStart[v + 1] ?? 0) + (vertexStart[v] ?? 0);
  const fill = vertexStart.slice(0, vertexCount);
  const around = new Int32Array(corners);
  for (let half = 0; half < corners; half += 1) {
    const v = fromVertex[half] ?? 0;
    around[fill[v] ?? 0] = half;
    fill[v] = (fill[v] ?? 0) + 1;
  }
  const parent = new Int32Array(faces.length);
  const find = (face: number): number => {
    let root = face;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    let walk = face;
    while ((parent[walk] ?? walk) !== root) { const next = parent[walk] ?? root; parent[walk] = root; walk = next; }
    return root;
  };
  const twinFace = (half: number): number => {
    const edge = edgeOf[half] ?? 0;
    if ((count[edge] ?? 0) !== 2) return -1;
    const other = (first[edge] ?? -1) === half ? second[edge] ?? -1 : first[edge] ?? -1;
    return faceOf[other] ?? -1;
  };
  for (let v = 0; v < vertexCount; v += 1) {
    const start = vertexStart[v] ?? 0, end = vertexStart[v + 1] ?? 0;
    if (start === end) continue;
    for (let i = start; i < end; i += 1) { const face = faceOf[around[i] ?? 0] ?? 0; parent[face] = face; }
    let boundaries = 0;
    for (let i = start; i < end; i += 1) {
      const half = around[i] ?? 0, face = faceOf[half] ?? 0, base = faceStart[face] ?? 0;
      const size = (faceStart[face + 1] ?? 0) - base;
      const previous = base + ((half - base + size - 1) % size);
      const neighbours = [twinFace(half), twinFace(previous)];
      for (const neighbour of neighbours) {
        if (neighbour < 0) boundaries += 1;
        else parent[find(neighbour)] = find(face);
      }
    }
    const root = find(faceOf[around[start] ?? 0] ?? 0);
    let single = true;
    for (let i = start + 1; i < end && single; i += 1) single = find(faceOf[around[i] ?? 0] ?? 0) === root;
    if (!single || (boundaries !== 0 && boundaries !== 2)) throw new Error("Mesh has a non-manifold vertex");
  }
  if (faces.length === 0) throw new Error("Mesh has no faces");
  verified.set(mesh.faces, { closed, vertices: vertexCount });
  return { closed };
}
