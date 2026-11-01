import { Quaternion, Vector3 } from "three";
import { AnimationBlender } from "./animation/AnimationBlender";
import { AnimationStateMachine } from "./animation/AnimationStateMachine";
import { AnimationTimeline } from "./animation/AnimationTimeline";
import { GaitController } from "./animation/GaitController";
import { JumpSequence } from "./animation/JumpSequence";
import { LocomotionGenerator } from "./animation/LocomotionGenerator";
import { DEFAULT_TUNING, type AnimationStateId, type AnimationTuning } from "./animation/types";
import {
  CharacterController,
  createMovementCommand,
  type FacingMode,
  type MovementCommand,
} from "./character/CharacterController";
import { CharacterRig } from "./character/CharacterRig";
import type { ClampDetail } from "./character/JointLimits";
import { Pose } from "./character/Pose";
import {
  BONE_NAMES,
  createBoneMap,
  type BoneMap,
  type BoneName,
  type CharacterConfig,
  type Side,
} from "./character/types";
import { DEFAULT_CHARACTER_CONFIG } from "./character/SkeletonBuilder";
import { SimulationClock, FIXED_DT } from "./core/SimulationClock";
import { DEG, SpringDamper, clamp01, damp } from "./core/math";
import { solveLegs, type LegSolveReport } from "./ik/LegIK";
import { BodyDynamics } from "./motion/BodyDynamics";
import { SecondaryMotion } from "./motion/SecondaryMotion";
import { createGroundHit } from "./physics/GroundDetection";
import { DEFAULT_CAPSULE, PhysicsWorld, type CapsuleSpec } from "./physics/PhysicsWorld";
import { buildTerrain, type TerrainPreset } from "./physics/Terrain";

export interface SimulationOptions {
  readonly terrain?: TerrainPreset;
  readonly config?: CharacterConfig;
  readonly tuning?: Partial<AnimationTuning>;
  readonly capsule?: CapsuleSpec;
  readonly fixedDt?: number;
}

/** Observer called at the end of every fixed step (diagnostics, recorders). */
export type StepObserver = (simulation: CharacterSimulation) => void;

const SETTLE_STEPS = 24;
/** Response rate (1/s) of the animation velocity filter; about 40 ms. */
const VELOCITY_SMOOTHING = 25;
/** Response rate (1/s) of the request used for foot placement; about 0.15 s. */
const PLACEMENT_SMOOTHING = 7;
const yAxis = new Vector3(0, 1, 0);

/**
 * The whole character: physics, controller, state machine, gait, pose generation, IK, and secondary motion,
 * advanced by a fixed timestep so results do not depend on the render frame rate. It has no rendering or
 * React dependency; the viewport only reads its transforms.
 */
export class CharacterSimulation {
  readonly rig: CharacterRig;
  readonly pose: Pose;
  readonly physics: PhysicsWorld;
  readonly controller: CharacterController;
  readonly gait: GaitController;
  readonly generator = new LocomotionGenerator();
  readonly machine = new AnimationStateMachine();
  readonly blender = new AnimationBlender();
  readonly dynamics = new BodyDynamics();
  readonly secondary = new SecondaryMotion();
  readonly jump = new JumpSequence();
  readonly timeline = new AnimationTimeline();
  readonly clock: SimulationClock;
  readonly tuning: AnimationTuning;
  readonly command: MovementCommand = createMovementCommand();
  readonly observers: StepObserver[] = [];
  readonly legReports: Record<Side, LegSolveReport> = {
    l: { reachRatio: 0, kneeAngle: 0, ankleError: 0 },
    r: { reachRatio: 0, kneeAngle: 0, ankleError: 0 },
  };
  /** Treadmill mode: no root translation, plants slide back at the commanded speed. */
  get inPlace(): boolean {
    return this.controller.inPlace;
  }
  set inPlace(value: boolean) {
    this.controller.inPlace = value;
  }
  /** Whether the keyframe timeline overrides the keyed joints. */
  timelineActive = false;
  /** Joint limit violations corrected on the last step, and which joints they were. */
  limitCorrections = 0;
  readonly clampedBones: BoneName[] = [];
  /** When set, receives the pre-clamp angles of every joint that was clamped (debugging and tests). */
  clampDetails: Partial<Record<BoneName, ClampDetail>> | null = null;
  /** Current commanded speed in m/s. */
  speedCommand = 0;
  stepCount = 0;
  readonly origin = new Vector3();
  private airborne = 0;
  private readonly rootQuat = new Quaternion();
  private readonly previousPositions: BoneMap<Vector3> = createBoneMap(() => new Vector3());
  private readonly previousRotations: BoneMap<Quaternion> = createBoneMap(() => new Quaternion());
  private wasAirCategory = false;
  private readonly forwardAxis = new Vector3();
  /** Eases the manual spine bend toward the requested angle so buttons and sliders never snap the torso. */
  private readonly manualBend = new SpringDamper(0, 7, 1);
  /** Smoothed world velocity that drives animation (the controller's own velocity stays exact). */
  readonly animVelocity = new Vector3();
  /** Smoothed copy of the commanded velocity used only for foot placement. */
  readonly placementTarget = new Vector3();
  private readonly scratchPoint = new Vector3();
  private readonly scratchGround = createGroundHit();
  private readonly capsule: CapsuleSpec;

