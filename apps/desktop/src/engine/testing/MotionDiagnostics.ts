import { Vector3 } from "three";
import type { CharacterSimulation } from "../CharacterSimulation";
import { BONE_NAMES, legBones, type BoneName, type Side } from "../character/types";
import { DEG, eulerFromQuat, isFiniteVector, isValidQuaternion } from "../core/math";
import { createGroundHit } from "../physics/GroundDetection";

export interface DiagnosticsSummary {
  steps: number;
  nonFinite: number;
  invalidQuaternions: number;
  /** Steps where the root moved farther than any legal motion allows. */
  rootTeleports: number;
  maxRootStep: number;
  /** Largest per-step rotation change of any bone, in degrees, and which bone. */
  maxJointStepDegrees: number;
  maxJointStepBone: BoneName | null;
  jointSnaps: number;
  /** The first few snaps, for failure messages: when, which bone, how far, and in which state. */
  snapEvents: { step: number; bone: BoneName; degrees: number; state: string }[];
  /** Steps where IK output had to be pulled back inside anatomical limits. */
  limitCorrectionSteps: number;
  /** How many steps each joint had to be clamped on. */
  clampedBones: Partial<Record<BoneName, number>>;
  invertedKneeSteps: number;
  /** Largest shin Y/Z rotation (knee is a pure hinge, so this should stay near zero), degrees. */
  maxKneeOffAxisDegrees: number;
  /** Lowest sole point above the surface (negative is penetration), meters. */
  minFootClearance: number;
  penetrationSteps: number;
  maxStanceDrift: number;
  /** Where the worst stance drift happened. */
  worstDrift: { step: number; side: Side; state: string; meters: number } | null;
  stanceSegments: number;
  /** Largest requested reach / leg length. */
  maxReachRatio: number;
  maxAnkleError: number;
  touchdowns: Record<Side, number>;
  /** True when touchdowns strictly alternate left and right. */
  alternating: boolean;
  /** Steps with both feet off the ground while the character was grounded (flight phase of a run). */
  flightSteps: number;
  minPelvisY: number;
  maxPelvisY: number;
  /** Mean time between consecutive touchdowns, seconds (0 if fewer than two). */
  meanStepInterval: number;
  /** Peak heap growth over the recording in megabytes (Node only). */
  heapGrowthMb: number;
  states: string[];
}

const SNAP_DEGREES = 28;
const TELEPORT_METERS = 0.2;
const PENETRATION_METERS = -0.01;

const ground = createGroundHit();
const point = new Vector3();

function emptySummary(): DiagnosticsSummary {
  return {
    steps: 0, nonFinite: 0, invalidQuaternions: 0, rootTeleports: 0, maxRootStep: 0, maxJointStepDegrees: 0,
    maxJointStepBone: null, jointSnaps: 0, snapEvents: [], limitCorrectionSteps: 0, clampedBones: {}, invertedKneeSteps: 0, maxKneeOffAxisDegrees: 0,
    minFootClearance: Infinity, penetrationSteps: 0, maxStanceDrift: 0, worstDrift: null, stanceSegments: 0, maxReachRatio: 0,
    maxAnkleError: 0, touchdowns: { l: 0, r: 0 }, alternating: true, flightSteps: 0, minPelvisY: Infinity,
    maxPelvisY: -Infinity, meanStepInterval: 0, heapGrowthMb: 0, states: [],
  };
}

interface DriftTracker {
  active: boolean;
  usingHeel: boolean;
  readonly reference: Vector3;
}

