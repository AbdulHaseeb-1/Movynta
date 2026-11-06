import { Vector3, type BufferGeometry } from "three";
import type { ExtrudeResult } from "./meshExtrude";
import { validateKnifeFace } from "./meshKnifeAttributes";
import { triangulate } from "./meshOutput";
import { channels, faceNormal, type PolygonMesh } from "./meshTopology";
import { topologyResult } from "./meshTopologyEdit";
import { blend, type Weights } from "./meshWeights";

export type BisectKeep = "both" | "positive" | "negative";
/** A plane in mesh-local space: a point on it and the direction that counts as its positive side. */
export interface BisectPlane { point: Vector3; normal: Vector3 }
export interface BisectOptions {
  /** Cut only these faces. Edges they cross are still split in their neighbors, so no crack opens. */
  faces?: ReadonlySet<number>;
  /** Which side survives. `both` only cuts. */
  keep?: BisectKeep;
  /** Close the opening a one-sided cut leaves. */
  fill?: boolean;
  /** Vertices within this distance of the plane count as on it, and a cut this close to a vertex lands on the vertex. */
  snapDistance?: number;
}
export interface BisectResult extends ExtrudeResult { split: number; removed: number; capped: number }

interface Corner { id: number; sample: Weights }
/** Where the plane meets an edge. `t` runs from the lower-numbered vertex; `interior` says a new vertex was made. */
interface EdgeCut { id: number; t: number; interior: boolean }

const MAX_CAP_CORNERS = 256;

/**
 * Cut a mesh with a plane, like Blender's Bisect. Every polygon the plane crosses is split along it, and an edge it
 * crosses gets one new vertex shared by both faces beside it, so the mesh stays watertight. Vertices on the plane
 * are used as they are. Nothing is moved.
 *
 * The plane is treated as lying a hair below where it is (a vertex exactly on it counts as on its positive side).
 * That one rule decides every touching, grazing and coplanar case without special handling: a face that only
 * touches the plane is left alone, a face with an edge on the plane is left alone, and a face that really crosses
 * it is cut.
 *
 * `keep` removes the other side afterwards, and `fill` closes the opening with polygons, one per outline.
 * Face IDs after the cut: faces keep their order and a cut face becomes consecutive pieces; capping faces are last.
 * Vertex IDs: new vertices follow the old ones, and unused vertices are dropped when a side is removed.
 */
