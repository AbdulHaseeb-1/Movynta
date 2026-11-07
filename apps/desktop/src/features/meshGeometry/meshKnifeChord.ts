import type { BufferGeometry } from "three";
import { channels, edgeKey, point, type PolygonMesh } from "./meshTopology";
import { blend, type Weights } from "./meshWeights";
import { validateKnifeFace } from "./meshKnifeAttributes";
import { validateKnifeChord } from "./meshKnifeContainment";
import { topologyResult } from "./meshTopologyEdit";

/** An interior edge point, measured from the edge's lower-numbered vertex. */
export interface KnifeEdgePoint {
  edge: string;
  factor: number;
}
/** A knife point on a vertex. */
export interface KnifeVertexPoint {
  vertex: string;
}
/** A knife point: on a vertex, or on an edge. */
export type KnifePoint = KnifeEdgePoint | KnifeVertexPoint;
interface SplitPoint extends KnifeEdgePoint {
  id: number;
  from: number;
  to: number;
}
interface Corner {
  id: number;
  sample: Weights;
}
/** The options of one knife cut across a face. */
export interface KnifeChordOptions {
  /** Check the whole result here. A caller that cuts several times in a row turns this off and checks once at the end. */
  validate?: boolean;
}

/**
 * The faces that use each wanted edge, from one scan of the face list. A cut needs only the two edges it ends on,
 * so building the whole string-keyed edge map of the mesh (20 ms at 16,000 faces) would be most of its cost.
 */
function facesUsing(mesh: PolygonMesh, wanted: readonly string[]): Map<string, number[]> {
  const pairs = wanted.map((key) => {
    const [a, b] = key.split("_").map(Number);
    return { key, a: a ?? -1, b: b ?? -1 };
  });
  const found = new Map<string, number[]>(pairs.map(({ key }) => [key, []]));
  mesh.faces.forEach((face, index) => {
    for (let corner = 0; corner < face.length; corner += 1) {
      const u = face[corner],
        v = face[(corner + 1) % face.length];
      if (u === undefined || v === undefined) continue;
      const low = u < v ? u : v,
        high = u < v ? v : u;
      for (const pair of pairs) if (pair.a === low && pair.b === high) found.get(pair.key)?.push(index);
    }
  });
  return found;
}

/**
 * Split one polygon with a chord between two distinct boundary edges. Split both incident faces
 * at each endpoint to retain shared connectivity and interpolate each face's corner samples.
 */
export function knifeChord(
  mesh: PolygonMesh,
  faceId: number,
  start: KnifePoint,
  end: KnifePoint,
  source: BufferGeometry,
  options: KnifeChordOptions = {},
) {
  const face = mesh.faces[faceId];
  if (!Number.isInteger(faceId) || !face) throw new Error("Choose a valid face");
  validateKnifeFace(mesh, faceId, source);
  if ("edge" in start && "edge" in end && start.edge === end.edge)
    throw new Error("The cut endpoints must lie on different edges");
  const data = channels(mesh);
  const onEdge = facesUsing(
    mesh,
    [start, end].flatMap((entry) => ("edge" in entry ? [entry.edge] : [])),
  );
  const positions = mesh.positions.slice(),
    weights = data.positions.slice();
  const splits = new Map<string, SplitPoint>();
  const resolve = (entry: KnifePoint): number => {
    if ("vertex" in entry) {
      if (!/^(0|[1-9]\d{0,9})$/.test(entry.vertex) || !face.includes(Number(entry.vertex)))
        throw new Error("Cut vertex must be on the face boundary");
      return Number(entry.vertex);
    }
    const match = /^(0|[1-9]\d{0,9})_(0|[1-9]\d{0,9})$/.exec(entry.edge);
    if (!match) throw new Error("Choose canonical edge IDs");
    const from = Number(match[1]),
      to = Number(match[2]);
    const incident = onEdge.get(entry.edge);
    if (from >= to || !incident || !incident.includes(faceId))
      throw new Error("Both cut endpoints must lie on the face boundary");
    if (incident.length > 2) throw new Error("Knife cuts require manifold edges");
    if (!Number.isFinite(entry.factor) || entry.factor <= 1e-8 || entry.factor >= 1 - 1e-8)
      throw new Error("Cut factors must be strictly inside each edge");
    const id = positions.length;
    positions.push(point(mesh, from).clone().lerp(point(mesh, to), entry.factor));
    weights.push(
      blend([
        [data.positions[from] ?? new Map(), 1 - entry.factor],
        [data.positions[to] ?? new Map(), entry.factor],
      ]),
    );
    splits.set(entry.edge, { ...entry, from, to, id });
    return id;
  };
  const first = resolve(start),
    second = resolve(end);
  if (first === second) throw new Error("Cut endpoints must be distinct");
  const aPoint = positions[first],
    bPoint = positions[second];
  if (!aPoint || !bPoint) throw new Error("Missing cut endpoints");
  const output: number[][] = [],
    corners: Weights[][] = [],
    materials: number[] = [];
  const affected = new Set<number>([faceId]);
  for (const edge of splits.keys()) for (const neighbor of onEdge.get(edge) ?? []) affected.add(neighbor);
  for (const id of affected) if (id !== faceId) validateKnifeFace(mesh, id, source);
  mesh.faces.forEach((polygon, polygonId) => {
    const samples = data.corners[polygonId];
    if (!samples || samples.length !== polygon.length) throw new Error("Missing corner attributes");
    if (!affected.has(polygonId)) {
      output.push(polygon);
      corners.push(samples);
      materials.push(data.materials[polygonId] ?? 0);
      return;
    }
    const expanded: Corner[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const from = polygon[i],
        to = polygon[(i + 1) % polygon.length],
        a = samples[i],
        b = samples[(i + 1) % polygon.length];
      if (from === undefined || to === undefined || !a || !b) throw new Error("Invalid polygon boundary");
      expanded.push({ id: from, sample: a });
      const split = splits.get(edgeKey(from, to));
      if (split) {
        const t = split.from === from ? split.factor : 1 - split.factor;
        expanded.push({
          id: split.id,
          sample: blend([
            [a, 1 - t],
            [b, t],
          ]),
        });
      }
    }
    const append = (part: Corner[]) => {
      output.push(part.map((corner) => corner.id));
      corners.push(part.map((corner) => corner.sample));
      materials.push(data.materials[polygonId] ?? 0);
    };
    if (polygonId !== faceId) {
      append(expanded);
      return;
    }
    const a = expanded.findIndex((corner) => corner.id === first),
      b = expanded.findIndex((corner) => corner.id === second);
    if (a < 0 || b < 0) throw new Error("Cut endpoints are not on the face");
    const low = Math.min(a, b),
      high = Math.max(a, b);
    if (high - low < 2 || expanded.length - (high - low) < 2)
      throw new Error("Cut cannot follow an existing boundary edge");
    validateKnifeChord(mesh, face, aPoint, bPoint);
    append(expanded.slice(low, high + 1));
    append([...expanded.slice(high), ...expanded.slice(0, low + 1)]);
  });
  const candidate: PolygonMesh = { positions, faces: output, channels: { positions: weights, corners, materials } };
  if (options.validate === false) return { mesh: candidate, selection: [edgeKey(first, second)], walls: [] };
  return topologyResult(mesh, candidate, [edgeKey(first, second)]);
}
