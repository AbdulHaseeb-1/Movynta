import { Quaternion, Vector3 } from "three";
import { isFiniteVector, isValidQuaternion } from "../core/math";
import { isWithinLimits } from "./JointLimits";
import { Pose } from "./Pose";
import {
  BONE_MASS,
  buildSkeleton,
  DEFAULT_CHARACTER_CONFIG,
  footGeometry,
  restHipHeight,
} from "./SkeletonBuilder";
import {
  BONE_NAMES,
  createBoneMap,
  legBones,
  type BoneDefinition,
  type BoneMap,
  type BoneName,
  type CharacterConfig,
  type FootGeometry,
  type Side,
} from "./types";

export interface RigValidationIssue {
  readonly bone: BoneName | null;
  readonly message: string;
}

/**
 * Runtime skeleton: forward kinematics from a root transform and a `Pose`. It owns no
 * rendering objects, so it runs the same in the browser, in Node tests and in a worker.
 */
export class CharacterRig {
  readonly config: CharacterConfig;
  readonly definitions: BoneMap<BoneDefinition>;
  readonly foot: FootGeometry;
  /** World position of each joint after `updateWorld`. */
  readonly worldPosition: BoneMap<Vector3> = createBoneMap(() => new Vector3());
  /** World orientation of each joint after `updateWorld`. */
  readonly worldRotation: BoneMap<Quaternion> = createBoneMap(() => new Quaternion());
  /** World position of the root bone (the ground point under the pelvis). */
  readonly rootPosition = new Vector3();
  /** World orientation of the root bone (heading only). */
  readonly rootRotation = new Quaternion();
  readonly restPelvisPosition: Vector3;

  constructor(config: CharacterConfig = DEFAULT_CHARACTER_CONFIG) {
    this.config = config;
    this.definitions = buildSkeleton(config);
    this.foot = footGeometry(config.proportions);
    this.restPelvisPosition = this.definitions.pelvis.offset.clone();
    this.updateWorld(new Pose(this.restPelvisPosition));
  }

  get hipHeight(): number {
    return restHipHeight(this.config.proportions);
  }

  get thighLength(): number {
    return this.config.proportions.thigh;
  }

  get shinLength(): number {
    return this.config.proportions.shin;
  }

  /** Rest distance from a bone's joint to its first child's joint. */
  boneLength(name: BoneName): number {
    for (const child of BONE_NAMES) {
      const def = this.definitions[child];
      if (def.parent === name) return def.offset.length();
    }
    return 0;
  }

  setRootTransform(position: Vector3, rotation: Quaternion): void {
    this.rootPosition.copy(position);
    this.rootRotation.copy(rotation);
  }

  /** Forward kinematics. Parents are listed before children in `BONE_NAMES`. */
  updateWorld(pose: Pose): void {
    for (const name of BONE_NAMES) {
      const def = this.definitions[name];
      const position = this.worldPosition[name];
      const rotation = this.worldRotation[name];
      if (def.parent === null) {
        position.copy(this.rootPosition);
        rotation.copy(this.rootRotation).multiply(pose.rotations[name]);
        continue;
      }
      const parentRotation = this.worldRotation[def.parent];
      const local = name === "pelvis" ? pose.pelvisPosition : def.offset;
      position.copy(local).applyQuaternion(parentRotation).add(this.worldPosition[def.parent]);
      rotation.copy(parentRotation).multiply(pose.rotations[name]);
    }
  }

  /** Center of mass estimate: mass-weighted average of the bone segment midpoints. */
  centerOfMass(out: Vector3): Vector3 {
    out.set(0, 0, 0);
    let total = 0;
    const mid = new Vector3();
    for (const name of BONE_NAMES) {
      const mass = BONE_MASS[name];
      if (mass <= 0) continue;
      const child = this.firstChild(name);
      mid.copy(this.worldPosition[name]);
      if (child) mid.lerp(this.worldPosition[child], 0.5);
      out.addScaledVector(mid, mass);
      total += mass;
    }
    return total > 0 ? out.multiplyScalar(1 / total) : out;
  }

  private firstChild(name: BoneName): BoneName | null {
    for (const child of BONE_NAMES) if (this.definitions[child].parent === name) return child;
    return null;
  }

  /** World position of a foot contact point (heel, ball or toe tip) for the current pose. */
  footPoint(side: Side, point: keyof FootGeometry, out: Vector3): Vector3 {
    const bones = legBones(side);
    // The ball is the toe joint and the tip belongs to the toe bone, so both follow toe flexion.
    if (point === "ball") return out.copy(this.worldPosition[bones.toe]);
    if (point === "toeTip") {
      return out.set(0, 0, this.config.proportions.toeLength).applyQuaternion(this.worldRotation[bones.toe]).add(this.worldPosition[bones.toe]);
    }
    return out.copy(this.foot.heel).applyQuaternion(this.worldRotation[bones.foot]).add(this.worldPosition[bones.foot]);
  }

  /** Checks parenting, finiteness, unit quaternions and joint limits. Returns an empty list when healthy. */
  validate(pose: Pose): RigValidationIssue[] {
    const issues: RigValidationIssue[] = [];
    for (const name of BONE_NAMES) {
      const def = this.definitions[name];
      if (name === "root" ? def.parent !== null : def.parent === null) {
        issues.push({ bone: name, message: "Unexpected parent" });
      }
      if (!isValidQuaternion(pose.rotations[name])) issues.push({ bone: name, message: "Invalid local quaternion" });
      if (!isValidQuaternion(this.worldRotation[name])) issues.push({ bone: name, message: "Invalid world quaternion" });
      if (!isFiniteVector(this.worldPosition[name])) issues.push({ bone: name, message: "Non-finite world position" });
      if (name !== "root" && !isWithinLimits(name, pose.rotations[name])) {
        issues.push({ bone: name, message: "Joint outside its anatomical limit" });
      }
    }
    return issues;
  }
}
