import type { ExtrudeResult } from "./meshExtrude";
import { channels, point, type PolygonMesh } from "./meshTopology";
import { topologyResult } from "./meshTopologyEdit";
import type { Weights } from "./meshWeights";

export interface BridgeResult extends ExtrudeResult { bridgeFaces: number; quads: number; triangles: number; longEdges: number; shortEdges: number }
/** One boundary edge as its face winds it: the face, and the corner the edge starts at. */
interface Rim { from: number; to: number; face: number; corner: number }

const EDGE = /^(0|[1-9]\d{0,9})_(0|[1-9]\d{0,9})$/;

/**
 * Join two closed boundary loops with a ring of faces (Blender's Bridge Edge Loops). No vertex is added or moved and
 * every existing ID stays; the new faces are last. Each face runs against the boundary edge it joins, so the result
 * is wound consistently. With equal edge counts every face is a quad. With unequal counts the shorter loop's vertices
 * are spread evenly along the longer one: a quad where both loops advance, a triangle where only the longer advances,
 * so the extra edges become triangles spread around the ring instead of one fan. The loops are paired at the rotation
 * that makes the connecting edges shortest in total; `twist` turns the shorter loop by whole edges when that pairing
 * is not the one wanted. No vertex may belong to both loops. New corners take the texture coordinates and material
 * of the face beside the boundary edge, so a bridge is not unwrapped.
 */