  private constructor(physics: PhysicsWorld, options: SimulationOptions) {
    const config = options.config ?? DEFAULT_CHARACTER_CONFIG;
    this.capsule = options.capsule ?? DEFAULT_CAPSULE;
    this.physics = physics;
    this.clock = new SimulationClock(options.fixedDt ?? FIXED_DT);
    this.tuning = { ...DEFAULT_TUNING, ...options.tuning };
    this.rig = new CharacterRig(config);
    this.pose = new Pose(this.rig.restPelvisPosition);
    this.controller = new CharacterController(physics.createCharacter(this.capsule));
    this.gait = new GaitController({ geometry: this.rig.foot, ankleHeight: config.proportions.ankleHeight });
    this.reset();
  }

  static async create(options: SimulationOptions = {}): Promise<CharacterSimulation> {
    const dt = options.fixedDt ?? FIXED_DT;
    const physics = await PhysicsWorld.create(dt, options.terrain ?? "flat");
    return new CharacterSimulation(physics, options);
  }

  get dt(): number {
    return this.clock.fixedDt;
  }

  get state(): AnimationStateId {
    return this.machine.current;
  }

  get position(): Vector3 {
    return this.controller.position;
  }

  /** Velocity along the facing axis (positive forward) and toward the left. */
  get localVelocity(): { forward: number; left: number } {
    const { x, z } = this.controller.velocity;
    const yaw = this.controller.yaw;
    return { forward: x * Math.sin(yaw) + z * Math.cos(yaw), left: x * Math.cos(yaw) - z * Math.sin(yaw) };
  }

  // ---- Commands -------------------------------------------------------------------------------

  /** Asks for a movement speed (m/s) along the current heading. */
  setSpeed(metersPerSecond: number): void {
    this.speedCommand = Math.max(0, metersPerSecond);
  }

  /** Sets the direction of travel in radians (0 is +Z, positive turns toward +X). */
  setHeading(radians: number): void {
    this.command.heading = radians;
  }

  /** `movement` faces the way the body travels; `locked` holds a fixed facing so the body can strafe or backpedal. */
  setFacing(mode: FacingMode, lockedYaw = this.controller.yaw): void {
    this.command.facing = mode;
    this.command.lockedYaw = lockedYaw;
  }

  jumpNow(): boolean {
    return this.jump.request(this.controller);
  }

  setTerrain(preset: TerrainPreset): void {
    this.physics.setTerrain(buildTerrain(preset));
    this.reset();
  }

  /** Returns the character to the origin, standing, with all dynamic state cleared. */
  reset(): void {
    this.speedCommand = 0;
    this.command.heading = 0;
    this.command.facing = "movement";
    this.command.desiredVelocity.set(0, 0, 0);
    this.controller.teleport(this.origin, 0);
    this.machine.reset();
    this.blender.reset();
    this.dynamics.reset();
    this.secondary.reset();
    this.jump.reset();
    this.generator.reset();
    this.airborne = 0;
    this.animVelocity.set(0, 0, 0);
    this.placementTarget.set(0, 0, 0);
    this.manualBend.reset(0);
    this.wasAirCategory = false;
    this.timelineActive = false;
    for (let i = 0; i < SETTLE_STEPS; i++) this.runStep(true);
    this.gait.reset(this.controller.position, this.controller.yaw, this.physics);
    for (let i = 0; i < SETTLE_STEPS; i++) this.runStep(true);
    this.stepCount = 0;
    this.clock.reset();
    this.snapshotPrevious();
  }

  // ---- Stepping -------------------------------------------------------------------------------

