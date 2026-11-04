import { Vector3 } from "three";
import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import { basis, type Weights } from "./meshWeights";
import { channels, edgeKey, faceNormal, point, topology, type PolygonMesh, type SurfaceChannels } from "./meshTopology";

export type ExtrudeKind = "vertex" | "edge" | "face";
export interface ExtrudeResult { mesh: PolygonMesh; selection: string[] }

const COMPONENT = /^\d{1,10}$/;
const EDGE = /^(\d{1,10})_(\d{1,10})$/;
const MAX_COMPONENTS = 4096;

interface Draft {
  positions: Vector3[];
  weights: Weights[];
  faces: number[][];
  corners: Weights[][];
  materials: number[];
  copies: Map<number, number>;
}

function requireOffset(offset: Vector3): void {
  if (![offset.x, offset.y, offset.z].every((value) => Number.isFinite(value)) || offset.lengthSq() <= 1e-12)
    throw new Error("Extrude offset must move the selection");
}

function budget(faces: readonly (readonly number[])[]): void {
  const triangles = faces.reduce((count, face) => count + face.length - 2, 0);
  if (triangles > MAX_MESH_OUTPUT_TRIANGLES) throw new Error(`Result exceeds the ${MAX_MESH_OUTPUT_TRIANGLES}-triangle geometry limit`);
}

function draftFrom(mesh: PolygonMesh, data: SurfaceChannels): Draft {
  return {
    positions: mesh.positions.map((position) => position.clone()),
    weights: data.positions.map((weights) => new Map(weights)),
    faces: mesh.faces.map((face) => face.slice()),
    corners: data.corners.map((row) => row.map((weights) => new Map(weights))),
    materials: data.materials.slice(),
    copies: new Map(),
  };
}

function copyVertex(draft: Draft, mesh: PolygonMesh, data: SurfaceChannels, vertex: number, offset: Vector3): number {
  const known = draft.copies.get(vertex);
  if (known !== undefined) return known;
  const id = draft.positions.length;
  draft.copies.set(vertex, id);
  draft.positions.push(point(mesh, vertex).clone().add(offset));
  draft.weights.push(new Map(data.positions[vertex] ?? basis(vertex)));
  return id;
}

function cornerWeight(mesh: PolygonMesh, data: SurfaceChannels, faceIndex: number, vertex: number): Weights {
  const face = mesh.faces[faceIndex];
  const index = face?.indexOf(vertex) ?? -1;
  const weight = index >= 0 ? data.corners[faceIndex]?.[index] : undefined;
  return new Map(weight ?? data.positions[vertex] ?? basis(vertex));
}

function addWall(draft: Draft, mesh: PolygonMesh, data: SurfaceChannels, faceIndex: number, from: number, to: number): void {
  const start = draft.copies.get(from);
  const end = draft.copies.get(to);
  if (start === undefined || end === undefined) throw new Error("Missing extruded vertex");
  draft.faces.push([from, to, end, start]);
  draft.corners.push([
    cornerWeight(mesh, data, faceIndex, from),
    cornerWeight(mesh, data, faceIndex, to),
    cornerWeight(mesh, data, faceIndex, to),
    cornerWeight(mesh, data, faceIndex, from),
  ]);
  draft.materials.push(data.materials[faceIndex] ?? 0);
}

function centerOf(mesh: PolygonMesh): Vector3 {
  const center = new Vector3();
  for (const position of mesh.positions) center.add(position);
  return mesh.positions.length === 0 ? center : center.multiplyScalar(1 / mesh.positions.length);
}

function adjacentNormal(mesh: PolygonMesh, incident: readonly { face: number }[]): Vector3 {
  const sum = new Vector3();
  for (const half of incident) {
    const face = mesh.faces[half.face];
    if (face) sum.add(faceNormal(mesh, face));
  }
  return sum;
}

