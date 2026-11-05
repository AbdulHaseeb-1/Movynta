import { MAX_MESH_OUTPUT_TRIANGLES } from "@movynta/editor-protocol";
import { channels, edgeKey, point, topology, type PolygonMesh } from "./meshTopology";
import { blend, type Weights } from "./meshWeights";
import { topologyResult } from "./meshTopologyEdit";

interface SplitEdge { from: number; to: number; points: { id: number; t: number }[] }
/** Follow opposite edges through a quad strip; reject branching, crossing and non-quad rings. */
export function loopCut(mesh: PolygonMesh, seed: string, cuts: number, factor = 0.5) {
  if (!Number.isInteger(cuts) || cuts < 1 || cuts > 16 || !(factor > 0 && factor < 1)) throw new Error("Use 1–16 cuts and a factor strictly between 0 and 1");
  if (cuts !== 1 && factor !== 0.5) throw new Error("Multiple cuts use even spacing; factor only applies to one cut");
  const graph = topology(mesh), data = channels(mesh);
  const match = /^(0|[1-9]\d{0,9})_(0|[1-9]\d{0,9})$/.exec(seed);
  if (!match || Number(match[1]) >= Number(match[2]) || !graph.edges.has(seed)) throw new Error("Choose a canonical base edge for the quad ring");
  const edges = new Map<string, SplitEdge>([[seed, { from: Number(match[1]), to: Number(match[2]), points: [] }]]);
  const queue = [seed], faces = new Map<number, string>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor]; if (!key) continue;
    const split = edges.get(key); if (!split) throw new Error("Missing ring edge");
    const incident = graph.edges.get(key) ?? [];
    if (incident.length > 2) throw new Error("Loop cut requires manifold edges");
    for (const half of incident) {
      const face = mesh.faces[half.face];
      if (!face || face.length !== 4) throw new Error("Loop cut requires a strip of quad faces; a triangle or polygon ends this ring");
      const i = face.findIndex((v, index) => edgeKey(v, face[(index + 1) % 4] ?? -1) === key);
      const a = face[(i + 2) % 4], b = face[(i + 3) % 4];
      if (i < 0 || a === undefined || b === undefined) throw new Error("Invalid quad ring");
      const opposite = edgeKey(a, b), previous = faces.get(half.face);
      if (previous && previous !== key && previous !== opposite) throw new Error("Quad ring crosses itself");
      faces.set(half.face, key);
      const forward = face[i] === split.from;
      const from = forward ? b : a, to = forward ? a : b;
      const known = edges.get(opposite);
      if (known && (known.from !== from || known.to !== to)) throw new Error("Quad ring has inconsistent orientation");
      if (!known) { edges.set(opposite, { from, to, points: [] }); queue.push(opposite); }
    }
  }
  const triangles = mesh.faces.reduce((sum, face) => sum + face.length - 2, 0) + faces.size * cuts * 2;
  if (triangles > MAX_MESH_OUTPUT_TRIANGLES) throw new Error("Loop cut exceeds the geometry output budget");
  const positions = mesh.positions.slice(), weights = data.positions.slice();
  for (const split of edges.values()) for (let i = 1; i <= cuts; i += 1) {
    const t = cuts === 1 ? factor : i / (cuts + 1), id = positions.length;
    positions.push(point(mesh, split.from).clone().lerp(point(mesh, split.to), t));
    weights.push(blend([[data.positions[split.from] ?? new Map(), 1 - t], [data.positions[split.to] ?? new Map(), t]]));
    split.points.push({ id, t });
  }
  const onEdge = (from: number, to: number, wa: Weights, wb: Weights) => {
    const split = edges.get(edgeKey(from, to)); if (!split) throw new Error("Missing opposite cut edge");
    const values = split.from === from ? split.points : split.points.slice().reverse();
    return [{ id: from, sample: wa }, ...values.map(({ id, t }) => {
      const ratio = split.from === from ? t : 1 - t;
      return { id, sample: blend([[wa, 1 - ratio], [wb, ratio]]) };
    }), { id: to, sample: wb }];
  };
  const output: number[][] = [], corners: Weights[][] = [], materials: number[] = [], selection = new Set<string>();
  mesh.faces.forEach((face, faceId) => {
    const entering = faces.get(faceId), samples = data.corners[faceId] ?? [];
    if (!entering) { output.push(face); corners.push(samples); materials.push(data.materials[faceId] ?? 0); return; }
    const start = face.findIndex((v, i) => edgeKey(v, face[(i + 1) % 4] ?? -1) === entering);
    const vertex = (offset: number) => { const id = face[(start + offset) % 4]; if (id === undefined) throw new Error("Invalid cut face"); return id; };
    const sample = (offset: number) => { const value = samples[(start + offset) % 4]; if (!value) throw new Error("Missing corner attributes"); return value; };
    const top = onEdge(vertex(0), vertex(1), sample(0), sample(1));
    const bottom = onEdge(vertex(3), vertex(2), sample(3), sample(2));
    for (let i = 0; i <= cuts; i += 1) {
      const a = top[i], b = top[i + 1], c = bottom[i + 1], d = bottom[i];
      if (!a || !b || !c || !d) throw new Error("Missing cut points");
      output.push([a.id, b.id, c.id, d.id]); corners.push([a.sample, b.sample, c.sample, d.sample]); materials.push(data.materials[faceId] ?? 0);
      if (i < cuts) selection.add(edgeKey(b.id, c.id));
    }
  });
  return topologyResult(mesh, { positions, faces: output, channels: { positions: weights, corners, materials } }, [...selection]);
}
