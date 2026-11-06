import type { BufferGeometry } from "three";
import { channels, type PolygonMesh } from "./meshTopology";
import { evaluate } from "./meshWeights";
import { validateTopologyEdit } from "./meshTopologyEdit";

/** Remove only identically oriented faces with exactly matching materials and corner attributes. */
export function removeDuplicateFaces(mesh: PolygonMesh, source: BufferGeometry) {
  const data = channels(mesh);
  const attributes = [...Object.values(source.attributes), ...Object.values(source.morphAttributes).flatMap((values) => values ?? [])];
  const seen = new Map<string, number>();
  const kept: number[] = [];
  for (let faceId = 0; faceId < mesh.faces.length; faceId++) {
    const face = mesh.faces[faceId]; if (!face || !face.length) throw new Error("Invalid face");
    const key = [...face].sort((a, b) => a - b).join(",");
    const previousId = seen.get(key);
    if (previousId === undefined) { seen.set(key, faceId); kept.push(faceId); continue; }
    const previous = mesh.faces[previousId];
    if (!previous || previous.length !== face.length) throw new Error("Ambiguous duplicate faces");
    const offset = previous.indexOf(face[0] ?? -1);
    if (offset < 0 || face.some((vertex, i) => vertex !== previous[(offset + i) % face.length])) throw new Error("Overlapping faces have different winding or vertex order; inspect them manually");
    if (data.materials[faceId] !== data.materials[previousId]) throw new Error("Duplicate faces have different materials; inspect them manually");
    for (let i = 0; i < face.length; i++) {
      const a = data.corners[faceId]?.[i], b = data.corners[previousId]?.[(offset + i) % face.length];
      if (!a || !b) throw new Error("Duplicate faces have missing corner attributes");
      for (const attribute of attributes) for (let c = 0; c < attribute.itemSize; c++) {
        if (evaluate(attribute, a, c) !== evaluate(attribute, b, c)) throw new Error("Duplicate faces have different attributes; inspect them manually");
      }
    }
  }
  const removed = mesh.faces.length - kept.length;
  if (!removed) throw new Error("No matching duplicate faces found");
  const result: PolygonMesh = { positions: mesh.positions, faces: kept.map((id) => mesh.faces[id] ?? []), channels: { positions: data.positions, corners: kept.map((id) => data.corners[id] ?? []), materials: kept.map((id) => data.materials[id] ?? 0) } };
  // The input can be non-manifold because of duplicate faces; validate the repaired candidate itself.
  validateTopologyEdit(result, result);
  return { mesh: result, selection: [] as string[], walls: [] as number[], removed };
}
