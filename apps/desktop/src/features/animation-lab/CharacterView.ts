import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { CharacterSimulation } from "@/engine/CharacterSimulation";
import { BONE_NAMES, createBoneMap, type BoneMap, type BoneName } from "@/engine/character/types";
import { themeColor } from "./labTheme";

/** A virtual end point at an offset in a bone's own frame (a fingertip, a toe tip). */
interface EndPoint {
  readonly bone: BoneName;
  readonly offset: (rig: CharacterSimulation["rig"]) => Vector3;
}

type SegmentEnd = BoneName | EndPoint;

interface SegmentSpec {
  readonly from: SegmentEnd;
  readonly to: SegmentEnd;
  readonly radius: number;
  readonly side: "left" | "right" | "center";
}

const end = (bone: BoneName, offset: EndPoint["offset"]): EndPoint => ({ bone, offset });

/** Thickness of every line of the figure (meters). A drawn stick figure uses one stroke width throughout. */
const STROKE = 0.045;

/** Every limb, torso and neck piece as a rounded stroke between two joints, all the same width. */
const SEGMENTS: readonly SegmentSpec[] = [
  { from: "pelvis", to: "spine_lower", radius: STROKE, side: "center" },
  { from: "spine_lower", to: "spine_mid", radius: STROKE, side: "center" },
  { from: "spine_mid", to: "spine_upper", radius: STROKE, side: "center" },
  { from: "spine_upper", to: "neck", radius: STROKE, side: "center" },
  { from: "neck", to: "head", radius: STROKE, side: "center" },
  { from: "thigh_l", to: "thigh_r", radius: STROKE, side: "center" },
  { from: "neck", to: "clavicle_l", radius: STROKE, side: "left" },
  { from: "clavicle_l", to: "upper_arm_l", radius: STROKE, side: "left" },
  { from: "upper_arm_l", to: "forearm_l", radius: STROKE, side: "left" },
  { from: "forearm_l", to: "hand_l", radius: STROKE, side: "left" },
  { from: "hand_l", to: end("hand_l", (rig) => new Vector3(0, -rig.config.proportions.hand, 0)), radius: STROKE, side: "left" },
  { from: "neck", to: "clavicle_r", radius: STROKE, side: "right" },
  { from: "clavicle_r", to: "upper_arm_r", radius: STROKE, side: "right" },
  { from: "upper_arm_r", to: "forearm_r", radius: STROKE, side: "right" },
  { from: "forearm_r", to: "hand_r", radius: STROKE, side: "right" },
  { from: "hand_r", to: end("hand_r", (rig) => new Vector3(0, -rig.config.proportions.hand, 0)), radius: STROKE, side: "right" },
  { from: "thigh_l", to: "shin_l", radius: STROKE, side: "left" },
  { from: "shin_l", to: "foot_l", radius: STROKE, side: "left" },
  { from: "foot_l", to: "toe_l", radius: STROKE, side: "left" },
  { from: "toe_l", to: end("toe_l", (rig) => new Vector3(0, 0, rig.config.proportions.toeLength)), radius: STROKE, side: "left" },
  { from: "thigh_r", to: "shin_r", radius: STROKE, side: "right" },
  { from: "shin_r", to: "foot_r", radius: STROKE, side: "right" },
  { from: "foot_r", to: "toe_r", radius: STROKE, side: "right" },
  { from: "toe_r", to: end("toe_r", (rig) => new Vector3(0, 0, rig.config.proportions.toeLength)), radius: STROKE, side: "right" },
];

const UP = new Vector3(0, 1, 0);
const a = new Vector3();
const b = new Vector3();
const direction = new Vector3();
/** How much of the head radius the head center sits above the head joint (below 1 buries the neck in the circle). */
const HEAD_SEAT = 0.85;

interface Segment {
  readonly spec: SegmentSpec;
  readonly mesh: Mesh;
  readonly startJoint: Mesh;
  readonly endJoint: Mesh;
}

/**
 * Draws the rig as rounded 3D geometry: cylinders between joints with spheres at every joint (so there are
 * never gaps), a spherical head, and a small nose so the heading is visible. It only reads the simulation.
 */
export class CharacterView {
  readonly root = new Group();
  private readonly segments: Segment[] = [];
  private readonly head: Mesh;
  private readonly positions: BoneMap<Vector3> = createBoneMap(() => new Vector3());
  private readonly rotations: BoneMap<Quaternion> = createBoneMap(() => new Quaternion());
  private readonly geometries: { dispose(): void }[] = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly sim: CharacterSimulation;

  constructor(sim: CharacterSimulation) {
    this.sim = sim;
    const cylinder = new CylinderGeometry(1, 1, 1, 16, 1, false);
    const sphere = new SphereGeometry(1, 20, 14);
    this.geometries.push(cylinder, sphere);

    // One matte color for the whole figure. The emissive term keeps the shading soft, like a flat drawing, while the
    // geometry stays genuinely 3D and still casts and receives shadows.
    const color = themeColor("character");
    const body = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.9, metalness: 0 });
    this.materials.push(body);
    const materials = { left: body, right: body, center: body };

    for (const spec of SEGMENTS) {
      const material = materials[spec.side];
      const mesh = new Mesh(cylinder, material);
      const startJoint = new Mesh(sphere, material);
      const endJoint = new Mesh(sphere, material);
      for (const object of [mesh, startJoint, endJoint]) {
        object.castShadow = true;
        object.receiveShadow = true;
        this.root.add(object);
      }
      this.segments.push({ spec, mesh, startJoint, endJoint });
    }

    this.head = new Mesh(sphere, materials.center);
    this.head.scale.setScalar(sim.rig.config.proportions.headRadius);
    this.head.castShadow = true;
    this.head.receiveShadow = true;
    this.root.add(this.head);
    this.update(0);
  }

  /** Positions every piece from the simulation, interpolated by `alpha` between the last two steps. */
  update(alpha: number): void {
    for (const name of BONE_NAMES) this.sim.interpolated(name, alpha, this.positions[name], this.rotations[name]);

    for (const segment of this.segments) {
      this.resolve(segment.spec.from, a);
      this.resolve(segment.spec.to, b);
      direction.subVectors(b, a);
      const length = direction.length();
      const radius = segment.spec.radius;
      segment.mesh.visible = length > 1e-5;
      if (length > 1e-5) {
        direction.multiplyScalar(1 / length);
        segment.mesh.position.copy(a).addScaledVector(direction, length / 2);
        segment.mesh.quaternion.setFromUnitVectors(UP, direction);
        segment.mesh.scale.set(radius, length, radius);
      }
      segment.startJoint.position.copy(a);
      segment.startJoint.scale.setScalar(radius);
      segment.endJoint.position.copy(b);
      segment.endJoint.scale.setScalar(radius);
    }

    // The head sits on the neck so the stroke runs straight into the circle, as in the drawing.
    const headRadius = this.sim.rig.config.proportions.headRadius;
    this.head.position.set(0, headRadius * HEAD_SEAT, 0).applyQuaternion(this.rotations.head).add(this.positions.head);
  }

  private resolve(endpoint: SegmentEnd, out: Vector3): Vector3 {
    if (typeof endpoint === "string") return out.copy(this.positions[endpoint]);
    return out.copy(endpoint.offset(this.sim.rig)).applyQuaternion(this.rotations[endpoint.bone]).add(this.positions[endpoint.bone]);
  }

  /** Interpolated world position of a bone, valid after `update`. */
  bonePosition(name: BoneName): Vector3 {
    return this.positions[name];
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