function faceCentroid(positions: readonly Vector3[], face: readonly number[]): Vector3 {
  const centroid = new Vector3();
  let count = 0;
  for (const id of face) {
    const position = positions[id];
    if (!position) continue;
    centroid.add(position);
    count += 1;
  }
  return count === 0 ? centroid : centroid.multiplyScalar(1 / count);
}

/** A vertex or edge wall has no region winding. Point it out of the solid, and away from the interior when it stands on a boundary. */
function orientWall(draft: Draft, preferred: Vector3, center: Vector3): void {
  const index = draft.faces.length - 1;
  const face = draft.faces[index];
  const corners = draft.corners[index];
  if (!face || !corners || face.length < 3) return;
  const normal = faceNormal({ positions: draft.positions, faces: [face] }, face);
  if (normal.lengthSq() < 0.5) return;
  const alignment = preferred.lengthSq() > 0 ? normal.dot(preferred) / preferred.length() : 0;
  const outward = Math.abs(alignment) > 1e-4 ? alignment : normal.dot(faceCentroid(draft.positions, face).sub(center));
  if (outward < 0) {
    face.reverse();
    corners.reverse();
  }
}

function uniqueIds(ids: readonly string[], label: string): void {
  if (ids.length === 0 || ids.length > MAX_COMPONENTS) throw new Error(`Extrude needs one ${label} and at most ${MAX_COMPONENTS} components`);
  if (new Set(ids).size !== ids.length) throw new Error("The selection repeats a component");
}

function parseFaces(mesh: PolygonMesh, ids: readonly string[]): number[] {
  uniqueIds(ids, "face");
  return ids.map((id) => {
    if (!COMPONENT.test(id)) throw new Error("Unknown face");
    const index = Number(id);
    if (!mesh.faces[index]) throw new Error("Unknown face");
    return index;
  });
}

function parseVertices(mesh: PolygonMesh, ids: readonly string[]): number[] {
  uniqueIds(ids, "vertex");
  return ids.map((id) => {
    if (!COMPONENT.test(id)) throw new Error("Unknown vertex");
    const index = Number(id);
    if (!mesh.positions[index]) throw new Error("Unknown vertex");
    return index;
  });
}

function parseEdges(mesh: PolygonMesh, ids: readonly string[]): { from: number; to: number; face: number }[] {
  uniqueIds(ids, "edge");
  const graph = topology(mesh);
  const seen = new Set<string>();
  return ids.map((id) => {
    const match = EDGE.exec(id);
    const left = match ? Number(match[1]) : Number.NaN;
    const right = match ? Number(match[2]) : Number.NaN;
    const key = Number.isInteger(left) && Number.isInteger(right) ? edgeKey(left, right) : "";
    const half = graph.edges.get(key)?.[0];
    if (!half || seen.has(key)) throw new Error(seen.has(key) ? "The selection repeats a component" : "Unknown edge");
    seen.add(key);
    return { from: half.from, to: half.to, face: half.face };
  });
}

function finish(draft: Draft, kind: ExtrudeKind, selection: readonly string[]): ExtrudeResult {
  budget(draft.faces);
  const map = new Map<number, number>();
  const positions: Vector3[] = [];
  const weights: Weights[] = [];
  const use = (id: number): number => {
    const known = map.get(id);
    if (known !== undefined) return known;
    const position = draft.positions[id];
    const weight = draft.weights[id];
    if (!position || !weight) throw new Error("Mesh contains an invalid vertex reference");
    const next = positions.length;
    map.set(id, next);
    positions.push(position);
    weights.push(weight);
    return next;
  };
  const faces = draft.faces.map((face) => {
    if (face.length < 3) throw new Error("Extrude created a face with too few corners");
    return face.map(use);
  });
  const mesh: PolygonMesh = {
    positions,
    faces,
    channels: { positions: weights, corners: draft.corners, materials: draft.materials },
  };
  return { mesh, selection: remap(kind, selection, map) };
}

