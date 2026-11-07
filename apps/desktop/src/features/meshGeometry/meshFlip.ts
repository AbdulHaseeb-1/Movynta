import type { ExtrudeResult } from "./meshExtrude";
import { channels, type PolygonMesh } from "./meshTopology";
import { shellRoots } from "./meshRegions";
import { validateTopologyEdit } from "./meshTopologyEdit";

export interface FlipResult extends ExtrudeResult {
  flippedFaces: number;
}

/**
 * Reverse the winding of whole connected shells, so a surface faces the other way (Blender's Flip, Alt+N).
 * A shell is a set of faces joined by shared edges. Face IDs are kept. With no `ids` every shell flips; with `ids`
 * each shell that contains a listed face flips. Reversing only part of a shell would leave its seam wound
 * inconsistently, which the editor rejects, so a listed face always stands for its whole shell.
 */
export function flipNormals(mesh: PolygonMesh, ids?: readonly string[]): FlipResult {
  let flips: boolean[];
  if (ids === undefined) flips = mesh.faces.map(() => true);
  else {
    const roots = shellRoots(mesh),
      chosen = new Set<number>();
    for (const id of ids) {
      const face = Number(id);
      if (!/^(0|[1-9]\d{0,9})$/.test(id) || !mesh.faces[face])
        throw new Error(`Face ${id} does not exist; inspect the base cage for current face IDs`);
      chosen.add(roots[face] ?? -1);
    }
    flips = mesh.faces.map((_, face) => chosen.has(roots[face] ?? -1));
  }
  const data = channels(mesh);
  const result: PolygonMesh = {
    ...mesh,
    faces: mesh.faces.map((face, index) => (flips[index] ? [...face].reverse() : face)),
    channels: {
      ...data,
      corners: data.corners.map((corner, index) => (flips[index] ? [...corner].reverse() : corner)),
    },
  };
  validateTopologyEdit(result, result);
  return { mesh: result, selection: [], walls: [], flippedFaces: flips.filter(Boolean).length };
}