export function bisectMesh(mesh: PolygonMesh, source: BufferGeometry, plane: BisectPlane, options: BisectOptions = {}): BisectResult {
  const keep = options.keep ?? "both";
  const fill = options.fill === true;
  if (fill && keep === "both") throw new Error("Fill closes the opening left by keeping one side; set keep to positive or negative");
  if (options.faces && keep !== "both") throw new Error("Keeping one side removes whole sides, so it cannot be limited to chosen faces");
  const normal = plane.normal.clone();
  if (![normal.x, normal.y, normal.z, plane.point.x, plane.point.y, plane.point.z].every(Number.isFinite) || normal.length() < 1e-12) {
    throw new Error("The cut plane needs a finite point and a nonzero normal");
  }
  normal.normalize();
  const data = channels(mesh);
  const count = mesh.positions.length;
  const offset = normal.dot(plane.point);
  const distance = new Float64Array(count);
  let low = Infinity, high = -Infinity;
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const p = mesh.positions[vertex];
    if (!p) throw new Error("Mesh contains an invalid vertex reference");
    const d = normal.x * p.x + normal.y * p.y + normal.z * p.z - offset;
    distance[vertex] = d;
    if (d < low) low = d;
    if (d > high) high = d;
    min.min(p); max.max(p);
  }
  const snap = options.snapDistance ?? Math.max(min.distanceTo(max) * 1e-6, 1e-9);
  // level: signed distance with the on-plane band flattened to zero. Negative is the only "below" class.
  const level = new Float64Array(count);
  for (let vertex = 0; vertex < count; vertex += 1) { const d = distance[vertex] ?? 0; level[vertex] = Math.abs(d) <= snap ? 0 : d; }
  if (options.faces) for (const face of options.faces) if (!mesh.faces[face]) throw new Error(`Face ${face} does not exist; inspect the base cage for current face IDs`);

  const positions = mesh.positions.slice(), weights = data.positions.slice();
  const levels: number[] = Array.from(level);
  const view: PolygonMesh = { positions, faces: [] };
  const cuts = new Map<number, EdgeCut>();
  const cutAt = (a: number, b: number, create: boolean): EdgeCut | undefined => {
    if (((level[a] ?? 0) < 0) === ((level[b] ?? 0) < 0)) return undefined;
    const lo = Math.min(a, b), hi = Math.max(a, b), key = lo * count + hi;
    const known = cuts.get(key);
    if (known || !create) return known;
    const elo = level[lo] ?? 0, ehi = level[hi] ?? 0;
    const t = Math.min(1, Math.max(0, elo / (elo - ehi)));
    const from = positions[lo], to = positions[hi];
    if (!from || !to) throw new Error("Mesh contains an invalid vertex reference");
    const length = from.distanceTo(to);
    let cut: EdgeCut;
    if (t * length <= snap) cut = { id: lo, t: 0, interior: false };
    else if ((1 - t) * length <= snap) cut = { id: hi, t: 1, interior: false };
    else {
      cut = { id: positions.length, t, interior: true };
      positions.push(from.clone().lerp(to, t));
      weights.push(blend([[data.positions[lo] ?? new Map(), 1 - t], [data.positions[hi] ?? new Map(), t]]));
      levels.push(0);
    }
    cuts.set(key, cut);
    return cut;
  };
  const candidate = (face: number): boolean => !options.faces || options.faces.has(face);
  // Create every cut before assembling faces, so a neighbor outside the chosen faces sees the vertex too.
  mesh.faces.forEach((face, index) => {
    if (candidate(index)) face.forEach((from, corner) => { cutAt(from, face[(corner + 1) % face.length] ?? from, true); });
  });

  const faces: number[][] = [], corners: Weights[][] = [], materials: number[] = [], origin: number[] = [];
  const chords = new Set<string>();
  let split = 0;
  mesh.faces.forEach((face, index) => {
    const samples = data.corners[index] ?? [], material = data.materials[index] ?? 0, size = face.length;
    const loop: Corner[] = [], crossings: number[] = [];
    let inserted = 0;
    face.forEach((from, corner) => {
      const next = (corner + 1) % size, to = face[next] ?? from, sample = samples[corner];
      if (!sample) throw new Error("Missing corner attributes");
      loop.push({ id: from, sample });
      const cut = cutAt(from, to, false);
      if (!cut) return;
      crossings.push(cut.id);
      if (!cut.interior) return;
      const t = from < to ? cut.t : 1 - cut.t, after = samples[next];
      if (!after) throw new Error("Missing corner attributes");
      loop.push({ id: cut.id, sample: blend([[sample, 1 - t], [after, t]]) });
      inserted += 1;
    });
    let pieces: Corner[][] = [loop];
    if (candidate(index) && crossings.length >= 2) pieces = splitLoop(view, face, loop, crossings, normal, index, chords, levels);
    if (inserted > 0 || pieces.length > 1) validateKnifeFace(mesh, index, source);
    if (pieces.length > 1) split += 1;
    if (inserted === 0 && pieces.length === 1) { faces.push(face); corners.push(samples); materials.push(material); origin.push(index); return; }
    for (const piece of pieces) {
      faces.push(piece.map((corner) => corner.id)); corners.push(piece.map((corner) => corner.sample));
      materials.push(material); origin.push(index);
    }
  });
  if (split === 0 && keep === "both") {
    throw new Error(`The plane does not cut the mesh: its vertices are ${format(low)} to ${format(high)} units from the plane (mesh-local, positive on the normal side), so the plane has to pass between them`);
  }

  // Remove the unwanted side. A cut face lies wholly on one side; a face on the plane stays.
  const removed = new Uint8Array(faces.length);
  let removedCount = 0;
  if (keep !== "both") {
    faces.forEach((face, index) => {
      let above = false, below = false;
      for (const vertex of face) { const l = levels[vertex] ?? 0; if (l > 0) above = true; else if (l < 0) below = true; }
      if (above && below) throw new Error(`Face ${origin[index]} could not be cut cleanly by this plane; triangulate it first or move the plane`);
      if ((keep === "positive" && below) || (keep === "negative" && above)) { removed[index] = 1; removedCount += 1; }
    });
    if (removedCount === 0) throw new Error(`The plane does not cut the mesh: everything lies on the kept side (vertices are ${format(low)} to ${format(high)} units from the plane)`);
    if (removedCount === faces.length) throw new Error(`Nothing would remain: the whole mesh lies on the removed side (vertices are ${format(low)} to ${format(high)} units from the plane)`);
  }

  let capped = 0;
  const caps: { ids: number[]; samples: Weights[]; material: number }[] = [];
  if (fill) {
    const kept = new Map<number, { from: number; to: number; face: number; corner: number }[]>();
    const lost = new Set<number>();
    const keyOf = (a: number, b: number) => (a < b ? a * positions.length + b : b * positions.length + a);
    faces.forEach((face, index) => face.forEach((from, corner) => {
      const to = face[(corner + 1) % face.length] ?? from, key = keyOf(from, to);
      if (removed[index]) { lost.add(key); return; }
      const list = kept.get(key);
      if (list) list.push({ from, to, face: index, corner }); else kept.set(key, [{ from, to, face: index, corner }]);
    }));
    const rim = new Map<number, { to: number; face: number; corner: number; from: number }>();
    for (const [key, list] of kept) {
      const only = list[0];
      if (list.length !== 1 || !only || !lost.has(key)) continue;
      // The cap runs against the kept face, from `to` back to `from`.
      if (rim.has(only.to)) throw new Error("The cut outline touches itself, so it cannot be capped with one polygon each; leave fill off or move the plane");
      rim.set(only.to, only);
    }
    const loops: { ids: number[]; edges: { from: number; to: number; face: number; corner: number }[] }[] = [];
    const visited = new Set<number>();
    for (const start of rim.keys()) {
      if (visited.has(start)) continue;
      const ids: number[] = [], edges: { from: number; to: number; face: number; corner: number }[] = [];
      for (let vertex: number | undefined = start; vertex !== undefined && !visited.has(vertex); ) {
        visited.add(vertex);
        const edge = rim.get(vertex);
        if (!edge) throw new Error("The cut outline does not close, so it cannot be capped");
        ids.push(vertex); edges.push(edge);
        vertex = edge.from;
      }
      if (rim.get(ids[ids.length - 1] ?? -1)?.from !== start) throw new Error("The cut outline does not close, so it cannot be capped");
      loops.push({ ids, edges });
    }
    assertNoNestedOutlines(positions, loops.map((entry) => entry.ids), normal);
    const outlines = new Set(loops.map((entry) => entry.ids.slice().sort((a, b) => a - b).join(",")));
    faces.forEach((face, index) => {
      if (!removed[index] && face.every((vertex) => levels[vertex] === 0) && outlines.has(face.slice().sort((a, b) => a - b).join(","))) {
        throw new Error("The plane lies in a face of the mesh, so what remains of that side is only that face and there is nothing to cap; leave fill off or move the plane");
      }
    });
    for (const entry of loops) {
      const samples = entry.edges.map((edge) => {
        const sample = corners[edge.face]?.[(edge.corner + 1) % (faces[edge.face]?.length ?? 1)];
        if (!sample) throw new Error("Missing corner attributes");
        return sample;
      });
      caps.push({ ids: entry.ids, samples, material: materials[entry.edges[0]?.face ?? 0] ?? 0 });
    }
  }

  // Keep the surviving faces, then drop vertices nothing uses and renumber in order.
  const used = new Uint8Array(positions.length);
  const finalFaces: number[][] = [], finalCorners: Weights[][] = [], finalMaterials: number[] = [];
  faces.forEach((face, index) => {
    if (removed[index]) return;
    for (const vertex of face) used[vertex] = 1;
    finalFaces.push(face); finalCorners.push(corners[index] ?? []); finalMaterials.push(materials[index] ?? 0);
  });
  for (const cap of caps) for (const vertex of cap.ids) used[vertex] = 1;
  const remap = new Int32Array(positions.length).fill(-1);
  const finalPositions: Vector3[] = [], finalWeights: Weights[] = [];
  positions.forEach((position, vertex) => {
    if (!used[vertex]) return;
    remap[vertex] = finalPositions.length;
    finalPositions.push(position); finalWeights.push(weights[vertex] ?? new Map());
  });
  const mapped = finalFaces.map((face) => face.map((vertex) => remap[vertex] ?? -1));
  for (const cap of caps) {
    const ids = cap.ids.map((vertex) => remap[vertex] ?? -1);
    const triangles = ids.length > MAX_CAP_CORNERS ? triangulate({ positions: finalPositions, faces: [] }, ids) : [Array.from(ids, (_, corner) => corner)];
    if (triangles.length !== (ids.length > MAX_CAP_CORNERS ? ids.length - 2 : 1)) throw new Error("The cut outline is too complex to cap; leave fill off");
    for (const triangle of triangles) {
      mapped.push(triangle.map((corner) => ids[corner] ?? -1));
      finalCorners.push(triangle.map((corner) => cap.samples[corner] ?? new Map()));
      finalMaterials.push(cap.material);
      capped += 1;
    }
  }
  const selection: string[] = [];
  for (const key of chords) {
    const [a, b] = key.split("_").map(Number), x = remap[a ?? -1] ?? -1, y = remap[b ?? -1] ?? -1;
    if (x >= 0 && y >= 0) selection.push(x < y ? `${x}_${y}` : `${y}_${x}`);
  }
  const result: PolygonMesh = { positions: finalPositions, faces: mapped, channels: { positions: finalWeights, corners: finalCorners, materials: finalMaterials } };
  const edit = topologyResult(mesh, result, selection, { allowOpening: keep !== "both" && !fill });
  return { ...edit, split, removed: removedCount, capped };
}