function remap(kind: ExtrudeKind, selection: readonly string[], map: Map<number, number>): string[] {
  if (kind === "face") return [...selection];
  if (kind === "vertex") return selection.map((id) => {
    const next = map.get(Number(id));
    if (next === undefined) throw new Error("Extrude lost a selected vertex");
    return String(next);
  });
  return selection.map((id) => {
    const [left, right] = id.split("_");
    const from = map.get(Number(left));
    const to = map.get(Number(right));
    if (from === undefined || to === undefined) throw new Error("Extrude lost a selected edge");
    return edgeKey(from, to);
  });
}

/**
 * Blender Extrude Region. Faces are rewired onto one copied cap and the boundary grows walls.
 * Edges grow a quad. Vertices joined by an edge grow that same quad. One offset moves the whole region.
 */
export function extrudeRegion(mesh: PolygonMesh, kind: ExtrudeKind, ids: readonly string[], offset: Vector3): ExtrudeResult {
  requireOffset(offset);
  if (mesh.faces.length === 0) throw new Error("Mesh has no faces");
  const data = channels(mesh);
  const draft = draftFrom(mesh, data);
  if (kind === "face") {
    const faces = parseFaces(mesh, ids);
    const selected = new Set(faces);
    for (const face of selected) for (const vertex of mesh.faces[face] ?? []) copyVertex(draft, mesh, data, vertex, offset);
    for (const face of selected) {
      const source = draft.faces[face];
      if (!source) throw new Error("Unknown face");
      draft.faces[face] = source.map((vertex) => {
        const copy = draft.copies.get(vertex);
        if (copy === undefined) throw new Error("Missing extruded vertex");
        return copy;
      });
    }
    for (const incident of topology(mesh).edges.values()) {
      const boundary = incident.filter((edge) => selected.has(edge.face));
      const half = boundary.length === 1 ? boundary[0] : undefined;
      if (half) addWall(draft, mesh, data, half.face, half.from, half.to);
    }
    return finish(draft, kind, faces.map(String));
  }
  if (kind === "edge") {
    const edges = parseEdges(mesh, ids);
    const graph = topology(mesh);
    const center = centerOf(mesh);
    for (const edge of edges) {
      copyVertex(draft, mesh, data, edge.from, offset);
      copyVertex(draft, mesh, data, edge.to, offset);
      addWall(draft, mesh, data, edge.face, edge.from, edge.to);
      orientWall(draft, adjacentNormal(mesh, graph.edges.get(edgeKey(edge.from, edge.to)) ?? []), center);
    }
    const selection = edges.map((edge) => {
      const from = draft.copies.get(edge.from);
      const to = draft.copies.get(edge.to);
      if (from === undefined || to === undefined) throw new Error("Missing extruded vertex");
      return edgeKey(from, to);
    });
    return finish(draft, kind, selection);
  }
  const vertices = parseVertices(mesh, ids);
  const selected = new Set(vertices);
  const covered = new Set<number>();
  const center = centerOf(mesh);
  for (const incident of topology(mesh).edges.values()) {
    const half = incident[0];
    if (!half || !selected.has(half.from) || !selected.has(half.to)) continue;
    copyVertex(draft, mesh, data, half.from, offset);
    copyVertex(draft, mesh, data, half.to, offset);
    addWall(draft, mesh, data, half.face, half.from, half.to);
    orientWall(draft, adjacentNormal(mesh, incident), center);
    covered.add(half.from);
    covered.add(half.to);
  }
  if (vertices.some((vertex) => !covered.has(vertex))) throw new Error("Select both vertices of an edge. A lone vertex has no face to grow.");
  const selection = vertices.map((vertex) => {
    const copy = draft.copies.get(vertex);
    if (copy === undefined) throw new Error("Missing extruded vertex");
    return String(copy);
  });
  return finish(draft, kind, selection);
}
