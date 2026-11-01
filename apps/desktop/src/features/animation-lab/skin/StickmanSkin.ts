import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Matrix4,
  Vector3,
  type MeshStandardMaterial,
  type Object3D,
} from "three";
import { BONE_NAMES, createBoneMap, type BoneMap, type BoneName, type CharacterConfig } from "@/engine/character/types";
import { cachedBodyMeshData, type BodyMeshData } from "./bodyMesh";
import { addJointCorrectives, applyCorrective, JointCorrectiveState } from "./jointCorrectives";

const parentWorld = new Quaternion();
const offset = new Vector3();
const boneMatrix = new Matrix4();
const skinMatrix = new Matrix4();
const normalScratch = new Vector3();

/**
 * The stickman's skin: one `THREE.SkinnedMesh` over a bone tree that mirrors the simulation rig (same names, same
 * parents). Each frame the bones take the simulated world transforms and the GPU does the skinning, with a corrective
 * step at the elbows, knees, shoulders and hips (see `jointCorrectives.ts`).
 */
export class StickmanSkin {
  readonly mesh: SkinnedMesh;
  readonly skeleton: Skeleton;
  readonly bones: BoneMap<Bone>;
  readonly material: MeshStandardMaterial;
  readonly data: BodyMeshData;
  private readonly parents: BoneMap<BoneName | null>;
  private readonly geometry: BufferGeometry;
  private readonly correctives = new JointCorrectiveState();

  constructor(config: CharacterConfig, material: MeshStandardMaterial, parents: BoneMap<BoneName | null>) {
    this.material = material;
    this.parents = parents;
    this.data = cachedBodyMeshData(config);
    this.bones = createBoneMap((name) => {
      const bone = new Bone();
      bone.name = name;
      return bone;
    });

    // Bind pose: every bone at its rest transform, expressed relative to its parent.
    const { positions, rotations } = this.data.bindPose;
    for (const name of BONE_NAMES) this.placeBone(name, positions, rotations);
    const root = this.bones.root;
    root.updateMatrixWorld(true);
    this.skeleton = new Skeleton(BONE_NAMES.map((name) => this.bones[name]));

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new BufferAttribute(this.data.positions, 3));
    this.geometry.setAttribute("normal", new BufferAttribute(this.data.normals, 3));
    this.geometry.setAttribute("skinIndex", new BufferAttribute(this.data.skinIndices, 4));
    this.geometry.setAttribute("skinWeight", new BufferAttribute(this.data.skinWeights, 4));
    this.geometry.setAttribute("aJoint", new BufferAttribute(this.data.jointInfluence, 2));
    this.geometry.setIndex(new BufferAttribute(this.data.indices, 1));

    addJointCorrectives(material, this.correctives);
    this.mesh = new SkinnedMesh(this.geometry, material);
    this.mesh.name = "stickman";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // The bones move across the whole world; the bind-pose bounds say nothing about where the figure is.
    this.mesh.frustumCulled = false;
    this.mesh.add(root);
    this.mesh.bind(this.skeleton);
  }

  /** Moves the bones to the given world transforms (one per rig bone) and updates the corrective state. */
  update(positions: BoneMap<Vector3>, rotations: BoneMap<Quaternion>): void {
    for (const name of BONE_NAMES) this.placeBone(name, positions, rotations);
    this.correctives.update(rotations);
  }

  private placeBone(name: BoneName, positions: BoneMap<Vector3>, rotations: BoneMap<Quaternion>): void {
    const bone = this.bones[name];
    const parent = this.parents[name];
    if (parent === null) {
      bone.position.copy(positions[name]);
      bone.quaternion.copy(rotations[name]);
      return;
    }
    parentWorld.copy(rotations[parent]).invert();
    bone.position.copy(offset.copy(positions[name]).sub(positions[parent]).applyQuaternion(parentWorld));
    bone.quaternion.copy(parentWorld).multiply(rotations[name]);
    if (bone.parent === null) this.bones[parent].add(bone);
  }

  /**
   * Position of a vertex in the current pose, computed on the CPU exactly as the GPU does it (linear blend skinning,
   * then the corrective step). For tests and measurements; rendering never calls it.
   */
  skinnedVertex(index: number, out: Vector3, withCorrectives = true): Vector3 {
    this.mesh.updateMatrixWorld(true);
    this.mesh.getVertexPosition(index, out);
    this.mesh.applyBoneTransform(index, out);
    if (!withCorrectives) return out;
    // Skinned normal: the same bone matrices applied to the bind normal, blended by the vertex weights.
    skinMatrix.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let slot = 0; slot < 4; slot++) {
      const weight = this.data.skinWeights[index * 4 + slot] ?? 0;
      const bone = this.skeleton.bones[this.data.skinIndices[index * 4 + slot] ?? 0];
      const inverse = this.skeleton.boneInverses[this.data.skinIndices[index * 4 + slot] ?? 0];
      if (weight === 0 || !bone || !inverse) continue;
      boneMatrix.multiplyMatrices(bone.matrixWorld, inverse);
      for (let e = 0; e < 16; e++) skinMatrix.elements[e] = (skinMatrix.elements[e] ?? 0) + (boneMatrix.elements[e] ?? 0) * weight;
    }
    normalScratch.set(this.data.normals[index * 3] ?? 0, this.data.normals[index * 3 + 1] ?? 0, this.data.normals[index * 3 + 2] ?? 0);
    normalScratch.transformDirection(skinMatrix).normalize();
    const joint = this.data.jointInfluence[index * 2] ?? -1;
    const influence = this.data.jointInfluence[index * 2 + 1] ?? 0;
    return applyCorrective(out, normalScratch, joint, influence, this.correctives);
  }

  /** Turns the corrective deformation on or off. Off is plain linear blend skinning, which is useful to compare against. */
  setCorrectives(enabled: boolean): void {
    this.correctives.strength.value = enabled ? 1 : 0;
  }

  get root(): Object3D {
    return this.mesh;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.skeleton.dispose();
    this.geometry.dispose();
  }
}
