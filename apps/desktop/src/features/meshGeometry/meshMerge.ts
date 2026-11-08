import { Vector3 } from "three";
import { channels, point, type PolygonMesh } from "./meshTopology";
import { mean, type Weights } from "./meshWeights";
import { requireIds, topologyResult } from "./meshTopologyEdit";

/** Collapse explicitly selected base vertices, keeping each surviving face's corner attributes. */
export function mergeVertices(mesh: PolygonMesh, ids: readonly string[], mode: "center" | "first" | "last") {
  requireIds(ids, 2);
  const selected = ids.map((id) => {
    if (!/^(0|[1-9]\d{0,9})$/.test(id) || !mesh.positions[Number(id)]) throw new Error(`Unknown vertex ${id}`);
    return Number(id);
  });
  const target = mode === "last" ? selected[selected.length - 1] : selected[0];
  if (target === undefined) throw new Error("Missing merge target");
  const merged = new Set(selected),
    data = channels(mesh);
  const center =
    mode === "center"
      ? selected.reduce((sum, id) => sum.add(point(mesh, id)), new Vector3()).divideScalar(selected.length)
      : point(mesh, target).clone();
  const positions = mesh.positions.slice();
  positions[target] = center;
  const weights = data.positions.slice();
  weights[target] =
    mode === "center"
      ? mean(selected.map((id) => data.positions[id] ?? new Map()))
      : (data.positions[target] ?? new Map());
  const faces: number[][] = [],
    corners: Weights[][] = [],
    materials: number[] = [];
  mesh.faces.forEach((face, faceId) => {
    const loop: number[] = [],
      groups: Weights[][] = [];
    face.forEach((vertex, corner) => {
      const id = merged.has(vertex) ? target : vertex;
      const sample = data.corners[faceId]?.[corner];
      if (!sample) throw new Error("Missing corner attributes");
      if (loop[loop.length - 1] === id) groups[groups.length - 1]?.push(sample);
      else {
        loop.push(id);
        groups.push([sample]);
      }
    });
    if (loop.length > 1 && loop[0] === loop[loop.length - 1]) {
      const last = groups.pop() ?? [];
      groups[0]?.push(...last);
      loop.pop();
    }
    if (loop.length < 3) return;
    if (new Set(loop).size !== loop.length)
      throw new Error("Merge would pinch a face; select a connected vertex region");
    faces.push(loop);
    corners.push(groups.map(mean));
    materials.push(data.materials[faceId] ?? 0);
  });
  const used = new Set(faces.flat()),
    remap = new Map<number, number>();
  const compact = [],
    compactWeights: Weights[] = [];
  for (let id = 0; id < positions.length; id += 1)
    if (used.has(id)) {
      remap.set(id, compact.length);
      compact.push(point({ ...mesh, positions }, id));
      compactWeights.push(weights[id] ?? new Map());
    }
  const mapped = faces.map((face) =>
    face.map((id) => {
      const next = remap.get(id);
      if (next === undefined) throw new Error("Invalid merge mapping");
      return next;
    }),
  );
  const result = { positions: compact, faces: mapped, channels: { positions: compactWeights, corners, materials } };
  const mergedId = remap.get(target);
  return topologyResult(mesh, result, mergedId === undefined ? [] : [String(mergedId)]);
}
