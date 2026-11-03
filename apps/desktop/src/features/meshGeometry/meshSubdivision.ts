import { Vector3 } from "three";
import { triangulate } from "./meshOutput";
import { assertManifold, channels, edgeKey, faceNormal, point, topology, type ContinuityChannel, type PolygonMesh } from "./meshTopology";
import { blend, evaluate, mean, type Weights } from "./meshWeights";

/** Original Loop vertex weight. Valence 3 is exactly 3/16. */
function loopBeta(valence: number): number {
  if (valence === 3) return 3 / 16;
  const cosine = Math.cos((2 * Math.PI) / valence);
  return (5 / 8 - (3 / 8 + cosine / 4) ** 2) / valence;
}
function average(values: readonly Vector3[]): Vector3 {
  const result = new Vector3();
  for (const value of values) result.add(value);
  return result.multiplyScalar(1 / values.length);
}
function samplesMatch(sources: readonly ContinuityChannel[], left: Weights, right: Weights): boolean {
  for (const source of sources) for (let component = 0; component < source.itemSize; component += 1)
    if (Math.abs(evaluate(source, left, component) - evaluate(source, right, component)) > 1e-5) return false;
  return true;
}
/** A face is convex when every corner turns the same way as its normal. */
function isConvex(mesh: PolygonMesh, face: readonly number[]): boolean {
  const normal = faceNormal(mesh, face);
  for (let i = 0; i < face.length; i += 1) {
    const a = point(mesh, face[i]); const b = point(mesh, face[(i + 1) % face.length]); const c = point(mesh, face[(i + 2) % face.length]);
    const first = b.clone().sub(a); const second = c.clone().sub(b);
    const scale = first.length() * second.length();
    if (scale > 0 && first.cross(second).dot(normal) < -1e-9 * scale) return false;
  }
  return true;
}

/**
 * Splits the faces selected by `shouldSplit` into triangles and keeps every other face as it is.
 * Corner attributes follow each triangle corner, so UVs, colors and materials are preserved.
 */
function splitFaces(mesh: PolygonMesh, shouldSplit: (face: readonly number[]) => boolean): PolygonMesh {
  const data = channels(mesh);
  const faces: number[][] = [];
  const corners: Weights[][] = [];
  const materials: number[] = [];
  mesh.faces.forEach((face, faceIndex) => {
    const samples = data.corners[faceIndex];
    if (!samples || samples.length !== face.length) throw new Error("Missing corner attributes");
    if (!shouldSplit(face)) {
      faces.push([...face]); corners.push(samples); materials.push(data.materials[faceIndex] ?? 0);
      return;
    }
    const triangles = triangulate(mesh, face);
    if (triangles.length === 0) throw new Error("Mesh has a degenerate face");
    for (const triangle of triangles) {
      const [a, b, c] = triangle;
      const idA = a === undefined ? undefined : face[a];
      const idB = b === undefined ? undefined : face[b];
      const idC = c === undefined ? undefined : face[c];
      const sampleA = a === undefined ? undefined : samples[a];
      const sampleB = b === undefined ? undefined : samples[b];
      const sampleC = c === undefined ? undefined : samples[c];
      if (idA === undefined || idB === undefined || idC === undefined || !sampleA || !sampleB || !sampleC) throw new Error("Invalid triangle");
      faces.push([idA, idB, idC]);
      corners.push([sampleA, sampleB, sampleC]);
      materials.push(data.materials[faceIndex] ?? 0);
    }
  });
  return { positions: mesh.positions, faces, channels: { positions: data.positions, corners, materials } };
}

function asTriangles(mesh: PolygonMesh): PolygonMesh {
  return splitFaces(mesh, () => true);
}

/**
 * Subdivision places a new point at the centre of each face. For a concave face that point can lie
 * outside the polygon (on an L or U notch), so those faces are triangulated first. Convex faces are kept.
 */
