import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import type { CharacterSimulation } from "@/engine/CharacterSimulation";
import { BONE_NAMES, legBones, type Side } from "@/engine/character/types";
import type { DebugToggles } from "./labSettings";
import { themeColor } from "./labTheme";

const TRAIL_POINTS = 240;
/** Seconds between trajectory samples. */
const TRAIL_INTERVAL = 0.05;
const capsuleOffset = new Vector3();
const point = new Vector3();

function lineMaterial(token: "foreground" | "muted-foreground" | "ring", opacity = 1): LineBasicMaterial {
  return new LineBasicMaterial({ color: themeColor(token), transparent: true, opacity, depthTest: false });
}

/** Optional visuals for inspecting the rig, the IK targets, the collider and the root path. */
export class DebugOverlay {
  readonly root = new Group();
  private readonly skeleton: LineSegments;
  private readonly joints: Mesh[] = [];
  private readonly ikGroup = new Group();
  private readonly ikTargets: Record<Side, Mesh>;
  private readonly ikLines: LineSegments;
  private readonly trail: Line;
  private readonly trailPositions = new Float32Array(TRAIL_POINTS * 3);
  private trailCount = 0;
  private sinceSample = 0;
  private showContacts = false;
  private readonly collider: Mesh;
  private readonly centerOfMass: Mesh;
  private readonly comLine: Line;
  private readonly contacts: Record<Side, Mesh>;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly sim: CharacterSimulation;

  constructor(sim: CharacterSimulation) {
    this.sim = sim;
    const track = <T extends { dispose(): void }>(item: T): T => {
      this.disposables.push(item);
      return item;
    };

    // Skeleton: a line for every parent-child bone pair, plus a small ball at every joint.
    const bonePairs = BONE_NAMES.filter((name) => sim.rig.definitions[name].parent !== null);
    const skeletonGeometry = track(new BufferGeometry());
    skeletonGeometry.setAttribute("position", new BufferAttribute(new Float32Array(bonePairs.length * 6), 3));
    this.skeleton = new LineSegments(skeletonGeometry, track(lineMaterial("foreground", 0.9)));
    this.skeleton.renderOrder = 10;
    this.skeleton.frustumCulled = false;
    const jointGeometry = track(new SphereGeometry(0.018, 8, 6));
    const jointMaterial = track(new MeshBasicMaterial({ color: themeColor("foreground"), depthTest: false }));
    for (let i = 0; i < BONE_NAMES.length; i++) {
      const joint = new Mesh(jointGeometry, jointMaterial);
      joint.renderOrder = 11;
      this.joints.push(joint);
      this.root.add(joint);
    }

    // IK: where each ankle is asked to go, joined to its hip.
    const targetGeometry = track(new OctahedronGeometry(0.04));
    const targetMaterial = track(new MeshBasicMaterial({ color: themeColor("foreground"), depthTest: false, wireframe: true }));
    const makeTarget = () => {
      const mesh = new Mesh(targetGeometry, targetMaterial);
      mesh.renderOrder = 12;
      this.ikGroup.add(mesh);
      return mesh;
    };
    this.ikTargets = { l: makeTarget(), r: makeTarget() };
    const ikGeometry = track(new BufferGeometry());
    ikGeometry.setAttribute("position", new BufferAttribute(new Float32Array(12), 3));
    this.ikLines = new LineSegments(ikGeometry, track(lineMaterial("ring", 0.7)));
    this.ikLines.renderOrder = 12;
    this.ikLines.frustumCulled = false;
    this.ikGroup.add(this.ikLines);

    // Planted-foot markers on the ground.
    const ringGeometry = track(new RingGeometry(0.07, 0.1, 24));
    ringGeometry.rotateX(-Math.PI / 2);
    const ringMaterial = track(new MeshBasicMaterial({ color: themeColor("foreground"), depthTest: false, transparent: true, opacity: 0.9 }));
    const makeContact = () => {
      const mesh = new Mesh(ringGeometry, ringMaterial);
      mesh.renderOrder = 9;
      this.root.add(mesh);
      return mesh;
    };
    this.contacts = { l: makeContact(), r: makeContact() };

    // Root trajectory.
    const trailGeometry = track(new BufferGeometry());
    trailGeometry.setAttribute("position", new BufferAttribute(this.trailPositions, 3));
    trailGeometry.setDrawRange(0, 0);
    this.trail = new Line(trailGeometry, track(lineMaterial("muted-foreground", 0.9)));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 8;

    // Character collider.
    const spec = sim.capsuleSpec;
    const colliderGeometry = track(new CapsuleGeometry(spec.radius, spec.halfHeight * 2, 6, 16));
    this.collider = new Mesh(colliderGeometry, track(new MeshBasicMaterial({ color: themeColor("muted-foreground"), wireframe: true, transparent: true, opacity: 0.55, depthTest: false })));
    this.collider.renderOrder = 7;

    // Center of mass and its ground projection.
    this.centerOfMass = new Mesh(track(new SphereGeometry(0.045, 14, 10)), track(new MeshBasicMaterial({ color: themeColor("brand"), depthTest: false })));
    this.centerOfMass.renderOrder = 13;
    const comGeometry = track(new BufferGeometry());
    comGeometry.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
    this.comLine = new Line(comGeometry, track(lineMaterial("foreground", 0.6)));
    this.comLine.frustumCulled = false;
    this.comLine.renderOrder = 13;

    this.root.add(this.skeleton, this.ikGroup, this.trail, this.collider, this.centerOfMass, this.comLine);
    this.setVisible({ skeleton: false, ikTargets: false, trajectory: false, collider: false, centerOfMass: false, contacts: false });
  }

