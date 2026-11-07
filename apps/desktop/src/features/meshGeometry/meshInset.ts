import { Triangle, Vector3 } from "three";
import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import { parseFaces, type ExtrudeResult } from "./meshExtrude";
import { triangulate } from "./meshOutput";
import {
  assertManifold,
  channels,
  edgeKey,
  faceAreaNormal,
  point,
  topology,
  type HalfEdge,
  type PolygonMesh,
  type Topology,
} from "./meshTopology";
import { basis, blend, type Weights } from "./meshWeights";

export interface InsetOptions {
  thickness: number;
  depth?: number | undefined;
  boundary?: boolean | undefined;
  offsetEven?: boolean | undefined;
  offsetRelative?: boolean | undefined;
  edgeRail?: boolean | undefined;
  outset?: boolean | undefined;
  individual?: boolean | undefined;
  selectOuter?: boolean | undefined;
  interpolate?: boolean | undefined;
}

interface RimEdge extends HalfEdge {
  corner: number;
  length: number;
  direction: Vector3;
  inward: Vector3;
  split: boolean;
}

function patches(mesh: PolygonMesh, graph: Topology, selected: Set<number>, individual: boolean): Set<number>[] {
  const remaining = new Set(selected);
  const result: Set<number>[] = [];
  for (const first of selected) {
    if (!remaining.delete(first)) continue;
    const patch = new Set([first]);
    result.push(patch);
    if (individual) continue;
    // Set iteration visits faces added by the flood, in insertion order.
    for (const index of patch) {
      const face = mesh.faces[index] ?? [];
      face.forEach((from, corner) => {
        const to = face[(corner + 1) % face.length];
        if (to === undefined) return;
        for (const side of graph.edges.get(edgeKey(from, to)) ?? []) {
          if (remaining.delete(side.face)) patch.add(side.face);
        }
      });
    }
  }
  return result;
}

function rimOffset(
  mesh: PolygonMesh,
  graph: Topology,
  patch: Set<number>,
  vertex: number,
  edges: RimEdge[],
  thickness: number,
  even: boolean,
  edgeRail: boolean,
): Vector3 {
  const [a, b] = edges.filter((edge) => edge.split);
  if (!a || thickness === 0) return new Vector3();
  const inward = a.inward.clone();
  if (b) inward.add(b.inward).normalize();
  const onRail = (rail: Vector3): Vector3 | undefined => {
    const projection = rail.dot(inward);
    if (Math.abs(projection) < 1e-6) return undefined;
    return rail.multiplyScalar(thickness * (even ? 1 / rail.dot(a.inward) : Math.sign(projection)));
  };
  const open = edges.find((edge) => !edge.split);
  if (open) {
    const offset = onRail(open.direction.clone());
    if (offset && Number.isFinite(offset.lengthSq())) return offset;
    throw new Error("Inset cannot slide this corner along the open boundary");
  }
  if (edgeRail && b) {
    let rail: Vector3 | undefined;
    let best = 1e-6;
    for (const key of graph.vertexEdges[vertex] ?? []) {
      const [first, second] = graph.edges.get(key) ?? [];
      if (!first || !second || !patch.has(first.face) || !patch.has(second.face)) continue;
      const other = first.from === vertex ? first.to : first.from;
      const direction = point(mesh, other).clone().sub(point(mesh, vertex)).normalize();
      const alignment = direction.dot(inward);
      if (alignment > best && direction.dot(a.inward) > 1e-6) {
        rail = direction;
        best = alignment;
      }
    }
    if (rail) {
      const offset = onRail(rail);
      if (offset) return offset;
    }
  }
  const projection = inward.dot(a.inward);
  if (projection < 1e-6) throw new Error("Inset cannot resolve a folded boundary corner");
  return inward.multiplyScalar(even ? thickness / projection : thickness);
}

/** Find weights on the original face before depth is applied, keeping each UV seam independent. */
function faceSample(
  mesh: PolygonMesh,
  face: number[],
  triangles: number[][],
  position: Vector3,
  fallback: number,
): Weights {
  const weights = new Vector3();
  let best = -Infinity;
  let sample = basis(fallback);
  for (const [i, j, k] of triangles) {
    if (i === undefined || j === undefined || k === undefined) continue;
    if (!Triangle.getBarycoord(position, point(mesh, face[i]), point(mesh, face[j]), point(mesh, face[k]), weights))
      continue;
    const score = Math.min(weights.x, weights.y, weights.z);
    if (score <= best) continue;
    best = score;
    const sum = Math.max(0, weights.x) + Math.max(0, weights.y) + Math.max(0, weights.z);
    if (sum > 0)
      sample = new Map([
        [i, Math.max(0, weights.x) / sum],
        [j, Math.max(0, weights.y) / sum],
        [k, Math.max(0, weights.z) / sum],
      ]);
    if (score >= -1e-9) break;
  }
  return sample;
}