export function splitConcaveFaces(mesh: PolygonMesh): PolygonMesh {
  return splitFaces(mesh, (face) => !isConvex(mesh, face));
}

/** Midpoint subdivision. Original vertices stay where they are. */
export function subdivideLinear(input: PolygonMesh): PolygonMesh {
  const mesh = splitConcaveFaces(input);
  const graph = topology(mesh);
  assertManifold(mesh, graph);
  const data = channels(mesh);
  const weightsAt = (id: number): Weights => data.positions[id] ?? new Map();
  const cornerOn = (faceIndex: number, vertexId: number): Weights => {
    const face = mesh.faces[faceIndex];
    const sample = face ? data.corners[faceIndex]?.[face.indexOf(vertexId)] : undefined;
    if (!sample) throw new Error("Missing corner attributes");
    return sample;
  };
  const positions = mesh.positions.map((position) => position.clone());
  const positionWeights: Weights[] = mesh.positions.map((_, id) => weightsAt(id));
  const edgeIds = new Map<string, number>();
  for (const [key, incident] of graph.edges) {
    const half = incident[0];
    if (!half) continue;
    const id = positions.push(point(mesh, half.from).clone().add(point(mesh, half.to)).multiplyScalar(0.5)) - 1;
    positionWeights.push(mean([weightsAt(half.from), weightsAt(half.to)]));
    edgeIds.set(key, id);
  }
  const centers = mesh.faces.map((face) => {
    const id = positions.push(average(face.map((vertex) => point(mesh, vertex)))) - 1;
    positionWeights.push(mean(face.map(weightsAt)));
    return id;
  });
  const faces: number[][] = [];
  const cornerWeights: Weights[][] = [];
  const materials: number[] = [];
  mesh.faces.forEach((face, index) => {
    const center = centers[index];
    const faceAverage = mean(data.corners[index] ?? []);
    if (center === undefined) throw new Error("Invalid subdivision topology");
    for (let i = 0; i < face.length; i += 1) {
      const vertex = face[i];
      const next = face[(i + 1) % face.length];
      const previous = face[(i + face.length - 1) % face.length];
      const towardNext = vertex === undefined || next === undefined ? undefined : edgeIds.get(edgeKey(vertex, next));
      const towardPrevious = vertex === undefined || previous === undefined ? undefined : edgeIds.get(edgeKey(previous, vertex));
      if (vertex === undefined || next === undefined || previous === undefined || towardNext === undefined || towardPrevious === undefined) throw new Error("Invalid subdivision topology");
      faces.push([vertex, towardNext, center, towardPrevious]);
      cornerWeights.push([
        cornerOn(index, vertex),
        mean([cornerOn(index, vertex), cornerOn(index, next)]),
        faceAverage,
        mean([cornerOn(index, previous), cornerOn(index, vertex)]),
      ]);
      materials.push(data.materials[index] ?? 0);
    }
  });
  return { positions, faces, channels: { positions: positionWeights, corners: cornerWeights, materials } };
}