  /** Advances by real time; runs however many whole fixed steps fit. Returns the interpolation alpha. */
  advance(realDeltaSeconds: number): number {
    const { steps, alpha } = this.clock.advance(realDeltaSeconds);
    for (let i = 0; i < steps; i++) this.step();
    return alpha;
  }

  /** Runs one fixed step and records the previous transforms for render interpolation. */
  step(): void {
    this.snapshotPrevious();
    this.runStep(false);
    this.stepCount += 1;
    for (const observer of this.observers) observer(this);
  }

  /** Runs `seconds` of simulation in fixed steps (for tests and headless tools). */
  run(seconds: number, perStep?: (simulation: CharacterSimulation) => void): void {
    const steps = Math.round(seconds / this.clock.fixedDt);
    for (let i = 0; i < steps; i++) {
      this.step();
      perStep?.(this);
    }
  }

  private snapshotPrevious(): void {
    for (const name of BONE_NAMES) {
      this.previousPositions[name].copy(this.rig.worldPosition[name]);
      this.previousRotations[name].copy(this.rig.worldRotation[name]);
    }
  }

  /** World transform of a bone interpolated between the last two steps. */
  interpolated(name: BoneName, alpha: number, position: Vector3, rotation: Quaternion): void {
    position.copy(this.previousPositions[name]).lerp(this.rig.worldPosition[name], alpha);
    rotation.copy(this.previousRotations[name]).slerp(this.rig.worldRotation[name], alpha);
  }

  private runStep(settling: boolean): void {
    const dt = this.clock.fixedDt;
    const tuning = this.tuning;
    const controller = this.controller;
    const command = this.command;

    // Fast movers turn more slowly: the maximum turn rate falls as speed rises, as a runner's does.
    controller.params.turnSpeed = ((tuning.turningSpeed * Math.PI) / 180) / (1 + 0.7 * controller.horizontalSpeed);
    this.forwardAxis.set(Math.sin(command.heading), 0, Math.cos(command.heading));
    command.desiredVelocity.copy(this.forwardAxis).multiplyScalar(this.speedCommand);

    this.jump.update(dt, controller, this.dynamics);
    controller.step(dt, command);
    this.physics.followGround(controller.position.x, controller.position.z);

    // Animation reads a lightly smoothed velocity: stepping onto a ledge or brushing a wall makes the realized
    // displacement flicker for a step or two, and the gait parameters must not follow that flicker.
    this.animVelocity.x = damp(this.animVelocity.x, controller.velocity.x, VELOCITY_SMOOTHING, dt);
    this.animVelocity.z = damp(this.animVelocity.z, controller.velocity.z, VELOCITY_SMOOTHING, dt);
    this.animVelocity.y = controller.velocity.y;
    // Foot placement reads a smoothed request: a button press changes the command instantly, but the braking and
    // acceleration offsets of the next footfall should ease in rather than move the landing spot all at once.
    this.placementTarget.x = damp(this.placementTarget.x, command.desiredVelocity.x, PLACEMENT_SMOOTHING, dt);
    this.placementTarget.z = damp(this.placementTarget.z, command.desiredVelocity.z, PLACEMENT_SMOOTHING, dt);
    const speed = Math.hypot(this.animVelocity.x, this.animVelocity.z);
    const yaw = controller.yaw;
    const local = {
      forward: this.animVelocity.x * Math.sin(yaw) + this.animVelocity.z * Math.cos(yaw),
      left: this.animVelocity.x * Math.cos(yaw) - this.animVelocity.z * Math.sin(yaw),
    };
    const accelForward = controller.acceleration.x * Math.sin(yaw) + controller.acceleration.z * Math.cos(yaw);
    const accelLeft = controller.acceleration.x * Math.cos(yaw) - controller.acceleration.z * Math.sin(yaw);
    // Acceleration along the direction of travel decides accelerate/decelerate regardless of facing.
    const travelAccel = speed > 0.3
      ? (controller.acceleration.x * controller.velocity.x + controller.acceleration.z * controller.velocity.z) / speed
      : accelForward;

    this.dynamics.update(dt, accelForward, accelLeft, speed, controller.yawRate, tuning.forwardLean);
    this.secondary.update(dt, accelForward, accelLeft, controller.yawRate, speed, tuning.secondaryMotion);

    this.gait.update({
      dt,
      root: controller.position,
      yaw,
      yawRate: controller.yawRate,
      velocity: this.animVelocity,
      desiredVelocity: this.placementTarget,
      grounded: controller.grounded,
      inPlace: controller.inPlace,
      tuning,
      ground: this.physics,
    });

    const stepTurning = this.gait.mode === "idle" && (this.gait.feet.l.mode === "swing" || this.gait.feet.r.mode === "swing");
    const next = this.machine.update(dt, {
      speed,
      desiredSpeed: Math.hypot(command.desiredVelocity.x, command.desiredVelocity.z),
      forwardAcceleration: travelAccel,
      grounded: controller.grounded,
      verticalVelocity: controller.velocity.y,
      yawRate: controller.yawRate,
      jumpPhase: this.jump.phase,
      stepTurning,
    });

    const airCategory = next === "jump" || next === "fall";
    if (airCategory !== this.wasAirCategory && !settling) this.blender.beginCrossfade(this.pose, tuning.blendDuration * 0.6);
    this.wasAirCategory = airCategory;
    this.blender.blendDuration = tuning.blendDuration;
    this.blender.setTarget(next);
    this.blender.update(dt);

    // The airborne leg shape fades in over the first moments of flight, so a planted foot is released at once
    // but the leg never snaps from a push-off to a tuck.
    const airTarget = controller.grounded ? 0 : clamp01(controller.airTime / 0.06);
    // On touchdown the planted feet are created exactly where the air feet are, so there is nothing left to blend;
    // easing out the air shape would let planted feet travel with the body.
    if (controller.justLanded) this.airborne = 0;
    this.airborne = damp(this.airborne, airTarget, airTarget > this.airborne ? 9 : 18, dt);

    this.generator.generate(
      {
        time: this.stepCount * dt,
        dt,
        rig: this.rig,
        gait: this.gait,
        tuning,
        style: this.blender.style,
        dynamics: this.dynamics,
        secondary: this.secondary.output,
        jump: this.jump,
        ground: this.physics,
        root: controller.position,
        yaw,
        yawRate: controller.yawRate,
        forwardSpeed: local.forward,
        leftSpeed: local.left,
        velocity: this.animVelocity,
        speed,
        airborne: this.airborne,
        manualBend: this.manualBend.update(tuning.spineBend * DEG, dt),
        justLanded: controller.justLanded,
      },
      this.pose,
    );
    this.blender.applyCrossfade(dt, this.pose);

    this.rootQuat.setFromAxisAngle(yAxis, yaw);
    this.rig.setRootTransform(controller.position, this.rootQuat);
    solveLegs(this.rig, this.pose, this.generator.legTargets, this.legReports);
    if (this.liftFreeFeet()) solveLegs(this.rig, this.pose, this.generator.legTargets, this.legReports);

    // While airborne the legs are not on a plant; remember where they are so the landing re-plants there.
    if (this.airborne > 0.01 || !controller.grounded) {
      for (const side of ["l", "r"] as const) this.gait.feet[side].ankle.copy(this.generator.legTargets[side].ankle);
    }

    if (this.timelineActive) this.applyTimeline(dt);
    this.clampedBones.length = 0;
    this.limitCorrections = this.pose.enforceLimits(this.clampedBones, this.clampDetails ?? undefined);
    this.rig.updateWorld(this.pose);
  }

