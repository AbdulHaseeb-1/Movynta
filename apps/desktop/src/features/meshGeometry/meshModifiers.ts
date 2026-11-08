import { Vector3, type BufferGeometry, type Mesh } from "three";
import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import {
  assertManifold,
  channels,
  continuityChannels,
  edgeKey,
  point,
  readTopology,
  topology,
  type ContinuityChannel,
  type PolygonMesh,
} from "./meshTopology";

/** How a subdivision modifier smooths: Catmull-Clark, linear or Loop. */
export type SubdivisionMethod = "catmull-clark" | "linear" | "loop";
/** The profile of a bevel: chamfer, round or circular. */
export type BevelProfile = "chamfer" | "round" | "circular";
/** A modifier that changes a mesh's geometry, such as a bevel or a subdivision. */
export type MeshModifier =
  | { type: "geometry.bevel"; width: number; segments?: number; profile?: BevelProfile; angle?: number }
  | { type: "geometry.subdivide"; levels: number; method?: SubdivisionMethod };
import { blend, evaluate, mean, type Weights } from "./meshWeights";
import { writeGeometry } from "./meshOutput";
import { bevelSurface } from "./meshBevel";
import { splitConcaveFaces, subdivideLinear, subdivideLoop } from "./meshSubdivision";

function average(values: readonly Vector3[]): Vector3 {
  const result = new Vector3();
  for (const value of values) result.add(value);
  return result.multiplyScalar(1 / values.length);
}
function checkBudget(mesh: PolygonMesh): void {
  const triangles = mesh.faces.reduce((count, face) => count + face.length - 2, 0);
  if (triangles > MAX_MESH_OUTPUT_TRIANGLES)
    throw new Error(`Result exceeds the ${MAX_MESH_OUTPUT_TRIANGLES}-triangle geometry limit`);
}
function samplesMatch(sources: readonly ContinuityChannel[], left: Weights, right: Weights): boolean {
  for (const source of sources)
    for (let component = 0; component < source.itemSize; component += 1)
      if (Math.abs(evaluate(source, left, component) - evaluate(source, right, component)) > 1e-5) return false;
  return true;
}
function subdivide(input: PolygonMesh, sources: readonly ContinuityChannel[]): PolygonMesh {
  // Concave faces are triangulated first: the face-centre point would otherwise fall outside the polygon.
  const mesh = splitConcaveFaces(input);
  const graph = topology(mesh);
  assertManifold(mesh, graph);
  if (graph.vertexFaces.some((faces) => faces.length > 64))
    throw new Error("Subdivision supports vertex valence up to 64; simplify extraordinary vertices first");
  const data = channels(mesh);
  const weightsAt = (id: number): Weights => {
    const value = data.positions[id];
    if (!value) throw new Error("Missing vertex interpolation");
    return value;
  };
  const cornerOn = (faceIndex: number, vertexId: number): Weights => {
    const face = mesh.faces[faceIndex];
    if (!face) throw new Error("Missing face");
    const sample = data.corners[faceIndex]?.[face.indexOf(vertexId)];
    if (!sample) throw new Error("Missing corner attributes");
    return sample;
  };
  const faceWeights = mesh.faces.map((face) => mean(face.map(weightsAt)));
  const faceCornerAverage = mesh.faces.map((_, index) => mean(data.corners[index] ?? []));
  const positionWeights: Weights[] = [];
  const corners = mesh.faces.reduce((sum, face) => sum + face.length, 0);
  if (corners * 2 > MAX_MESH_OUTPUT_TRIANGLES)
    throw new Error("Subdivision would exceed the geometry limit; use fewer levels or a simpler mesh");
  const facePoints = mesh.faces.map((face) => average(face.map((id) => point(mesh, id))));
  const positions = mesh.positions.map((p, id) => {
    const edges = (graph.vertexEdges[id] ?? []).map((key) => graph.edges.get(key) ?? []);
    const boundary = edges
      .filter((edge) => edge.length === 1)
      .map((edge) => {
        const half = edge[0];
        if (!half) throw new Error("Missing boundary edge");
        return point(mesh, half.from === id ? half.to : half.from);
      });
    if (boundary.length === 2) {
      const neighbors = edges
        .filter((edge) => edge.length === 1)
        .map((edge) => {
          const half = edge[0];
          if (!half) throw new Error("Missing edge");
          return weightsAt(half.from === id ? half.to : half.from);
        });
      positionWeights[id] = blend([
        [weightsAt(id), 0.75],
        [mean(neighbors), 0.25],
      ]);
      return p.clone().multiplyScalar(0.75).add(average(boundary).multiplyScalar(0.25));
    }
    if (edges.length === 0) {
      positionWeights[id] = weightsAt(id);
      return p.clone();
    }
    const faces = (graph.vertexFaces[id] ?? []).map((index) => {
      const value = facePoints[index];
      if (!value) throw new Error("Missing face point");
      return value;
    });
    const midpoints = edges.map((incident) => {
      const half = incident[0];
      if (!half) throw new Error("Missing edge");
      return average([point(mesh, half.from), point(mesh, half.to)]);
    });
    const n = edges.length;
    const incidentFaces = (graph.vertexFaces[id] ?? []).map((index) => {
      const value = faceWeights[index];
      if (!value) throw new Error("Missing face weights");
      return value;
    });
    const edgeWeights = edges.map((incident) => {
      const half = incident[0];
      if (!half) throw new Error("Missing edge");
      return mean([weightsAt(half.from), weightsAt(half.to)]);
    });
    positionWeights[id] = blend([
      [mean(incidentFaces), 1 / n],
      [mean(edgeWeights), 2 / n],
      [weightsAt(id), (n - 3) / n],
    ]);
    return average(faces)
      .add(average(midpoints).multiplyScalar(2))
      .add(p.clone().multiplyScalar(n - 3))
      .multiplyScalar(1 / n);
  });
  const faceIds = facePoints.map((p, i) => {
    const value = faceWeights[i];
    if (!value) throw new Error("Missing face weights");
    positionWeights.push(value);
    return positions.push(p) - 1;
  });
  const edgeIds = new Map<string, number>();
  for (const [key, incident] of graph.edges) {
    const half = incident[0];
    if (!half) continue;
    const values = [point(mesh, half.from), point(mesh, half.to)];
    if (incident.length === 2)
      for (const edge of incident) {
        const value = facePoints[edge.face];
        if (value) values.push(value);
      }
    const weights = [weightsAt(half.from), weightsAt(half.to)];
    if (incident.length === 2)
      for (const edge of incident) {
        const value = faceWeights[edge.face];
        if (value) weights.push(value);
      }
    positionWeights.push(mean(weights));
    edgeIds.set(key, positions.push(average(values)) - 1);
  }
  const vertexAttribute = (faceIndex: number, vertexId: number): Weights => {
    const self = cornerOn(faceIndex, vertexId);
    const edges = (graph.vertexEdges[vertexId] ?? []).map((key) => graph.edges.get(key) ?? []);
    const boundary = edges.filter((edge) => edge.length === 1);
    if (boundary.length === 2) {
      const neighbors = boundary.map((edge) => {
        const half = edge[0];
        if (!half) throw new Error("Missing boundary edge");
        return cornerOn(half.face, half.from === vertexId ? half.to : half.from);
      });
      return blend([
        [self, 0.75],
        [mean(neighbors), 0.25],
      ]);
    }
    if (edges.length === 0) return self;
    const incident = graph.vertexFaces[vertexId] ?? [];
    const continuous = incident.every(
      (index) => index === faceIndex || samplesMatch(sources, self, cornerOn(index, vertexId)),
    );
    if (!continuous) {
      const face = mesh.faces[faceIndex] ?? [];
      const corner = face.indexOf(vertexId);
      const before = data.corners[faceIndex]?.[(corner + face.length - 1) % face.length];
      const after = data.corners[faceIndex]?.[(corner + 1) % face.length];
      if (!before || !after) return self;
      return blend([
        [self, 0.75],
        [before, 0.125],
        [after, 0.125],
      ]);
    }
    const n = edges.length;
    const faceSamples = incident
      .map((index) => faceCornerAverage[index])
      .filter((value): value is Weights => value !== undefined);
    const edgeSamples = edges.map((incidentEdges) => {
      const half = incidentEdges[0];
      if (!half) throw new Error("Missing edge");
      return mean([cornerOn(half.face, vertexId), cornerOn(half.face, half.from === vertexId ? half.to : half.from)]);
    });
    return blend([
      [mean(faceSamples), 1 / n],
      [mean(edgeSamples), 2 / n],
      [self, (n - 3) / n],
    ]);
  };
  const edgeAttribute = (faceIndex: number, from: number, to: number): Weights => {
    const here = cornerOn(faceIndex, from);
    const there = cornerOn(faceIndex, to);
    const incident = graph.edges.get(edgeKey(from, to)) ?? [];
    const other = incident.length === 2 ? incident.find((edge) => edge.face !== faceIndex) : undefined;
    if (
      !other ||
      !samplesMatch(sources, here, cornerOn(other.face, from)) ||
      !samplesMatch(sources, there, cornerOn(other.face, to))
    )
      return mean([here, there]);
    const hereFace = faceCornerAverage[faceIndex];
    const otherFace = faceCornerAverage[other.face];
    if (!hereFace || !otherFace) return mean([here, there]);
    return mean([here, there, hereFace, otherFace]);
  };
  const faces: number[][] = [];
  const cornerWeights: Weights[][] = [];
  const materials: number[] = [];
  const faceSources: number[] | undefined = mesh.faceSources ? [] : undefined;
  mesh.faces.forEach((face, index) =>
    face.forEach((vertex, corner) => {
      const next = face[(corner + 1) % face.length];
      const previous = face[(corner + face.length - 1) % face.length];
      const center = faceIds[index];
      const a = next === undefined ? undefined : edgeIds.get(edgeKey(vertex, next));
      const b = previous === undefined ? undefined : edgeIds.get(edgeKey(previous, vertex));
      if (a === undefined || b === undefined || center === undefined || next === undefined || previous === undefined)
        throw new Error("Invalid subdivision topology");
      faces.push([vertex, a, center, b]);
      faceSources?.push(mesh.faceSources?.[index] ?? -1);
      const faceAverage = faceCornerAverage[index];
      if (!faceAverage) throw new Error("Missing corner attributes");
      cornerWeights.push([
        vertexAttribute(index, vertex),
        edgeAttribute(index, vertex, next),
        faceAverage,
        edgeAttribute(index, previous, vertex),
      ]);
      materials.push(data.materials[index] ?? 0);
    }),
  );
  return {
    positions,
    faces,
    channels: { positions: positionWeights, corners: cornerWeights, materials },
    ...(faceSources ? { faceSources } : {}),
  };
}