export function bridgeEdgeLoops(mesh: PolygonMesh, ids: readonly string[], twist = 0): BridgeResult {
  if (!Number.isInteger(twist) || Math.abs(twist) > 256) throw new Error("Twist must be a whole number of edges between -256 and 256");
  const count = mesh.positions.length, wanted = new Map<number, string>();
  for (const id of ids) {
    const match = EDGE.exec(id);
    if (!match || Number(match[1]) >= Number(match[2]) || Number(match[2]) >= count) throw new Error(`Edge ${id} is not a canonical smaller_larger edge ID of this mesh`);
    wanted.set(Number(match[1]) * count + Number(match[2]), id);
  }
  const used = new Map<number, Rim[]>();
  mesh.faces.forEach((face, index) => face.forEach((from, corner) => {
    const to = face[(corner + 1) % face.length] ?? from, key = from < to ? from * count + to : to * count + from;
    if (!wanted.has(key)) return;
    const list = used.get(key) ?? [];
    list.push({ from, to, face: index, corner });
    used.set(key, list);
  }));
  const rims: Rim[] = [];
  for (const [key, id] of wanted) {
    const list = used.get(key);
    if (!list) throw new Error(`Edge ${id} does not exist; inspect the base cage for current edge IDs`);
    const only = list[0];
    if (list.length !== 1 || !only) throw new Error(`Edge ${id} is not on an open boundary: bridging joins two openings, so choose edges that have a face on one side only`);
    rims.push(only);
  }
  // Follow the boundary the way its faces wind it. A vertex that starts two chosen edges joins the loops into a figure of eight.
  const startsAt = new Map<number, Rim>();
  for (const rim of rims) {
    if (startsAt.has(rim.from)) throw new Error(`Vertex ${rim.from} is where chosen boundary edges meet more than twice, so they do not form separate loops`);
    startsAt.set(rim.from, rim);
  }
  const loops: Rim[][] = [], seen = new Set<number>();
  for (const rim of rims) {
    if (seen.has(rim.from)) continue;
    const loop: Rim[] = [];
    for (let at: Rim | undefined = rim; at && !seen.has(at.from); at = startsAt.get(at.to)) { seen.add(at.from); loop.push(at); }
    if (loop[loop.length - 1]?.to !== rim.from) throw new Error("A chosen edge chain is not a closed loop: bridging needs whole boundary loops, so include every edge of each opening");
    loops.push(loop);
  }
  const [first, second] = loops;
  if (loops.length !== 2 || !first || !second) throw new Error(`Choose the edges of exactly two boundary loops; these form ${loops.length}`);
  // Equal loops keep the order they were found in; otherwise the longer one leads and the shorter one is spread along it.
  const [long, short] = first.length >= second.length ? [first, second] : [second, first];
  const n = long.length, m = short.length;
  if (m < 3) throw new Error("A loop needs at least three edges");
  const loopVertices = new Set([...first, ...second].map((rim) => rim.from));
  if (loopVertices.size !== n + m) throw new Error("The two loops share a vertex, so there is nothing to bridge between them");
  // Long vertex i (counting from `start`) is paired with short vertex (turn - P(i)): the short loop runs the opposite
  // way round, which is what makes the faces consistent. P spreads m steps over n, so it advances 0 or 1 at a time.
  const spread = (i: number) => Math.floor((i * m) / n);
  const squared = new Float64Array(n * m);
  for (let a = 0; a < n; a += 1) for (let b = 0; b < m; b += 1) squared[a * m + b] = point(mesh, long[a]?.from ?? 0).distanceToSquared(point(mesh, short[b]?.from ?? 0));
  const shortIndex = (turn: number, step: number) => (((turn - step) % m) + m) % m;
  let bestStart = 0, bestTurn = 0, bestCost = Infinity;
  // Equal loops are the same pairing seen from either side, so only the turn is searched.
  for (let start = 0; start < (n === m ? 1 : n); start += 1) for (let turn = 0; turn < m; turn += 1) {
    let cost = 0;
    for (let i = 0; i < n; i += 1) cost += squared[((start + i) % n) * m + shortIndex(turn, spread(i))] ?? 0;
    if (cost < bestCost - 1e-12) { bestStart = start; bestTurn = turn; bestCost = cost; }
  }
  const turn = (((bestTurn + twist) % m) + m) % m, start = bestStart;
  const longAt = (i: number) => long[(start + i) % n];
  const shortAt = (step: number) => short[shortIndex(turn, step)];
  // Loops that existing faces already join would get a second wall over the first.
  const connectors = new Map<number, string>();
  for (let i = 0; i < n; i += 1) {
    const a = longAt(i)?.from ?? 0, b = shortAt(spread(i))?.from ?? 0;
    connectors.set(a < b ? a * count + b : b * count + a, `${Math.min(a, b)}_${Math.max(a, b)}`);
  }
  for (const face of mesh.faces) face.forEach((from, corner) => {
    const to = face[(corner + 1) % face.length] ?? from, name = connectors.get(from < to ? from * count + to : to * count + from);
    if (name) throw new Error(`The two loops are already joined by existing faces (edge ${name} connects them), so a bridge would lay a second wall over the first; choose loops that are not yet connected`);
  });
  const data = channels(mesh);
  const faces = mesh.faces.map((face) => face), corners = data.corners.slice(), materials = data.materials.slice();
  const sampleAt = (rim: Rim, atTo: boolean): Weights => {
    const size = mesh.faces[rim.face]?.length ?? 1, sample = data.corners[rim.face]?.[(rim.corner + (atTo ? 1 : 0)) % size];
    if (!sample) throw new Error("Missing corner attributes");
    return sample;
  };
  let triangles = 0;
  for (let i = 0; i < n; i += 1) {
    const a = longAt(i);
    if (!a) throw new Error("Missing loop edge");
    const from = spread(i), to = spread(i + 1);
    // The short edge from step `to` back to step `from` runs from shortAt(to) to shortAt(from) as its face winds it.
    if (to === from) {
      // Only the long loop advances: a triangle fanning from one short vertex.
      const hub = shortAt(from);
      if (!hub) throw new Error("Missing loop edge");
      faces.push([a.to, a.from, hub.from]);
      corners.push([sampleAt(a, true), sampleAt(a, false), sampleAt(hub, false)]);
      triangles += 1;
    } else {
      const b = shortAt(to);
      if (!b) throw new Error("Missing loop edge");
      // a runs a.from -> a.to, b runs b.from -> b.to; the quad goes against both: a.to, a.from, b.to, b.from.
      faces.push([a.to, a.from, b.to, b.from]);
      corners.push([sampleAt(a, true), sampleAt(a, false), sampleAt(b, true), sampleAt(b, false)]);
    }
    materials.push(data.materials[a.face] ?? 0);
  }
  const result: PolygonMesh = { positions: mesh.positions, faces, channels: { positions: data.positions, corners, materials } };
  return { ...topologyResult(mesh, result, []), bridgeFaces: n, quads: n - triangles, triangles, longEdges: n, shortEdges: m };
}
