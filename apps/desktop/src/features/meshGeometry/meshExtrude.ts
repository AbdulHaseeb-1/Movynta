import { Vector3, type BufferAttribute, type BufferGeometry, type InterleavedBufferAttribute } from "three";
import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import { writeShadedGeometry } from "./meshOutput";
import { basis, type Weights } from "./meshWeights";
import { channels, edgeKey, faceNormal, point, topology, type HalfEdge, type PolygonMesh, type SurfaceChannels } from "./meshTopology";

export type ExtrudeKind = "vertex" | "edge" | "face";
export interface ExtrudeResult {
  mesh: PolygonMesh;
  selection: string[];
  /** Indices of the quads grown along the boundary. They follow the original faces in `mesh.faces`. */
  walls: number[];
}

const COMPONENT = /^\d{1,10}$/;
const EDGE = /^(\d{1,10})_(\d{1,10})$/;
const MAX_COMPONENTS = 4096;
/** A wall whose edge and extrude offset have a sine below this runs along its own edge, so it has no area. */
const MIN_WALL_SINE = 1e-6;

interface Draft {
  positions: Vector3[];
  weights: Weights[];
  faces: number[][];
  corners: Weights[][];
  materials: number[];
  copies: Map<number, number>;
  walls: number[];
}

interface Span {
  /** The half-edge that grows the wall; its face decides the wall's side. */
  half: HalfEdge;
  incident: HalfEdge[];
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
    walls: [],
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

/** The offset runs along a selected edge, so that edge's wall would have no area. Only this error is an offset problem. */
export class ZeroAreaWallError extends Error {
  constructor() {
    super("The offset runs along a selected edge, so its wall would have no area.");
    this.name = "ZeroAreaWallError";
  }
}

/** The wall is the parallelogram spanned by its edge and its offset. A parallel offset leaves no area. */
function assertWallArea(positions: readonly Vector3[], a: number, b: number, aTop: number): void {
  const pa = positions[a];
  const pb = positions[b];
  const top = positions[aTop];
  if (!pa || !pb || !top) throw new Error("Missing extruded vertex");
  const along = pb.clone().sub(pa);
  const up = top.clone().sub(pa);
  const sine = along.clone().cross(up).length() / (along.length() * up.length());
  if (!(sine > MIN_WALL_SINE)) throw new ZeroAreaWallError();
}

/** Grows the quad [a, b, b', a'] on edge a→b of `faceIndex`. Its bottom runs a→b, so the caller chooses the winding. */
function addWall(draft: Draft, mesh: PolygonMesh, data: SurfaceChannels, faceIndex: number, a: number, b: number): void {
  const start = draft.copies.get(a);
  const end = draft.copies.get(b);
  if (start === undefined || end === undefined) throw new Error("Missing extruded vertex");
  assertWallArea(draft.positions, a, b, start);
  draft.walls.push(draft.faces.length);
  draft.faces.push([a, b, end, start]);
  draft.corners.push([
    cornerWeight(mesh, data, faceIndex, a),
    cornerWeight(mesh, data, faceIndex, b),
    cornerWeight(mesh, data, faceIndex, b),
    cornerWeight(mesh, data, faceIndex, a),
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

/** Interior-edge walls only: point the wall out of the solid, and away from the interior when it stands on a boundary. */
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

/**
 * Grows the wall on one edge. A boundary edge has a single face, so the wall continues that face's surface and
 * traverses the edge the opposite way. An interior edge has two faces and no winding agrees with both, so its wall
 * points away from the solid instead.
 */
function growWall(draft: Draft, mesh: PolygonMesh, data: SurfaceChannels, center: Vector3, edge: HalfEdge, incident: readonly HalfEdge[]): void {
  if (incident.length === 1) {
    addWall(draft, mesh, data, edge.face, edge.to, edge.from);
    return;
  }
  addWall(draft, mesh, data, edge.face, edge.from, edge.to);
  orientWall(draft, adjacentNormal(mesh, incident), center);
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

function parseEdges(mesh: PolygonMesh, ids: readonly string[]): HalfEdge[] {
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

/** Edges whose two ends are both selected. Each span keeps every half-edge on that edge. */
function spansOf(mesh: PolygonMesh, vertices: readonly number[]): Span[] {
  const selected = new Set(vertices);
  const spans: Span[] = [];
  for (const incident of topology(mesh).edges.values()) {
    const half = incident[0];
    if (half && selected.has(half.from) && selected.has(half.to)) spans.push({ half, incident });
  }
  return spans;
}

function assertCovered(vertices: readonly number[], spans: readonly Span[]): void {
  const covered = new Set<number>();
  for (const { half } of spans) {
    covered.add(half.from);
    covered.add(half.to);
  }
  if (vertices.some((vertex) => !covered.has(vertex))) throw new Error("Select both vertices of an edge. A lone vertex has no face to grow.");
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
  return { mesh, selection: remap(kind, selection, map), walls: draft.walls };
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
 * Checks that a selection can grow, without choosing an offset. The editor runs this before a drag starts,
 * because a fixed probe offset would wrongly reject edges that run along it.
 */
export function checkExtrudeSelection(mesh: PolygonMesh, kind: ExtrudeKind, ids: readonly string[]): void {
  if (mesh.faces.length === 0) throw new Error("Mesh has no faces");
  if (kind === "face") parseFaces(mesh, ids);
  else if (kind === "edge") parseEdges(mesh, ids);
  else {
    const vertices = parseVertices(mesh, ids);
    assertCovered(vertices, spansOf(mesh, vertices));
  }
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
      growWall(draft, mesh, data, center, edge, graph.edges.get(edgeKey(edge.from, edge.to)) ?? []);
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
  const spans = spansOf(mesh, vertices);
  assertCovered(vertices, spans);
  const center = centerOf(mesh);
  for (const { half, incident } of spans) {
    copyVertex(draft, mesh, data, half.from, offset);
    copyVertex(draft, mesh, data, half.to, offset);
    growWall(draft, mesh, data, center, half, incident);
  }
  const selection = vertices.map((vertex) => {
    const copy = draft.copies.get(vertex);
    if (copy === undefined) throw new Error("Missing extruded vertex");
    return String(copy);
  });
  return finish(draft, kind, selection);
}

/** Writes an extruded cage. Each new wall gets texture area, so its UVs do not collapse onto the edge it grew from. */
export function writeExtrudedGeometry(source: BufferGeometry, result: ExtrudeResult): BufferGeometry {
  return writeShadedGeometry(source, result.mesh, (uv, renderCorner) => {
    for (const wall of result.walls) stretchWall(result.mesh, uv, wall, renderCorner);
  });
}

/**
 * Corners 0 and 1 are the wall's bottom edge; corners 2 and 3 are the copies above them. The top moves across the
 * bottom's UV edge by the wall's height over its width, so the wall keeps the texel density of its bottom edge.
 */
function stretchWall(
  mesh: PolygonMesh,
  uv: BufferAttribute | InterleavedBufferAttribute,
  wall: number,
  renderCorner: (face: number, corner: number) => number,
): void {
  const face = mesh.faces[wall];
  if (!face || face.length !== 4) return;
  const a = point(mesh, face[0]);
  const b = point(mesh, face[1]);
  const top = point(mesh, face[3]);
  const width = b.distanceTo(a);
  if (!(width > 0)) return;
  const along = b.clone().sub(a).divideScalar(width);
  const rise = top.clone().sub(a);
  const height = rise.clone().sub(along.clone().multiplyScalar(rise.dot(along))).length();
  const bottomA = renderCorner(wall, 0);
  const bottomB = renderCorner(wall, 1);
  const topB = renderCorner(wall, 2);
  const topA = renderCorner(wall, 3);
  const u0 = uv.getX(bottomA);
  const v0 = uv.getY(bottomA);
  const u1 = uv.getX(bottomB);
  const v1 = uv.getY(bottomB);
  if (!(Math.hypot(u1 - u0, v1 - v0) > 0)) return;
  // Perpendicular to the bottom edge in UV space, with length span * height / width.
  const scale = height / width;
  const du = -(v1 - v0) * scale;
  const dv = (u1 - u0) * scale;
  uv.setXY(topB, u1 + du, v1 + dv);
  uv.setXY(topA, u0 + du, v0 + dv);
}