  setVisible(toggles: DebugToggles): void {
    this.skeleton.visible = toggles.skeleton;
    for (const joint of this.joints) joint.visible = toggles.skeleton;
    this.ikGroup.visible = toggles.ikTargets;
    this.trail.visible = toggles.trajectory;
    this.collider.visible = toggles.collider;
    this.centerOfMass.visible = toggles.centerOfMass;
    this.comLine.visible = toggles.centerOfMass;
    this.showContacts = toggles.contacts;
    for (const side of ["l", "r"] as const) this.contacts[side].visible = toggles.contacts;
  }

  clearTrail(): void {
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  update(dt: number): void {
    const sim = this.sim;
    const rig = sim.rig;

    if (this.skeleton.visible) {
      const positions = this.skeleton.geometry.getAttribute("position");
      let index = 0;
      BONE_NAMES.forEach((name, i) => {
        const joint = this.joints[i];
        joint?.position.copy(rig.worldPosition[name]);
        const parent = rig.definitions[name].parent;
        if (parent === null) return;
        positions.setXYZ(index++, rig.worldPosition[parent].x, rig.worldPosition[parent].y, rig.worldPosition[parent].z);
        positions.setXYZ(index++, rig.worldPosition[name].x, rig.worldPosition[name].y, rig.worldPosition[name].z);
      });
      positions.needsUpdate = true;
    }

    if (this.ikGroup.visible) {
      const positions = this.ikLines.geometry.getAttribute("position");
      let index = 0;
      for (const side of ["l", "r"] as const) {
        const target = sim.generator.legTargets[side].ankle;
        this.ikTargets[side].position.copy(target);
        const hip = rig.worldPosition[legBones(side).thigh];
        positions.setXYZ(index++, hip.x, hip.y, hip.z);
        positions.setXYZ(index++, target.x, target.y, target.z);
      }
      positions.needsUpdate = true;
    }

    // Planted feet: a ring under each foot that is locked to the ground.
    for (const side of ["l", "r"] as const) {
      const foot = sim.gait.feet[side];
      const marker = this.contacts[side];
      marker.visible = this.showContacts && foot.mode === "stance";
      marker.position.set(foot.frame.flatAnkle.x, foot.frame.flatAnkle.y - rig.config.proportions.ankleHeight + 0.01, foot.frame.flatAnkle.z);
      marker.rotation.y = foot.frame.yaw;
    }

    this.sinceSample += dt;
    if (this.sinceSample >= TRAIL_INTERVAL) {
      this.sinceSample = 0;
      this.pushTrail(sim.position);
    }

    capsuleOffset.set(0, sim.capsuleSpec.halfHeight + sim.capsuleSpec.radius, 0);
    this.collider.position.copy(sim.position).add(capsuleOffset);

    if (this.centerOfMass.visible) {
      rig.centerOfMass(point);
      this.centerOfMass.position.copy(point);
      const positions = this.comLine.geometry.getAttribute("position");
      positions.setXYZ(0, point.x, point.y, point.z);
      positions.setXYZ(1, point.x, sim.position.y, point.z);
      positions.needsUpdate = true;
    }
  }

  private pushTrail(position: Vector3): void {
    if (this.trailCount >= TRAIL_POINTS) {
      this.trailPositions.copyWithin(0, 3);
      this.trailCount = TRAIL_POINTS - 1;
    }
    const base = this.trailCount * 3;
    this.trailPositions[base] = position.x;
    this.trailPositions[base + 1] = position.y + 0.03;
    this.trailPositions[base + 2] = position.z;
    this.trailCount += 1;
    this.trail.geometry.setDrawRange(0, this.trailCount);
    this.trail.geometry.getAttribute("position").needsUpdate = true;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const item of this.disposables) item.dispose();
  }
}