function format(value: number): string { return Number(value.toPrecision(5)).toString(); }

/**
 * Split one polygon, given as a loop with the plane's crossing points already inserted, into the pieces the plane
 * bounds. The common case is a polygon with two crossings and nothing else on the plane: one chord.
 *
 * Otherwise the exact rule applies. Every corner of the polygon that lies on the plane lies on the cutting line, so
 * sort them along it; each stretch between neighbours is cut if its midpoint is strictly inside the polygon. That
 * handles a concave polygon (several stretches), a corner that touches the line from either side (the polygon is cut
 * into pieces that meet at that corner, and the other side keeps it as a straight-through corner) and an edge that
 * lies on the line (never cut, since its midpoint is on the boundary), without special cases.
 */
function splitLoop(view: PolygonMesh, face: readonly number[], loop: Corner[], crossings: number[], normal: Vector3, faceIndex: number, chords: Set<string>, levels: readonly number[]): Corner[][] {
  const onPlane = loop.filter((corner) => levels[corner.id] === 0).map((corner) => corner.id);
  const first = crossings[0], second = crossings[1];
  const plain = crossings.length === 2 && first !== undefined && second !== undefined && onPlane.every((id) => id === first || id === second);
  let stretches: [number, number][];
  if (plain) {
    if (first === second) return [loop]; // the plane only touches a corner
    stretches = [[first, second]];
  } else {
    const direction = new Vector3().crossVectors(normal, faceNormal(view, face));
    if (direction.lengthSq() < 1e-18) throw new Error(`Face ${faceIndex} is parallel to the plane, so its crossings are ambiguous; triangulate it first`);
    direction.normalize();
    const ordered = onPlane.map((id) => ({ id, key: view.positions[id]?.dot(direction) ?? 0 })).sort((a, b) => a.key - b.key);
    stretches = [];
    for (let i = 0; i + 1 < ordered.length; i += 1) {
      const a = ordered[i]?.id, b = ordered[i + 1]?.id;
      if (a === undefined || b === undefined || a === b) continue;
      const apart = loop.findIndex((corner) => corner.id === a) - loop.findIndex((corner) => corner.id === b);
      if (Math.abs(apart) === 1 || Math.abs(apart) === loop.length - 1) continue; // already an edge
      if (strictlyInside(view, loop.map((corner) => corner.id), midpoint(view, a, b), face)) stretches.push([a, b]);
    }
  }
  let pieces: Corner[][] = [loop];
  for (const [a, b] of stretches) {
    const holders = pieces.map((piece, index) => ({ piece, index })).filter(({ piece }) => piece.some((corner) => corner.id === a) && piece.some((corner) => corner.id === b));
    const centre = midpoint(view, a, b);
    // Corners where pieces meet belong to several of them; the stretch lies in the one that contains its middle.
    const chosen = holders.length === 1 ? holders[0] : holders.find(({ piece }) => strictlyInside(view, piece.map((corner) => corner.id), centre, face));
    if (!chosen) throw new Error(`Face ${faceIndex} could not be cut cleanly by this plane; triangulate it first or move the plane`);
    const { piece, index } = chosen;
    const ia = piece.findIndex((corner) => corner.id === a), ib = piece.findIndex((corner) => corner.id === b);
    const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
    if (hi - lo < 2 || piece.length - (hi - lo) < 2) continue; // the cut runs along an existing edge
    const near = piece.slice(lo, hi + 1), far = [...piece.slice(hi), ...piece.slice(0, lo + 1)];
    // A piece whose corners all lie in the plane is a straight run of the polygon's own edge: no area, only a sliver.
    if (near.every((corner) => levels[corner.id] === 0) || far.every((corner) => levels[corner.id] === 0)) continue;
    pieces = [...pieces.slice(0, index), near, far, ...pieces.slice(index + 1)];
    chords.add(a < b ? `${a}_${b}` : `${b}_${a}`);
  }
  return pieces;
}