/** Records motion-quality metrics every fixed step. Attach to a simulation, run it, then read `summary`. */
export class MotionDiagnostics {
  readonly summary: DiagnosticsSummary = emptySummary();
  private readonly previousRotation = new Map<BoneName, { x: number; y: number; z: number; w: number }>();
  private readonly previousRoot = new Vector3();
  private hasPrevious = false;
  private readonly drift: Record<Side, DriftTracker> = {
    l: { active: false, usingHeel: false, reference: new Vector3() },
    r: { active: false, usingHeel: false, reference: new Vector3() },
  };
  private lastTouchdownSide: Side | null = null;
  private touchdownTimes: number[] = [];
  private readonly stateSet = new Set<string>();
  private baselineHeap = 0;
  private sim: CharacterSimulation | null = null;
  private readonly observer = (sim: CharacterSimulation): void => this.record(sim);
  /** Returns used heap bytes. Tests running in Node provide it; the browser build leaves it unset. */
  heapSampler: (() => number) | null = null;
  /** Time (seconds) before which no drift or snap statistics are collected, to skip the start transient. */
  settleSeconds = 0;

  attach(sim: CharacterSimulation): this {
    this.sim = sim;
    sim.observers.push(this.observer);
    this.baselineHeap = this.heapSampler?.() ?? 0;
    return this;
  }

  detach(): void {
    if (!this.sim) return;
    const index = this.sim.observers.indexOf(this.observer);
    if (index >= 0) this.sim.observers.splice(index, 1);
    this.sim = null;
  }

  /** Clears the statistics but keeps the attachment (used between test phases). */
  restart(): void {
    Object.assign(this.summary, emptySummary());
    this.hasPrevious = false;
    this.touchdownTimes = [];
    this.lastTouchdownSide = null;
    this.stateSet.clear();
    this.drift.l.active = false;
    this.drift.r.active = false;
  }

  finish(): DiagnosticsSummary {
    const s = this.summary;
    s.states = [...this.stateSet];
    if (this.touchdownTimes.length >= 2) {
      const first = this.touchdownTimes[0] ?? 0;
      const last = this.touchdownTimes[this.touchdownTimes.length - 1] ?? 0;
      s.meanStepInterval = (last - first) / (this.touchdownTimes.length - 1);
    }
    if (this.heapSampler) s.heapGrowthMb = (this.heapSampler() - this.baselineHeap) / 1048576;
    return s;
  }

  private record(sim: CharacterSimulation): void {
    const s = this.summary;
    const rig = sim.rig;
    const time = sim.stepCount * sim.dt;
    s.steps += 1;
    this.stateSet.add(sim.state);
    const measuring = time >= this.settleSeconds;

    let finite = true;
    for (const name of BONE_NAMES) {
      if (!isFiniteVector(rig.worldPosition[name])) finite = false;
      if (!isValidQuaternion(rig.worldRotation[name])) s.invalidQuaternions += 1;
      if (!isValidQuaternion(sim.pose.rotations[name])) s.invalidQuaternions += 1;
    }
    if (!finite || !sim.pose.isFinite()) s.nonFinite += 1;

    // Root motion.
    const root = sim.controller.position;
    if (this.hasPrevious) {
      const step = root.distanceTo(this.previousRoot);
      s.maxRootStep = Math.max(s.maxRootStep, step);
      if (step > TELEPORT_METERS) s.rootTeleports += 1;
    }
    this.previousRoot.copy(root);

    // Joint continuity.
    let stepMax = 0;
    let stepMaxBone: BoneName | null = null;
    for (const name of BONE_NAMES) {
      const q = sim.pose.rotations[name];
      const prev = this.previousRotation.get(name);
      if (prev && this.hasPrevious) {
        const dot = Math.min(1, Math.abs(prev.x * q.x + prev.y * q.y + prev.z * q.z + prev.w * q.w));
        const degrees = (2 * Math.acos(dot)) / DEG;
        if (measuring && degrees > s.maxJointStepDegrees) {
          s.maxJointStepDegrees = degrees;
          s.maxJointStepBone = name;
        }
        if (degrees > stepMax) {
          stepMax = degrees;
          stepMaxBone = name;
        }
      }
      this.previousRotation.set(name, { x: q.x, y: q.y, z: q.z, w: q.w });
    }
    if (measuring && stepMax > SNAP_DEGREES) {
      s.jointSnaps += 1;
      if (s.snapEvents.length < 20 && stepMaxBone) s.snapEvents.push({ step: sim.stepCount, bone: stepMaxBone, degrees: Math.round(stepMax), state: sim.state });
    }
    if (measuring && sim.limitCorrections > 0) {
      s.limitCorrectionSteps += 1;
      for (const bone of sim.clampedBones) s.clampedBones[bone] = (s.clampedBones[bone] ?? 0) + 1;
    }