  /**
   * Final-pose check for feet that are not planted: if the solved heel, ball or toe is below the terrain, raise
   * that foot's target by the shortfall (so a leg bent by the knee limit or a relaxed ankle cannot dig in).
   * Returns true when a target changed and the legs must be solved again.
   */
  private liftFreeFeet(): boolean {
    let changed = false;
    for (const side of ["l", "r"] as const) {
      const foot = this.gait.feet[side];
      if (foot.mode === "stance" && this.airborne < 0.001) continue;
      let deficit = 0;
      for (const key of ["heel", "ball", "toeTip"] as const) {
        this.rig.footPoint(side, key, this.scratchPoint);
        const hit = this.physics.sample(this.scratchPoint.x, this.scratchPoint.z, this.scratchPoint.y + 0.3, this.scratchGround);
        if (hit.found) deficit = Math.max(deficit, hit.height + 0.004 - this.scratchPoint.y);
      }
      if (deficit > 0) {
        this.generator.legTargets[side].ankle.y += deficit;
        changed = true;
      }
    }
    return changed;
  }

  private applyTimeline(dt: number): void {
    this.timeline.update(dt);
    const evaluated = this.timeline.evaluate();
    for (const name of BONE_NAMES) {
      if ((this.timeline.clip.tracks[name]?.length ?? 0) > 0) this.pose.rotations[name].copy(evaluated.rotations[name]);
    }
  }

  dispose(): void {
    this.observers.length = 0;
    this.physics.dispose();
  }
}
