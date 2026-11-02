import type { Object3D } from "three";
import { rigOf, type Rig } from "./rig";

/**
 * Readies a freshly imported model for posing, and returns its rig (undefined when it has none). Called
 * once, before the model is added to the scene, so the rest pose it records is the file's own.
 *
 * A skinned mesh is never culled by three.js: its bounding sphere is measured once from the pose it had
 * at that moment, so a bone moved later could carry part of the mesh out of the sphere and make it
 * vanish at the edge of the view. Measuring it again after every pose costs a pass over all vertices.
 */
export function prepareRig(model: Object3D): Rig | undefined {
  const rig = rigOf(model);
  if (!rig) return undefined;
  for (const mesh of rig.skinned) mesh.frustumCulled = false;
  return rig;
}
