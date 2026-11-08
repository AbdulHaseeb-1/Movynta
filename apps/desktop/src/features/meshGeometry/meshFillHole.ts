import { ShapeUtils, Vector2, Vector3 } from "three";
import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import type { ExtrudeResult } from "./meshExtrude";
import { triangulate } from "./meshOutput";
import { assertManifold, channels, faceNormal, point, topology, type HalfEdge, type PolygonMesh } from "./meshTopology";
import { basis, type Weights } from "./meshWeights";

function assertSimple(points: readonly Vector2[]): void {
  const turn = (a: Vector2, b: Vector2, c: Vector2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const overlaps = (a: number, b: number, c: number, d: number) =>
    Math.max(Math.min(a, b), Math.min(c, d)) <= Math.min(Math.max(a, b), Math.max(c, d));
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j];
      const d = points[(j + 1) % points.length];
      if (
        c &&
        d &&
        overlaps(a.x, b.x, c.x, d.x) &&
        overlaps(a.y, b.y, c.y, d.y) &&
        turn(a, b, c) * turn(a, b, d) <= 0 &&
        turn(c, d, a) * turn(c, d, b) <= 0
      ) {
        throw new Error("The hole boundary intersects itself");
      }
    }
  }
}

/** Fills a planar loop with a polygon, or a simple nonplanar loop with oriented triangles. */
export function fillHole(mesh: PolygonMesh, ids: readonly string[]): ExtrudeResult {
  const graph = topology(mesh);
  assertManifold(mesh, graph);
  const byEnd = new Map<number, HalfEdge>();
  for (const id of new Set(ids)) {
    const incident = graph.edges.get(id);
    const half = incident?.[0];
    if (incident?.length !== 1 || !half || byEnd.has(half.to)) {
      throw new Error("Select only the boundary edges of one closed hole");
    }
    byEnd.set(half.to, half);
  }
  const start = byEnd.values().next().value;
  if (!start || byEnd.size < 3 || byEnd.size !== ids.length) {
    throw new Error("Select at least three distinct boundary edges");
  }
  const cap: number[] = [];
  const neighbors = new Set<number>();
  const weights: Weights[] = [];
  const data = channels(mesh);
  let current: HalfEdge | undefined = start;
  let end = start.to;
  while (current && byEnd.delete(current.to)) {
    const vertex = current.to;
    neighbors.add(current.face);
    const corner = mesh.faces[current.face]?.indexOf(vertex) ?? -1;
    cap.push(vertex);
    weights.push(data.corners[current.face]?.[corner] ?? data.positions[vertex] ?? basis(vertex));
    end = current.from;
    current = byEnd.get(current.from);
  }
  if (byEnd.size > 0 || end !== start.to) throw new Error("Select one complete boundary loop");
  const normal = faceNormal(mesh, cap);
  const origin = point(mesh, cap[0]);
  const offsets = cap.map((vertex) => new Vector3().subVectors(point(mesh, vertex), origin));
  const size = Math.max(...offsets.map((offset) => offset.length()));
  if (normal.lengthSq() < 0.5 || !(size > 0)) throw new Error("The hole boundary has no stable normal");
  const planar = offsets.every((offset) => Math.abs(offset.dot(normal)) <= size * 1e-6);
  if (planar && [...neighbors].every((id) => faceNormal(mesh, mesh.faces[id] ?? []).dot(normal) < -1 + 1e-6)) {
    throw new Error("This loop is the outside of a planar sheet. Filling it would create coincident faces");
  }
  const x = new Vector3();
  for (const offset of offsets) {
    const projected = offset.clone().addScaledVector(normal, -offset.dot(normal));
    if (projected.lengthSq() > x.lengthSq()) x.copy(projected);
  }
  if (!(x.lengthSq() > 0)) throw new Error("Hole boundary has no projected length");
  x.normalize();
  const y = new Vector3().crossVectors(normal, x);
  const contour = offsets.map((offset) => new Vector2(offset.dot(x), offset.dot(y)));
  assertSimple(contour);
  const capFaces: number[][] = [];
  const capCorners: Weights[][] = [];
  if (planar) {
    if (triangulate(mesh, cap).length !== cap.length - 2)
      throw new Error("The hole boundary could not be triangulated");
    capFaces.push(cap);
    capCorners.push(weights);
  } else {
    const triangles = ShapeUtils.triangulateShape(contour, []);
    if (triangles.length !== cap.length - 2) throw new Error("The projected hole boundary could not be triangulated");
    for (const triangle of triangles) {
      const a = contour[triangle[0] ?? -1];
      const b = contour[triangle[1] ?? -1];
      const c = contour[triangle[2] ?? -1];
      if (!a || !b || !c) throw new Error("Invalid boundary triangulation");
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(area) <= size * size * 1e-12) throw new Error("The hole fill would create a degenerate triangle");
      const ordered = area > 0 ? triangle : triangle.slice().reverse();
      const face: number[] = [];
      const corners: Weights[] = [];
      for (const index of ordered) {
        const vertex = cap[index];
        const weight = weights[index];
        if (vertex === undefined || !weight) throw new Error("Invalid boundary triangulation");
        face.push(vertex);
        corners.push(weight);
      }
      capFaces.push(face);
      capCorners.push(corners);
    }
  }
  const result: PolygonMesh = {
    positions: mesh.positions,
    faces: [...mesh.faces, ...capFaces],
    channels: {
      positions: data.positions,
      corners: [...data.corners, ...capCorners],
      materials: [...data.materials, ...capFaces.map(() => data.materials[start.face] ?? 0)],
    },
  };
  if (result.faces.reduce((sum, face) => sum + face.length - 2, 0) > MAX_MESH_OUTPUT_TRIANGLES) {
    throw new Error("Hole fill exceeds the geometry output budget");
  }
  assertManifold(result, topology(result));
  return { mesh: result, selection: capFaces.map((_, index) => String(mesh.faces.length + index)), walls: [] };
}