function midpoint(view: PolygonMesh, a: number, b: number): Vector3 {
  const from = view.positions[a], to = view.positions[b];
  if (!from || !to) throw new Error("Mesh contains an invalid vertex reference");
  return from.clone().add(to).multiplyScalar(0.5);
}

/** Whether a point on the polygon's plane is inside the outline and not on it. */
function strictlyInside(view: PolygonMesh, outline: readonly number[], at: Vector3, face: readonly number[]): boolean {
  const n = faceNormal(view, face);
  const axis = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? 0 : 2) : (Math.abs(n.y) > Math.abs(n.z) ? 1 : 2);
  const flat = (p: Vector3): [number, number] => (axis === 0 ? [p.y, p.z] : axis === 1 ? [p.x, p.z] : [p.x, p.y]);
  const [px, py] = flat(at);
  let size = 0;
  const points = outline.map((id) => { const p = view.positions[id]; if (!p) throw new Error("Mesh contains an invalid vertex reference"); return flat(p); });
  for (const [x, y] of points) size = Math.max(size, Math.abs(x - px), Math.abs(y - py));
  const tolerance = Math.max(size * 1e-9, 1e-12);
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i] ?? [0, 0], [xj, yj] = points[j] ?? [0, 0];
    const dx = xi - xj, dy = yi - yj, length = Math.hypot(dx, dy);
    if (length > 0) {
      const along = ((px - xj) * dx + (py - yj) * dy) / (length * length);
      const reach = Math.hypot(px - (xj + dx * Math.min(1, Math.max(0, along))), py - (yj + dy * Math.min(1, Math.max(0, along))));
      if (reach <= tolerance) return false; // on the outline
    }
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Outlines inside other outlines would need a bridge to cap; refuse them rather than cover a hole. */
function assertNoNestedOutlines(positions: readonly Vector3[], outlines: readonly (readonly number[])[], normal: Vector3): void {
  if (outlines.length < 2) return;
  const axis = Math.abs(normal.x) > Math.abs(normal.y) ? (Math.abs(normal.x) > Math.abs(normal.z) ? 0 : 2) : (Math.abs(normal.y) > Math.abs(normal.z) ? 1 : 2);
  const flat = (id: number): [number, number] => {
    const p = positions[id] ?? new Vector3();
    return axis === 0 ? [p.y, p.z] : axis === 1 ? [p.x, p.z] : [p.x, p.y];
  };
  const inside = (probe: [number, number], outline: readonly number[]): boolean => {
    let result = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
      const [xi, yi] = flat(outline[i] ?? 0), [xj, yj] = flat(outline[j] ?? 0);
      if (yi > probe[1] !== yj > probe[1] && probe[0] < ((xj - xi) * (probe[1] - yi)) / (yj - yi) + xi) result = !result;
    }
    return result;
  };
  for (let i = 0; i < outlines.length; i += 1) for (let j = 0; j < outlines.length; j += 1) {
    const probe = outlines[j]?.[0];
    if (i !== j && probe !== undefined && inside(flat(probe), outlines[i] ?? [])) {
      throw new Error("The cut passes through hollow geometry, so its outlines nest and cannot be capped with flat polygons; leave fill off");
    }
  }
}
