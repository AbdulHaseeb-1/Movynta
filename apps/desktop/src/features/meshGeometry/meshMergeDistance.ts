import { Vector3 } from "three";
import { channels, point, type PolygonMesh } from "./meshTopology";
import { mean, type Weights } from "./meshWeights";
import { requireIds, topologyResult } from "./meshTopologyEdit";

/** Connected groups of selected vertices whose pairwise links are within the local-space distance. */
export function distanceGroups(mesh: PolygonMesh, ids: readonly string[], distance: number): number[][] {
  requireIds(ids, 2);
  if (!Number.isFinite(distance) || distance <= 0 || distance > 100) throw new Error("Distance must be greater than zero and at most 100 local units");
  const vertices = ids.map((id) => {
    if (!/^(0|[1-9]\d{0,9})$/.test(id) || !mesh.positions[Number(id)]) throw new Error(`Unknown vertex ${id}`);
    return Number(id);
  }).sort((a, b) => a - b);
  const parents = vertices.map((_, i) => i);
  const root = (index: number): number => { let i = index; while (parents[i] !== i) i = parents[i] ?? i; let current = index; while (parents[current] !== i) { const next = parents[current] ?? i; parents[current] = i; current = next; } return i; };
  const cells = new Map<string, number[]>();
  for (let i = 0; i < vertices.length; i++) {
    const position = point(mesh, vertices[i]);
    const x = Math.floor(position.x / distance), y = Math.floor(position.y / distance), z = Math.floor(position.z / distance);
    if (![x, y, z].every((coordinate) => Number.isSafeInteger(coordinate) && Math.abs(coordinate) < Number.MAX_SAFE_INTEGER)) throw new Error("Distance is too small for these mesh coordinates");
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of cells.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
        const a = root(i), b = root(j);
        if (a !== b && position.distanceToSquared(point(mesh, vertices[j])) <= distance * distance) parents[a] = b;
      }
    }
    const key = `${x},${y},${z}`, bucket = cells.get(key) ?? []; bucket.push(i); cells.set(key, bucket);
  }
  const groups = new Map<number, number[]>();
  vertices.forEach((vertex, i) => { const key = root(i), group = groups.get(key) ?? []; group.push(vertex); groups.set(key, group); });
  return [...groups.values()].filter((group) => group.length > 1);
}

/** Merge all groups in one candidate, preserving face corner samples and material assignments. */
export function mergeByDistance(mesh: PolygonMesh, ids: readonly string[], distance: number, computedGroups?: number[][]) {
  const groups = computedGroups ?? distanceGroups(mesh, ids, distance);
  if (!groups.length) throw new Error("No selected vertices are within the merge distance");
  const data = channels(mesh), mapping = new Map<number, number>();
  const positions = mesh.positions.slice(), weights = data.positions.slice();
  for (const group of groups) {
    const target = group[0]; if (target === undefined) continue;
    for (const vertex of group) mapping.set(vertex, target);
    positions[target] = group.reduce((sum, id) => sum.add(point(mesh, id)), new Vector3()).divideScalar(group.length);
    weights[target] = mean(group.map((id) => data.positions[id] ?? new Map()));
  }
  const faces: number[][] = [], corners: Weights[][] = [], materials: number[] = [];
  mesh.faces.forEach((face, faceId) => {
    const loop: number[] = [], samples: Weights[][] = [];
    face.forEach((vertex, corner) => {
      const id = mapping.get(vertex) ?? vertex, sample = data.corners[faceId]?.[corner];
      if (!sample) throw new Error("Missing corner attributes");
      if (loop[loop.length - 1] === id) samples[samples.length - 1]?.push(sample);
      else { loop.push(id); samples.push([sample]); }
    });
    if (loop.length > 1 && loop[0] === loop[loop.length - 1]) { const last = samples.pop() ?? []; samples[0]?.push(...last); loop.pop(); }
    if (loop.length < 3) return;
    if (new Set(loop).size !== loop.length) throw new Error("Merge would pinch a face");
    faces.push(loop); corners.push(samples.map(mean)); materials.push(data.materials[faceId] ?? 0);
  });
  if (!faces.length) throw new Error("Merge would remove every face");
  const used = new Set(faces.flat()), remap = new Map<number, number>(), compact: Vector3[] = [], compactWeights: Weights[] = [];
  positions.forEach((position, id) => { if (used.has(id)) { remap.set(id, compact.length); compact.push(position); compactWeights.push(weights[id] ?? new Map()); } });
  const mapped = faces.map((face) => face.map((id) => { const value = remap.get(id); if (value === undefined) throw new Error("Invalid merge mapping"); return value; }));
  const selection = groups.flatMap((group) => { const id = group[0], mappedId = id === undefined ? undefined : remap.get(id); return mappedId === undefined ? [] : [String(mappedId)]; });
  return topologyResult(mesh, { positions: compact, faces: mapped, channels: { positions: compactWeights, corners, materials } }, selection);
}
