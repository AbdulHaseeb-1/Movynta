import { Quaternion, Vector3, type MeshStandardMaterial } from "three";
import type { BoneMap, BoneName } from "@/engine/character/types";
import { STROKE_RADIUS } from "./bodyPrimitives";
import { boneIndex } from "./skinWeights";

/** A joint whose bend is compensated after linear skinning. */
export interface CorrectiveJoint {
  readonly name: string;
  /** Bone on the root side of the joint. */
  readonly parent: BoneName;
  /** Bone that bends. */
  readonly child: BoneName;
  /** Strength of the compensation (1 restores the full in-plane thickness the blend lost). */
  readonly strength: number;
}

export const CORRECTIVE_JOINTS: readonly CorrectiveJoint[] = [
  { name: "elbow_l", parent: "upper_arm_l", child: "forearm_l", strength: 1 },
  { name: "elbow_r", parent: "upper_arm_r", child: "forearm_r", strength: 1 },
  { name: "knee_l", parent: "thigh_l", child: "shin_l", strength: 1 },
  { name: "knee_r", parent: "thigh_r", child: "shin_r", strength: 1 },
  { name: "shoulder_l", parent: "clavicle_l", child: "upper_arm_l", strength: 0.7 },
  { name: "shoulder_r", parent: "clavicle_r", child: "upper_arm_r", strength: 0.7 },
  { name: "hip_l", parent: "pelvis", child: "thigh_l", strength: 0.6 },
  { name: "hip_r", parent: "pelvis", child: "thigh_r", strength: 0.6 },
];

export const JOINT_COUNT = CORRECTIVE_JOINTS.length;

/**
 * Skinned normals at a collapsed ring are not exactly in the bend plane, so the push along them falls a little short of
 * the geometric shortfall; this gain makes up for it (measured on the 148 degree elbow and 140 degree knee).
 */
const RESTORE_GAIN = 1.25;
/** Largest bend (radians) the compensation keeps growing for. Beyond it the bulge is held, not extrapolated. */
const MAX_COMPENSATED_BEND = 2.4;

/**
 * For each surface vertex: which corrective joint it sits at (or -1) and how strongly (0..1). A vertex is "at" a joint
 * when both bones either side of it carry weight, which is exactly where linear skinning collapses the tube.
 */
export function computeJointInfluence(dense: Float32Array, vertexCount: number, boneCount: number): Float32Array {
  const result = new Float32Array(vertexCount * 2);
  const pairs = CORRECTIVE_JOINTS.map((joint) => [boneIndex(joint.parent), boneIndex(joint.child)] as const);
  for (let v = 0; v < vertexCount; v++) {
    let best = -1;
    let bestWeight = 0;
    pairs.forEach(([parent, child], joint) => {
      const w = Math.min(1, 4 * (dense[v * boneCount + parent] ?? 0) * (dense[v * boneCount + child] ?? 0));
      if (w > bestWeight) {
        bestWeight = w;
        best = joint;
      }
    });
    result[v * 2] = best;
    result[v * 2 + 1] = bestWeight;
  }
  return result;
}

const relative = new Quaternion();
const parentInverse = new Quaternion();
const axisLocal = new Vector3();

/** Per-frame joint state fed to the vertex shader: how far each joint is bent and about which axis. */
export class JointCorrectiveState {
  readonly angles: number[] = CORRECTIVE_JOINTS.map(() => 0);
  readonly axes: Vector3[] = CORRECTIVE_JOINTS.map(() => new Vector3(1, 0, 0));
  /** Overall strength of the correction: 1 on, 0 off (plain linear skinning, for comparison). */
  readonly strength = { value: 1 };

  /** Reads the bend of every corrective joint from the bones' world rotations. */
  update(rotations: BoneMap<Quaternion>): void {
    CORRECTIVE_JOINTS.forEach((joint, index) => {
      const parent = rotations[joint.parent];
      const child = rotations[joint.child];
      relative.copy(parentInverse.copy(parent).invert()).multiply(child);
      if (relative.w < 0) relative.set(-relative.x, -relative.y, -relative.z, -relative.w);
      const angle = 2 * Math.acos(Math.min(1, relative.w));
      this.angles[index] = angle;
      axisLocal.set(relative.x, relative.y, relative.z);
      if (axisLocal.lengthSq() > 1e-10) axisLocal.normalize().applyQuaternion(parent);
      else axisLocal.set(1, 0, 0);
      this.axes[index]?.copy(axisLocal);
    });
  }
}