/** Loop subdivision. Faces with more than three corners are triangulated first. */
export function subdivideLoop(mesh: PolygonMesh, sources: readonly ContinuityChannel[]): PolygonMesh {
  const triangles = asTriangles(mesh);
  const graph = topology(triangles);
  assertManifold(triangles, graph);
  if (graph.vertexFaces.some((faces) => faces.length > 64)) throw new Error("Subdivision supports vertex valence up to 64; simplify extraordinary vertices first");
  const data = channels(triangles);
  const weightsAt = (id: number): Weights => data.positions[id] ?? new Map();
  const cornerOn = (faceIndex: number, vertexId: number): Weights => {
    const face = triangles.faces[faceIndex];
    const sample = face ? data.corners[faceIndex]?.[face.indexOf(vertexId)] : undefined;
    if (!sample) throw new Error("Missing corner attributes");
    return sample;
  };
  const neighborsOf = (id: number): number[] => (graph.vertexEdges[id] ?? []).flatMap((key) => {
    const half = graph.edges.get(key)?.[0];
    if (!half) return [];
    return [half.from === id ? half.to : half.from];
  });
  const boundaryNeighbors = (id: number): number[] => (graph.vertexEdges[id] ?? []).flatMap((key) => {
    const incident = graph.edges.get(key) ?? [];
    if (incident.length !== 1) return [];
    const half = incident[0];
    if (!half) return [];
    return [half.from === id ? half.to : half.from];
  });
  const cornerFromNeighbor = (faceIndex: number, vertex: number, neighbor: number): Weights => {
    const face = triangles.faces[faceIndex];
    if (face?.includes(neighbor)) return cornerOn(faceIndex, neighbor);
    const here = cornerOn(faceIndex, vertex);
    for (const candidate of graph.vertexFaces[vertex] ?? []) {
      const other = triangles.faces[candidate];
      if (!other?.includes(neighbor) || !samplesMatch(sources, here, cornerOn(candidate, vertex))) continue;
      return cornerOn(candidate, neighbor);
    }
    return here;
  };
  const continuous = (id: number): boolean => {
    const faces = graph.vertexFaces[id] ?? [];
    const first = faces[0];
    if (first === undefined) return true;
    const sample = cornerOn(first, id);
    return faces.every((face) => samplesMatch(sources, sample, cornerOn(face, id)));
  };
  const positions = triangles.positions.map((position) => position.clone());
  const positionWeights: Weights[] = triangles.positions.map((_, id) => weightsAt(id));
  triangles.positions.forEach((position, id) => {
    const boundary = boundaryNeighbors(id);
    if (boundary.length === 2) {
      const [first, second] = boundary;
      if (first === undefined || second === undefined) throw new Error("Missing boundary edge");
      positions[id] = position.clone().multiplyScalar(0.75).add(point(triangles, first).clone().add(point(triangles, second)).multiplyScalar(0.125));
      positionWeights[id] = blend([[weightsAt(id), 0.75], [weightsAt(first), 0.125], [weightsAt(second), 0.125]]);
      return;
    }
    const neighbors = neighborsOf(id);
    const valence = neighbors.length;
    if (valence < 3 || valence > 64) throw new Error("Subdivision supports vertex valence up to 64; simplify extraordinary vertices first");
    const beta = loopBeta(valence);
    const next = position.clone().multiplyScalar(1 - valence * beta);
    for (const neighbor of neighbors) next.addScaledVector(point(triangles, neighbor), beta);
    positions[id] = next;
    positionWeights[id] = blend([[weightsAt(id), 1 - valence * beta], ...neighbors.map((neighbor): [Weights, number] => [weightsAt(neighbor), beta])]);
  });
  const edgeIds = new Map<string, number>();
  for (const [key, incident] of graph.edges) {
    const [first, second] = incident;
    if (!first) continue;
    const start = point(triangles, first.from);
    const end = point(triangles, first.to);
    let position: Vector3;
    let weights: Weights;
    if (!second) {
      position = start.clone().add(end).multiplyScalar(0.5);
      weights = mean([weightsAt(first.from), weightsAt(first.to)]);
    } else {
      const left = opposite(triangles.faces[first.face], first.from, first.to);
      const right = opposite(triangles.faces[second.face], first.from, first.to);
      position = start.clone().multiplyScalar(3 / 8).addScaledVector(end, 3 / 8).addScaledVector(point(triangles, left), 1 / 8).addScaledVector(point(triangles, right), 1 / 8);
      weights = blend([[weightsAt(first.from), 3 / 8], [weightsAt(first.to), 3 / 8], [weightsAt(left), 1 / 8], [weightsAt(right), 1 / 8]]);
    }
    edgeIds.set(key, positions.push(position) - 1);
    positionWeights.push(weights);
  }
  const vertexAttribute = (faceIndex: number, id: number): Weights => {
    const here = cornerOn(faceIndex, id);
    const boundary = boundaryNeighbors(id);
    if (boundary.length === 2 && continuous(id)) {
      const [first, second] = boundary;
      if (first === undefined || second === undefined) throw new Error("Missing boundary edge");
      return blend([[here, 0.75], [cornerFromNeighbor(faceIndex, id, first), 0.125], [cornerFromNeighbor(faceIndex, id, second), 0.125]]);
    }
    const neighbors = neighborsOf(id);
    if (boundary.length === 0 && continuous(id) && neighbors.length >= 3) {
      const beta = loopBeta(neighbors.length);
      return blend([[here, 1 - neighbors.length * beta], ...neighbors.map((neighbor): [Weights, number] => [cornerFromNeighbor(faceIndex, id, neighbor), beta])]);
    }
    const face = triangles.faces[faceIndex];
    if (!face) throw new Error("Missing face");
    const at = face.indexOf(id);
    const previous = face[(at + face.length - 1) % face.length];
    const next = face[(at + 1) % face.length];
    if (previous === undefined || next === undefined) throw new Error("Missing corner attributes");
    return blend([[here, 0.75], [cornerOn(faceIndex, previous), 0.125], [cornerOn(faceIndex, next), 0.125]]);
  };
  const edgeAttribute = (faceIndex: number, from: number, to: number): Weights => {
    const hereFrom = cornerOn(faceIndex, from);
    const hereTo = cornerOn(faceIndex, to);
    const other = (graph.edges.get(edgeKey(from, to)) ?? []).find((half) => half.face !== faceIndex);
    if (!other || !samplesMatch(sources, hereFrom, cornerOn(other.face, from)) || !samplesMatch(sources, hereTo, cornerOn(other.face, to))) return mean([hereFrom, hereTo]);
    return blend([
      [hereFrom, 3 / 8], [hereTo, 3 / 8],
      [cornerOn(faceIndex, opposite(triangles.faces[faceIndex], from, to)), 1 / 8],
      [cornerOn(other.face, opposite(triangles.faces[other.face], from, to)), 1 / 8],
    ]);
  };
  const faces: number[][] = [];
  const cornerWeights: Weights[][] = [];
  const materials: number[] = [];
  triangles.faces.forEach((face, index) => {
    const v0 = face[0];
    const v1 = face[1];
    const v2 = face[2];
    if (v0 === undefined || v1 === undefined || v2 === undefined) throw new Error("Invalid subdivision topology");
    const e01 = edgeIds.get(edgeKey(v0, v1));
    const e12 = edgeIds.get(edgeKey(v1, v2));
    const e20 = edgeIds.get(edgeKey(v2, v0));
    if (e01 === undefined || e12 === undefined || e20 === undefined) throw new Error("Invalid subdivision topology");
    const corner0: number = v0;
    const corner1: number = v1;
    const corner2: number = v2;
    const edge01: number = e01;
    const edge12: number = e12;
    const edge20: number = e20;
    const sampleAt = (id: number): Weights => {
      if (id === corner0 || id === corner1 || id === corner2) return vertexAttribute(index, id);
      if (id === edge01) return edgeAttribute(index, corner0, corner1);
      if (id === edge12) return edgeAttribute(index, corner1, corner2);
      return edgeAttribute(index, corner2, corner0);
    };
    const split: readonly (readonly [number, number, number])[] = [[corner0, edge01, edge20], [edge01, corner1, edge12], [edge20, edge12, corner2], [edge01, edge12, edge20]];
    for (const [a, b, c] of split) {
      faces.push([a, b, c]);
      cornerWeights.push([sampleAt(a), sampleAt(b), sampleAt(c)]);
      materials.push(data.materials[index] ?? 0);
    }
  });
  return { positions, faces, channels: { positions: positionWeights, corners: cornerWeights, materials } };
}
function opposite(face: readonly number[] | undefined, from: number, to: number): number {
  const vertex = face?.find((id) => id !== from && id !== to);
  if (vertex === undefined) throw new Error("Missing opposite vertex");
  return vertex;
}
