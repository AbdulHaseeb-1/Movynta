import { Vector3, type BufferGeometry, type Mesh } from "three";
import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import { assertManifold, channels, edgeKey, point, readTopology, topology, type PolygonMesh } from "./meshTopology";

export type MeshModifier = { type: "geometry.bevel"; width: number; segments?: number } | { type: "geometry.subdivide"; levels: number };
import { blend, mean, type Weights } from "./meshWeights";
import { writeGeometry } from "./meshOutput";
import { bevelSurface } from "./meshBevel";

function average(values: readonly Vector3[]): Vector3 {
  const result = new Vector3(); for (const value of values) result.add(value);
  return result.multiplyScalar(1 / values.length);
}
function checkBudget(mesh: PolygonMesh): void {
  const triangles = mesh.faces.reduce((count, face) => count + face.length - 2, 0);
  if (triangles > MAX_MESH_OUTPUT_TRIANGLES) throw new Error(`Result exceeds the ${MAX_MESH_OUTPUT_TRIANGLES}-triangle geometry limit`);
}
function subdivide(mesh: PolygonMesh): PolygonMesh {
  const graph = topology(mesh); assertManifold(mesh, graph);
  if (graph.vertexFaces.some((faces) => faces.length > 64)) throw new Error("Subdivision supports vertex valence up to 64; simplify extraordinary vertices first");
  const data = channels(mesh);
  const weightsAt = (id: number): Weights => { const value = data.positions[id]; if (!value) throw new Error("Missing vertex interpolation"); return value; };
  const faceWeights = mesh.faces.map((face) => mean(face.map(weightsAt)));
  const positionWeights: Weights[] = [];
  const corners = mesh.faces.reduce((sum, face) => sum + face.length, 0);
  if (corners * 2 > MAX_MESH_OUTPUT_TRIANGLES) throw new Error("Subdivision would exceed the geometry limit; use fewer levels or a simpler mesh");
  const facePoints = mesh.faces.map((face) => average(face.map((id) => point(mesh, id))));
  const positions = mesh.positions.map((p, id) => {
    const edges = (graph.vertexEdges[id] ?? []).map((key) => graph.edges.get(key) ?? []);
    const boundary = edges.filter((edge) => edge.length === 1).map((edge) => {
      const half = edge[0]; if (!half) throw new Error("Missing boundary edge");
      return point(mesh, half.from === id ? half.to : half.from);
    });
    if (boundary.length === 2) {
      const neighbors = edges.filter((edge) => edge.length === 1).map((edge) => { const half = edge[0]; if (!half) throw new Error("Missing edge"); return weightsAt(half.from === id ? half.to : half.from); });
      positionWeights[id] = blend([[weightsAt(id), .75], [mean(neighbors), .25]]);
      return p.clone().multiplyScalar(.75).add(average(boundary).multiplyScalar(.25));
    }
    if (edges.length === 0) { positionWeights[id] = weightsAt(id); return p.clone(); }
    const faces = (graph.vertexFaces[id] ?? []).map((index) => {
      const value = facePoints[index]; if (!value) throw new Error("Missing face point"); return value;
    });
    const midpoints = edges.map((incident) => {
      const half = incident[0]; if (!half) throw new Error("Missing edge");
      return average([point(mesh, half.from), point(mesh, half.to)]);
    });
    const n = edges.length;
    const incidentFaces = (graph.vertexFaces[id] ?? []).map((index) => { const value = faceWeights[index]; if (!value) throw new Error("Missing face weights"); return value; });
    const edgeWeights = edges.map((incident) => { const half = incident[0]; if (!half) throw new Error("Missing edge"); return mean([weightsAt(half.from), weightsAt(half.to)]); });
    positionWeights[id] = blend([[mean(incidentFaces), 1 / n], [mean(edgeWeights), 2 / n], [weightsAt(id), (n - 3) / n]]);
    return average(faces).add(average(midpoints).multiplyScalar(2)).add(p.clone().multiplyScalar(n - 3)).multiplyScalar(1 / n);
  });
  const faceIds = facePoints.map((p, i) => { const value = faceWeights[i]; if (!value) throw new Error("Missing face weights"); positionWeights.push(value); return positions.push(p) - 1; });
  const edgeIds = new Map<string, number>();
  for (const [key, incident] of graph.edges) {
    const half = incident[0]; if (!half) continue;
    const values = [point(mesh, half.from), point(mesh, half.to)];
    if (incident.length === 2) for (const edge of incident) {
      const value = facePoints[edge.face]; if (value) values.push(value);
    }
    const weights = [weightsAt(half.from), weightsAt(half.to)];
    if (incident.length === 2) for (const edge of incident) { const value = faceWeights[edge.face]; if (value) weights.push(value); }
    positionWeights.push(mean(weights));
    edgeIds.set(key, positions.push(average(values)) - 1);
  }
  const faces: number[][] = []; const cornerWeights: Weights[][] = []; const materials: number[] = [];
  mesh.faces.forEach((face, index) => face.forEach((vertex, corner) => {
    const next = face[(corner + 1) % face.length]; const previous = face[(corner + face.length - 1) % face.length];
    const center = faceIds[index];
    const a = next === undefined ? undefined : edgeIds.get(edgeKey(vertex, next));
    const b = previous === undefined ? undefined : edgeIds.get(edgeKey(previous, vertex));
    if (a === undefined || b === undefined || center === undefined) throw new Error("Invalid subdivision topology");
    faces.push([vertex, a, center, b]);
    const samples = data.corners[index] ?? []; const at = samples[corner]; const after = samples[(corner + 1) % face.length]; const before = samples[(corner + face.length - 1) % face.length];
    if (!at || !after || !before) throw new Error("Missing corner attributes");
    cornerWeights.push([at, mean([at, after]), mean(samples), mean([before, at])]); materials.push(data.materials[index] ?? 0);
  }));
  return { positions, faces, channels: { positions: positionWeights, corners: cornerWeights, materials } };
}

/** Structural validation; materials and deformation data are retained by the evaluator. */
export function assertEditableMesh(mesh: Mesh): void {
  const positions = mesh.geometry.getAttribute("position");
  if (!positions || positions.itemSize !== 3) throw new Error("Mesh needs 3D positions");
}

export function modifyGeometry(geometry: BufferGeometry, modifier: MeshModifier): BufferGeometry {
  let mesh = readTopology(geometry);
  if (modifier.type === "geometry.bevel") mesh = bevelSurface(mesh, modifier.width, modifier.segments ?? 1);
  else {
    const projectedTriangles = mesh.faces.reduce((sum, face) => sum + face.length, 0) * 2 * 4 ** (modifier.levels - 1);
    if (projectedTriangles > MAX_MESH_OUTPUT_TRIANGLES) throw new Error("Subdivision would exceed the geometry limit; use fewer levels or a simpler mesh");
    for (let i = 0; i < modifier.levels; i += 1) mesh = subdivide(mesh);
  }
  checkBudget(mesh);
  return writeGeometry(geometry, mesh, modifier.type === "geometry.bevel" && (modifier.segments ?? 1) === 1);
}