/** Largest radial growth (meters) the correction applies for a given bend, at full influence and strength. */
export function bulgeFor(angle: number, radius = STROKE_RADIUS): number {
  return radius * growthFor(angle);
}

/**
 * Outward push (as a fraction of the stroke radius) that restores a tube's in-plane thickness at a joint bent by `angle`
 * radians. Blending two bones 50/50 shrinks the ring at the joint to cos(angle / 2) of its radius, so the shortfall is
 * 1 - cos(angle / 2). The shader evaluates the same expression.
 */
export function growthFor(angle: number): number {
  return RESTORE_GAIN * (1 - Math.cos(Math.min(angle, MAX_COMPENSATED_BEND) * 0.5));
}

/**
 * The corrective step for one skinned vertex, on the CPU. This is exactly what the vertex shader does; tests and tools
 * use it to measure the result without a GPU. Pushes the point outward along the in-plane part of `normal`.
 */
export function applyCorrective(position: Vector3, normal: Vector3, joint: number, influence: number, state: JointCorrectiveState): Vector3 {
  const axis = state.axes[joint];
  const strength = CORRECTIVE_JOINTS[joint]?.strength;
  if (!axis || strength === undefined || joint < 0 || influence <= 0) return position;
  const inPlane = normal.clone().addScaledVector(axis, -normal.dot(axis));
  return position.addScaledVector(inPlane, STROKE_RADIUS * growthFor(state.angles[joint] ?? 0) * strength * influence * state.strength.value);
}

/**
 * Adds the corrective step to the standard material's vertex shader. After linear blend skinning, vertices near a bent
 * joint are pushed outward from the limb axis, but only in the bend plane: the component of the surface normal
 * perpendicular to the joint's rotation axis. Linear skinning loses thickness exactly in that plane (the "collapsed
 * elbow"), and keeps it perpendicular to it, so that is the only direction that needs restoring.
 */
export function addJointCorrectives(material: MeshStandardMaterial, state: JointCorrectiveState): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uJointAngle"] = { value: state.angles };
    shader.uniforms["uJointAxis"] = { value: state.axes };
    shader.uniforms["uJointStrength"] = { value: CORRECTIVE_JOINTS.map((joint) => joint.strength) };
    shader.uniforms["uBulgeRadius"] = { value: STROKE_RADIUS };
    shader.uniforms["uMaxBend"] = { value: MAX_COMPENSATED_BEND };
    shader.uniforms["uCorrective"] = state.strength;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec2 aJoint;
uniform float uJointAngle[${JOINT_COUNT}];
uniform vec3 uJointAxis[${JOINT_COUNT}];
uniform float uJointStrength[${JOINT_COUNT}];
uniform float uBulgeRadius;
uniform float uMaxBend;
uniform float uCorrective;`,
      )
      .replace(
        "#include <skinning_vertex>",
        `#include <skinning_vertex>
#ifdef USE_SKINNING
  if (aJoint.y > 0.0 && aJoint.x > -0.5) {
    int jointId = int(aJoint.x + 0.5);
    float bend = min(uJointAngle[jointId], uMaxBend);
    float growth = ${RESTORE_GAIN.toFixed(3)} * (1.0 - cos(bend * 0.5));
    vec3 bendAxis = uJointAxis[jointId];
    vec3 skinnedNormal = normalize(objectNormal);
    vec3 inPlane = skinnedNormal - bendAxis * dot(skinnedNormal, bendAxis);
    transformed += inPlane * (uBulgeRadius * growth * uJointStrength[jointId] * aJoint.y * uCorrective);
  }
#endif`,
      );
  };
  material.customProgramCacheKey = () => "stickman-joint-correctives-v2";
}
