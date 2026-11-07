import { Vector3 } from "three";
import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import { parseFaces, type ExtrudeResult } from "./meshExtrude";
import { triangulate } from "./meshOutput";
import { isConvex } from "./meshSubdivision";
import { channels, edgeKey, point, type PolygonMesh } from "./meshTopology";
import { mean, type Weights } from "./meshWeights";

/** Index with wrap-around. A missing entry means the topology is broken, so it fails instead of guessing. */
function at<T>(values: readonly T[], index: number): T {
  const count = values.length;
  const value = values[((index % count) + count) % count];
  if (value === undefined) throw new Error("Invalid subdivision topology");
  return value;
}

function average(values: readonly Vector3[]): Vector3 {
  const sum = new Vector3();
  for (const value of values) sum.add(value);
  return sum.multiplyScalar(1 / values.length);
}

/**
 * Triangulates only the selected faces that are concave, because their centre point can lie outside them.
 * Every other face is kept as it is. Returns the mesh and which of its faces came from the selection.
 */
function splitConcaveSelection(
  mesh: PolygonMesh,
  selected: ReadonlySet<number>,
): { mesh: PolygonMesh; selected: Set<number> } {
  const data = channels(mesh);
  const faces: number[][] = [];
  const corners: Weights[][] = [];
  const materials: number[] = [];
  const fromSelection = new Set<number>();
  mesh.faces.forEach((face, index) => {
    const samples = data.corners[index];
    if (!samples || samples.length !== face.length) throw new Error("Missing corner attributes");
    const material = data.materials[index] ?? 0;
    if (selected.has(index) && !isConvex(mesh, face)) {
      const triangles = triangulate(mesh, face);
      if (triangles.length === 0) throw new Error(`Face ${index} is degenerate and cannot be subdivided`);
      for (const triangle of triangles) {
        fromSelection.add(faces.length);
        faces.push(triangle.map((corner) => at(face, corner)));
        corners.push(triangle.map((corner) => at(samples, corner)));
        materials.push(material);
      }
      return;
    }
    if (selected.has(index)) fromSelection.add(faces.length);
    faces.push([...face]);
    corners.push([...samples]);
    materials.push(material);
  });
  return {
    mesh: { positions: mesh.positions, faces, channels: { positions: data.positions, corners, materials } },
    selected: fromSelection,
  };
}

/**
 * Subdivides only the selected faces. Each one gets a centre point and one quad per corner, and every edge of a
 * selected face gets a midpoint. An unselected neighbour across such an edge receives the same midpoint on that edge,
 * so the mesh stays closed and no T-junction appears. Unselected faces keep their shape and their vertices.
 * The result's selection is the new quads, so the user can keep working on what was just subdivided.
 */
export function subdivideFaces(input: PolygonMesh, ids: readonly string[]): ExtrudeResult {
  const split = splitConcaveSelection(input, new Set(parseFaces(input, ids)));
  const mesh = split.mesh;
  const selected = split.selected;
  const data = channels(mesh);
  const weightsAt = (id: number): Weights => data.positions[id] ?? new Map();
  const positions = mesh.positions.map((position) => position.clone());
  const positionWeights: Weights[] = mesh.positions.map((_, id) => weightsAt(id));
  const addPoint = (position: Vector3, weights: Weights): number => {
    const id = positions.length;
    positions.push(position);
    positionWeights.push(weights);
    return id;
  };
  const midpoints = new Map<string, number>();
  for (const index of selected) {
    const face = at(mesh.faces, index);
    face.forEach((vertex, corner) => {
      const next = at(face, corner + 1);
      const key = edgeKey(vertex, next);
      if (midpoints.has(key)) return;
      const midpoint = point(mesh, vertex).clone().add(point(mesh, next)).multiplyScalar(0.5);
      midpoints.set(key, addPoint(midpoint, mean([weightsAt(vertex), weightsAt(next)])));
    });
  }
  const centers = new Map<number, number>();
  for (const index of selected) {
    const face = at(mesh.faces, index);
    centers.set(index, addPoint(average(face.map((vertex) => point(mesh, vertex))), mean(face.map(weightsAt))));
  }
  const midpointOf = (a: number, b: number): number => {
    const id = midpoints.get(edgeKey(a, b));
    if (id === undefined) throw new Error("Missing edge midpoint");
    return id;
  };

  const faces: number[][] = [];
  const corners: Weights[][] = [];
  const materials: number[] = [];
  const quads: number[] = [];
  mesh.faces.forEach((face, index) => {
    const samples = data.corners[index] ?? [];
    const material = data.materials[index] ?? 0;
    if (selected.has(index)) {
      const center = centers.get(index);
      if (center === undefined) throw new Error("Invalid subdivision topology");
      const faceAverage = mean(samples);
      face.forEach((vertex, corner) => {
        const next = at(face, corner + 1);
        const previous = at(face, corner - 1);
        const sample = at(samples, corner);
        quads.push(faces.length);
        faces.push([vertex, midpointOf(vertex, next), center, midpointOf(previous, vertex)]);
        corners.push([
          sample,
          mean([sample, at(samples, corner + 1)]),
          faceAverage,
          mean([at(samples, corner - 1), sample]),
        ]);
        materials.push(material);
      });
      return;
    }
    // An unselected neighbour keeps its corners and gains the midpoint of each edge a selected face shares with it.
    const loop: number[] = [];
    const loopCorners: Weights[] = [];
    face.forEach((vertex, corner) => {
      const next = at(face, corner + 1);
      loop.push(vertex);
      loopCorners.push(at(samples, corner));
      const midpoint = midpoints.get(edgeKey(vertex, next));
      if (midpoint === undefined) return;
      loop.push(midpoint);
      loopCorners.push(mean([at(samples, corner), at(samples, corner + 1)]));
    });
    faces.push(loop);
    corners.push(loopCorners);
    materials.push(material);
  });

  const triangles = faces.reduce((count, face) => count + face.length - 2, 0);
  if (triangles > MAX_MESH_OUTPUT_TRIANGLES)
    throw new Error(`Result exceeds the ${MAX_MESH_OUTPUT_TRIANGLES}-triangle geometry limit`);
  return {
    mesh: { positions, faces, channels: { positions: positionWeights, corners, materials } },
    selection: quads.map(String),
    walls: [],
  };
}