/** Structural validation; materials and deformation data are retained by the evaluator. */
export function assertEditableMesh(mesh: Mesh): void {
  const positions = mesh.geometry.getAttribute("position");
  if (!positions || positions.itemSize !== 3) throw new Error("Mesh needs 3D positions");
}

/** Applies one modifier, such as a bevel or a subdivision, to a geometry and returns the result. */
export function modifyGeometry(geometry: BufferGeometry, modifier: MeshModifier, startsAtBase = false): BufferGeometry {
  let mesh = readTopology(geometry);
  if (startsAtBase) mesh = { ...mesh, faceSources: mesh.faces.map((_, index) => index) };
  const profile = modifier.type === "geometry.bevel" ? (modifier.profile ?? "round") : "round";
  const segments = modifier.type === "geometry.bevel" ? (modifier.segments ?? 1) : 1;
  if (modifier.type === "geometry.bevel")
    mesh = bevelSurface(mesh, modifier.width, segments, profile, modifier.angle ?? 0);
  else {
    const projectedTriangles = mesh.faces.reduce((sum, face) => sum + face.length, 0) * 2 * 4 ** (modifier.levels - 1);
    if (projectedTriangles > MAX_MESH_OUTPUT_TRIANGLES)
      throw new Error("Subdivision would exceed the geometry limit; use fewer levels or a simpler mesh");
    const sources = continuityChannels(geometry);
    const method = modifier.method ?? "catmull-clark";
    for (let i = 0; i < modifier.levels; i += 1) {
      if (method === "linear") mesh = subdivideLinear(mesh);
      else if (method === "loop") mesh = subdivideLoop(mesh, sources);
      else mesh = subdivide(mesh, sources);
    }
  }
  checkBudget(mesh);
  return writeGeometry(geometry, mesh, modifier.type === "geometry.bevel" && (profile === "chamfer" || segments === 1));
}