/** Insets the given faces: makes a smaller copy of each region inside it, optionally sunk or raised by a depth. */
export function insetFaces(mesh: PolygonMesh, ids: readonly string[], options: InsetOptions): ExtrudeResult {
  const {
    thickness,
    depth = 0,
    individual = false,
    outset = false,
    boundary = true,
    offsetEven = true,
    offsetRelative = false,
    edgeRail = false,
    interpolate = true,
    selectOuter = false,
  } = options;
  if (!Number.isFinite(thickness) || thickness < 0 || !Number.isFinite(depth) || (thickness === 0 && depth === 0)) {
    throw new Error("Inset needs a nonnegative thickness and a finite depth, with at least one nonzero value");
  }
  if (individual && outset) throw new Error("Outset is available in region mode");
  const selected = new Set(parseFaces(mesh, ids));
  const graph = topology(mesh);
  assertManifold(mesh, graph);
  const processed = outset ? new Set([...mesh.faces.keys()].filter((index) => !selected.has(index))) : selected;
  const data = channels(mesh);
  const result: PolygonMesh = { positions: [...mesh.positions], faces: [...mesh.faces] };
  const flat = { ...result, positions: [...result.positions] };
  const output = { positions: [...data.positions], corners: [...data.corners], materials: [...data.materials] };
  const rings: number[] = [];
  let changed = false;
  let triangles = mesh.faces.reduce((count, face) => count + face.length - 2, 0);
  for (const patch of patches(mesh, graph, processed, individual)) {
    const rim: RimEdge[] = [];
    const atVertex = new Map<number, RimEdge[]>();
    const vertexNormals = new Map<number, Vector3>();
    for (const index of patch) {
      const face = mesh.faces[index] ?? [];
      const normal = faceAreaNormal(mesh, face);
      if (normal.lengthSq() === 0) throw new Error("Inset selection has a degenerate face");
      face.forEach((from, corner) => {
        const to = face[(corner + 1) % face.length];
        if (to === undefined) return;
        vertexNormals.set(from, (vertexNormals.get(from) ?? new Vector3()).add(normal));
        const key = edgeKey(from, to);
        const sides = graph.edges.get(key) ?? [];
        if (!individual && sides.length === 2 && sides.every((side) => patch.has(side.face))) return;
        const direction = point(mesh, to).clone().sub(point(mesh, from));
        const length = direction.length();
        direction.normalize();
        // Blender's individual inset always builds a complete border around each face.
        const split = individual || sides.length === 2 || (boundary && !outset);
        const edge = {
          face: index,
          from,
          to,
          corner,
          length,
          direction,
          inward: normal.clone().cross(direction).normalize(),
          split,
        };
        rim.push(edge);
        for (const vertex of [from, to]) {
          const existing = atVertex.get(vertex);
          if (existing) existing.push(edge);
          else atVertex.set(vertex, [edge]);
        }
      });
    }
    if (!rim.some((edge) => edge.split) && (depth === 0 || outset)) continue;
    const remap = new Map<number, number>();
    const surface = new Map<number, Vector3>();
    // Propagate boundary edge lengths across the region for relative depth at interior vertices.
    const relativeDepth = new Map<number, { distance: number; total: number; count: number }>();
    if (offsetRelative && depth !== 0) {
      const queue: number[] = [];
      for (const [vertex, edges] of atVertex) {
        const insetEdges = edges.filter((edge) => edge.split);
        if (insetEdges.length === 0) continue;
        relativeDepth.set(vertex, {
          distance: 0,
          total: insetEdges.reduce((sum, edge) => sum + edge.length, 0),
          count: insetEdges.length,
        });
        queue.push(vertex);
      }
      for (let i = 0; i < queue.length; i += 1) {
        const vertex = queue[i];
        if (vertex === undefined) continue;
        const value = relativeDepth.get(vertex);
        if (!value) continue;
        for (const key of graph.vertexEdges[vertex] ?? []) {
          const sides = graph.edges.get(key) ?? [];
          const edge = sides[0];
          if (!edge || !sides.some((side) => patch.has(side.face))) continue;
          const neighbor = edge.from === vertex ? edge.to : edge.from;
          const next = relativeDepth.get(neighbor);
          if (!next) {
            relativeDepth.set(neighbor, { distance: value.distance + 1, total: value.total / value.count, count: 1 });
            queue.push(neighbor);
          } else if (next.distance === value.distance + 1) {
            next.total += value.total / value.count;
            next.count += 1;
          }
        }
      }
    }
    for (const [vertex, normal] of vertexNormals) {
      const edges = atVertex.get(vertex) ?? [];
      if (edges.length > 2)
        throw new Error("Inset region touches itself at a vertex. Use Individual or split the selection.");
      const insetEdges = edges.filter((edge) => edge.split);
      const relative =
        offsetRelative && insetEdges.length
          ? insetEdges.reduce((sum, edge) => sum + edge.length, 0) / insetEdges.length
          : 1;
      const original = point(mesh, vertex);
      const offset = rimOffset(
        mesh,
        graph,
        patch,
        vertex,
        edges,
        thickness * relative,
        offsetEven,
        edgeRail && !individual,
      );
      const onSurface = original.clone().add(offset);
      const propagated = relativeDepth.get(vertex);
      const depthScale = propagated ? propagated.total / propagated.count : relative;
      const moved = onSurface.clone().addScaledVector(normal.normalize(), depth * depthScale);
      if (!Number.isFinite(moved.lengthSq())) throw new Error("Inset produced a non-finite vertex");
      const split = edges.some((edge) => edge.split);
      const index = split ? result.positions.length : vertex;
      if (!split && (graph.vertexFaces[vertex] ?? []).some((face) => !patch.has(face))) {
        // A different face fan shares this corner. Only a split rim may move away from it.
        continue;
      }
      remap.set(vertex, index);
      surface.set(vertex, onSurface);
      flat.positions[index] = onSurface;
      result.positions[index] = moved;
      output.positions[index] = data.positions[vertex] ?? basis(vertex);
    }
    const sample = new Map<number, Weights[]>();
    for (const index of patch) {
      const original = mesh.faces[index] ?? [];
      const face = original.map((vertex) => remap.get(vertex) ?? vertex);
      const area = faceAreaNormal(mesh, original);
      const nextArea = faceAreaNormal(flat, face);
      if (
        nextArea.dot(area) <= 1e-8 * area.lengthSq() ||
        original.some((vertex, corner) => {
          const next = (corner + 1) % original.length;
          const before = point(mesh, original[next]).clone().sub(point(mesh, vertex));
          return point(flat, face[next]).clone().sub(point(flat, face[corner])).dot(before) <= 1e-8 * before.lengthSq();
        })
      )
        throw new Error("Inset is too large for this selection");
      result.faces[index] = face;
      const corners = data.corners[index] ?? [];
      let sourceTriangles: number[][] | undefined;
      const weights = original.map((vertex, corner) => {
        const onSurface = surface.get(vertex);
        if (!interpolate || !onSurface || onSurface.equals(point(mesh, vertex)))
          return corners[corner] ?? basis(vertex);
        sourceTriangles ??= triangulate(mesh, original);
        const terms = [...faceSample(mesh, original, sourceTriangles, onSurface, corner)];
        const target = remap.get(vertex);
        if (target !== undefined)
          output.positions[target] = blend(
            terms.map(([i, weight]) => {
              const source = original[i] ?? vertex;
              return [data.positions[source] ?? basis(source), weight];
            }),
          );
        return blend(terms.map(([i, weight]) => [corners[i] ?? basis(original[i] ?? vertex), weight]));
      });
      sample.set(index, weights);
      output.corners[index] = weights;
    }
    for (const edge of rim) {
      if (!edge.split) continue;
      const face = mesh.faces[edge.face] ?? [];
      const from = edge.corner;
      const to = (from + 1) % face.length;
      const innerFrom = remap.get(edge.from) ?? edge.from;
      const innerTo = remap.get(edge.to) ?? edge.to;
      const ring = [edge.from, edge.to, innerTo, innerFrom];
      if (faceAreaNormal(result, ring).lengthSq() === 0) throw new Error("Inset creates a zero-area border face");
      triangles += 2;
      if (triangles > MAX_MESH_OUTPUT_TRIANGLES) throw new Error("Inset exceeds the mesh triangle limit");
      rings.push(result.faces.length);
      result.faces.push(ring);
      const before = data.corners[edge.face] ?? [];
      const after = sample.get(edge.face) ?? [];
      output.corners.push([
        before[from] ?? basis(edge.from),
        before[to] ?? basis(edge.to),
        after[to] ?? basis(edge.to),
        after[from] ?? basis(edge.from),
      ]);
      output.materials.push(data.materials[edge.face] ?? 0);
    }
    changed = true;
  }
  if (!changed)
    throw new Error(outset ? "Outset needs faces next to the selection" : "Inset needs a border or a nonzero depth");
  result.channels = output;
  assertManifold(result, topology(result));
  return { mesh: result, selection: (selectOuter && rings.length ? rings : [...selected]).map(String), walls: [] };
}
