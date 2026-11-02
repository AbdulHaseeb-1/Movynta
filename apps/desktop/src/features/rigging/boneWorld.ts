import { Matrix4 } from "three";
import type { Rig } from "./rig";

const parentMatrix = new Matrix4();
const boneMatrix = new Matrix4();

/**
 * Where the joints of a rig are in the world. Bones only store their transform relative to their
 * parent, so this multiplies the chain down the hierarchy, once per bone: the cost follows the number
 * of bones, not their depth. The buffers are allocated once and reused by every {@link update}.
 */
export class BoneWorld {
  /** The x, y and z of each bone's joint, bone after bone. */
  readonly positions: Float64Array;
  /** Each bone's world matrix; a bone's children are computed from it. */
  private readonly matrices: Float64Array;
  private readonly rig: Rig;

  constructor(rig: Rig) {
    this.rig = rig;
    this.positions = new Float64Array(rig.bones.length * 3);
    this.matrices = new Float64Array(rig.bones.length * 16);
  }

  /**
   * Recomputes every joint from the bones' current local transforms. It reads the bones themselves, not
   * their cached world matrices, which are a frame old until the renderer has run.
   */
  update(): void {
    const { bones, parents } = this.rig;
    for (let index = 0; index < bones.length; index += 1) {
      const bone = bones[index];
      if (!bone) continue;
      if (bone.matrixAutoUpdate) bone.updateMatrix();
      const parent = parents[index] ?? -1;
      if (parent >= 0) {
        parentMatrix.fromArray(this.matrices, parent * 16);
      } else if (bone.parent) {
        // The first bone hangs from something that is not a bone, which the renderer updates only later.
        bone.parent.updateWorldMatrix(true, false);
        parentMatrix.copy(bone.parent.matrixWorld);
      } else {
        parentMatrix.identity();
      }
      boneMatrix.multiplyMatrices(parentMatrix, bone.matrix);
      boneMatrix.toArray(this.matrices, index * 16);
      const e = boneMatrix.elements;
      this.positions[index * 3] = e[12] ?? 0;
      this.positions[index * 3 + 1] = e[13] ?? 0;
      this.positions[index * 3 + 2] = e[14] ?? 0;
    }
  }
}