    // Knees.
    const euler = new Vector3();
    for (const side of ["l", "r"] as const) {
      eulerFromQuat(sim.pose.rotations[legBones(side).shin], euler);
      if (euler.x < -2 * DEG) s.invertedKneeSteps += 1;
      s.maxKneeOffAxisDegrees = Math.max(s.maxKneeOffAxisDegrees, Math.max(Math.abs(euler.y), Math.abs(euler.z)) / DEG);
      s.maxReachRatio = Math.max(s.maxReachRatio, sim.legReports[side].reachRatio);
      if (measuring) s.maxAnkleError = Math.max(s.maxAnkleError, sim.legReports[side].ankleError);
    }

    // Feet versus the ground, using the rendered skeleton.
    let anyContact = false;
    let lowest = Infinity;
    for (const side of ["l", "r"] as const) {
      let footLowest = Infinity;
      for (const key of ["heel", "ball", "toeTip"] as const) {
        rig.footPoint(side, key, point);
        sim.physics.sample(point.x, point.z, point.y + 0.3, ground);
        if (ground.found) footLowest = Math.min(footLowest, point.y - ground.height);
      }
      lowest = Math.min(lowest, footLowest);
      if (footLowest < 0.012) anyContact = true;
      this.trackDrift(sim, side, footLowest, measuring);
    }
    if (measuring) {
      s.minFootClearance = Math.min(s.minFootClearance, lowest);
      if (lowest < PENETRATION_METERS) s.penetrationSteps += 1;
      if (!anyContact && sim.controller.grounded) s.flightSteps += 1;
    }

    // Contacts. A landing re-plants both feet without a touchdown event, so alternation restarts there.
    if (sim.controller.justLanded) this.lastTouchdownSide = null;
    for (const event of sim.gait.events) {
      if (event.type !== "touchdown") continue;
      s.touchdowns[event.side] += 1;
      if (this.lastTouchdownSide === event.side) s.alternating = false;
      this.lastTouchdownSide = event.side;
      this.touchdownTimes.push(time);
    }

    const pelvisY = rig.worldPosition.pelvis.y - root.y;
    if (measuring) {
      s.minPelvisY = Math.min(s.minPelvisY, pelvisY);
      s.maxPelvisY = Math.max(s.maxPelvisY, pelvisY);
    }
    this.hasPrevious = true;
  }

  private trackDrift(sim: CharacterSimulation, side: Side, footLowest: number, measuring: boolean): void {
    const foot = sim.gait.feet[side];
    const tracker = this.drift[side];
    const stable = measuring && foot.mode === "stance" && foot.stanceProgress > 0.08 && foot.stanceProgress < 0.92 && footLowest < 0.02 && sim.controller.grounded;
    if (!stable) {
      tracker.active = false;
      return;
    }
    const heel = foot.pitch < -1e-3;
    sim.rig.footPoint(side, heel ? "heel" : "ball", point);
    if (!tracker.active || tracker.usingHeel !== heel) {
      tracker.active = true;
      tracker.usingHeel = heel;
      tracker.reference.copy(point);
      this.summary.stanceSegments += 1;
      return;
    }
    // Horizontal drift is what a viewer sees as sliding.
    const drift = Math.hypot(point.x - tracker.reference.x, point.z - tracker.reference.z);
    if (sim.inPlace) return;
    if (drift > this.summary.maxStanceDrift) {
      this.summary.maxStanceDrift = drift;
      this.summary.worstDrift = { step: sim.stepCount, side, state: sim.state, meters: drift };
    }
  }
}
