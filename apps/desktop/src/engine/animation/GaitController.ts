import { Quaternion, Vector3 } from "three";
import type { FootGeometry, Side } from "../character/types";
import { clamp, clamp01, damp, fract, smoothstep, wrapPi } from "../core/math";
import {
  copyFootFrame,
  createFootFrame,
  evaluateSwing,
  flatFootOrientation,
  placeFootOnGround,
  rollFoot,
  stancePitch,
  type FootFrame,
} from "../ik/FootPlacement";
import type { GroundProvider } from "../physics/GroundDetection";
import { createGaitProfile, profileForSpeed, runness, type GaitProfile } from "./GaitProfiles";
import { SPEED_FAST_RUN, SPEED_RUN, SPEED_SPRINT, SPEED_WALK, type AnimationTuning } from "./types";

export type FootMode = "stance" | "swing";
export type GaitMode = "idle" | "moving";

export interface GaitEvent {
  readonly type: "touchdown" | "liftoff";
  readonly side: Side;
  readonly position: Vector3;
}

export interface GaitInput {
  readonly dt: number;
  /** Ground point under the character. */
  readonly root: Vector3;
  readonly yaw: number;
  /** Turn rate (rad/s), used to aim landings at the facing the body will have when the foot arrives. */
  readonly yawRate: number;
  /** Actual horizontal velocity. */
  readonly velocity: Vector3;
  /** Horizontal velocity the player is asking for. */
  readonly desiredVelocity: Vector3;
  readonly grounded: boolean;
  /** Treadmill mode: the root stays put while the plants slide backward at the commanded speed. */
  readonly inPlace: boolean;
  readonly tuning: AnimationTuning;
  readonly ground: GroundProvider;
}

export interface GaitBody {
  readonly geometry: FootGeometry;
  readonly ankleHeight: number;
}

/** One foot's gait state and its resulting world pose. */
export interface FootRuntime {
  readonly side: Side;
  mode: FootMode;
  /** This foot's phase in [0, 1). Stance is [0, duty), swing is [duty, 1). */
  phase: number;
  stanceProgress: number;
  swingProgress: number;
  /** Phase at which the current swing began (normally the duty factor). */
  swingStartPhase: number;
  /** Time-driven swings (idle steps) use this instead of the gait phase. */
  swingTimer: number;
  swingDuration: number;
  timedSwing: boolean;
  /** The plant (stance) or the landing spot (swing). */
  readonly frame: FootFrame;
  readonly target: FootFrame;
  readonly originFrame: FootFrame;
  readonly originAnkle: Vector3;
  originPitch: number;
  pitch: number;
  /** Locked ankle pose in world space. */
  readonly ankle: Vector3;
  readonly rotation: Quaternion;
  toeFlex: number;
  /** Where the ankle would be if the foot simply followed the body (used when IK strength is below one). */
  readonly followAnkle: Vector3;
  readonly followRotation: Quaternion;
  /** Ankle position the swinging foot is heading for (at touchdown). */
  readonly landingAnkle: Vector3;
  /** Estimated seconds until this swinging foot touches down. */
  swingRemaining: number;
  /** Plant position relative to the root at touchdown, in the facing frame. */
  readonly plantLocal: Vector3;
  readonly nominalLocalVelocity: Vector3;
  plantAge: number;
  contact: boolean;
  /** Smoothed 0..1 support amount, for weight shift. */
  support: number;
}

const OFFSET_PHASE: Record<Side, number> = { l: 0, r: 0.5 };
const TOE_OUT = 0.09;
/** Cycles per second used to finish an in-progress step when the character stops. */
const FINISH_RATE = 1.1;
const START_SPEED = 0.3;
const STOP_SPEED = 0.15;
const IDLE_STEP_DISTANCE = 0.2;
const IDLE_STEP_YAW = 0.42;
const IDLE_STEP_DURATION = 0.34;
const MAX_CAPTURE_OFFSET = 0.4;
/** Farthest the foot lands ahead of the hip (meters); beyond this the straightened leg cannot keep the pelvis up. */
const MAX_LANDING_AHEAD = 0.42;
/** Farthest a planted foot may trail the hip before it must lift (meters). */
const MAX_TRAILING = 0.62;
/** How quickly a swinging foot's landing spot follows a changed aim (1/s). */
const TARGET_FOLLOW_RATE = 18;
/** How far a planted foot may drift toward, or past, the body midline and out to the side before it must lift (meters). */
const STANCE_CROSS_MARGIN = 0.02;
const MAX_STANCE_SIDE = 0.36;
/** A planted foot follows the body heading once it is off by more than this (radians), pivoting about its contact point. */
const PIVOT_DEADZONE = 0.25;
const PIVOT_GAIN = 12;
const PIVOT_MAX_RATE = 6;
/** Landing distance ahead of the hip, including the braking offset, never exceeds this. */
const MAX_TOTAL_AHEAD = 0.58;
const MAX_SETTLING_AHEAD = 0.34;
/** Limits for stepping backward and sideways (meters from the hip). */
const MAX_BEHIND_LANDING = 0.5;
/** Lateral distance of a landing from the body center: never closer than the minimum, never wider than the maximum. */
const MIN_SIDE_LANDING = 0.035;
const MAX_SIDE_LANDING = 0.3;
const CAPTURE_GAIN = 0.25;
const CANONICAL_SPEEDS = [0, SPEED_WALK, SPEED_RUN, SPEED_FAST_RUN, SPEED_SPRINT] as const;

const scratchForward = new Vector3();
const scratchLeft = new Vector3();
const scratchTarget = new Vector3();
const scratchDir = new Vector3();

function createFoot(side: Side): FootRuntime {
  return {
    side,
    mode: "stance",
    phase: 0,
    stanceProgress: 0.5,
    swingProgress: 0,
    swingStartPhase: 0,
    swingTimer: 0,
    swingDuration: IDLE_STEP_DURATION,
    timedSwing: false,
    frame: createFootFrame(),
    target: createFootFrame(),
    originFrame: createFootFrame(),
    originAnkle: new Vector3(),
    originPitch: 0,
    pitch: 0,
    ankle: new Vector3(),
    rotation: new Quaternion(),
    toeFlex: 0,
    followAnkle: new Vector3(),
    followRotation: new Quaternion(),
    landingAnkle: new Vector3(),
    swingRemaining: 0,
    plantLocal: new Vector3(),
    nominalLocalVelocity: new Vector3(),
    plantAge: 0,
    contact: true,
    support: 1,
  };
}

function nearestCanonicalSpeed(speed: number): number {
  let best = 0;
  for (const candidate of CANONICAL_SPEEDS) if (Math.abs(candidate - speed) < Math.abs(best - speed)) best = candidate;
  return best;
}

/**
 * Cyclic gait with explicit contact events. One master phase drives both feet (offset by half a cycle).
 * A foot is either planted at a fixed world position (stance) or following a trajectory to the next
 * footfall (swing). Idle uses timed corrective steps instead of the cycle.
 */
export class GaitController {
  readonly feet: Record<Side, FootRuntime> = { l: createFoot("l"), r: createFoot("r") };
  readonly profile: GaitProfile = createGaitProfile();
  readonly events: GaitEvent[] = [];
  mode: GaitMode = "idle";
  /** Master cycle phase in [0, 1). */
  phase = 0;
  /** Full stride (two steps) length for the current speed and tuning. */
  strideLength = 1;
  /** Steps per second. */
  cadence = 0;
  duty = 0.6;
  /** 0 for a walking gait, 1 for a running gait. */
  run = 0;
  stopping = false;
  speed = 0;
  /** +1 when the left foot carries the body, -1 for the right, 0 when shared. */
  weightShift = 0;
  private airborne = false;
  private nextSwingSide: Side = "r";
  private readonly body: GaitBody;

  constructor(body: GaitBody) {
    this.body = body;
  }

  /** Places both feet flat and side by side under the body. */
  reset(root: Vector3, yaw: number, ground: GroundProvider): void {
    this.mode = "idle";
    this.stopping = false;
    this.airborne = false;
    this.phase = 0;
    for (const side of ["l", "r"] as const) {
      const foot = this.feet[side];
      this.idleSpot(side, root, yaw, scratchTarget);
      placeFootOnGround(ground, scratchTarget.x, scratchTarget.z, yaw + (side === "l" ? TOE_OUT : -TOE_OUT), root.y + 0.3, this.body.geometry, this.body.ankleHeight, foot.frame);
      foot.mode = "stance";
      foot.pitch = 0;
      foot.stanceProgress = 0.5;
      foot.contact = true;
      foot.support = 1;
      foot.plantAge = 0;
      this.storePlant(foot, root, yaw, 0, scratchDir.set(0, 0, 0));
      this.refreshStance(foot, root, yaw, 0, 1 / 120);
    }
  }

  /** Re-plants both feet where they currently are, projected onto the ground. Used after a jump. */
  landed(root: Vector3, yaw: number, ground: GroundProvider): void {
    for (const side of ["l", "r"] as const) {
      const foot = this.feet[side];
      placeFootOnGround(ground, foot.ankle.x, foot.ankle.z, yaw + (side === "l" ? TOE_OUT : -TOE_OUT), root.y + 0.3, this.body.geometry, this.body.ankleHeight, foot.frame);
      foot.mode = "stance";
      foot.pitch = 0;
      foot.contact = true;
      foot.stanceProgress = 0.5;
      this.storePlant(foot, root, yaw, 0, scratchDir.set(0, 0, 0));
    }
    this.mode = "idle";
    this.stopping = false;
  }

  /** The foot to be used as the next stance-leading foot is whichever did not step last. */
  private startMoving(): void {
    this.mode = "moving";
    this.stopping = false;
    const mover = this.nextSwingSide;
    this.nextSwingSide = mover === "l" ? "r" : "l";
    const support: Side = mover === "l" ? "r" : "l";
    // The support foot is mid-stance and the mover is mid-swing, so the first step is neither cut short nor stretched.
    this.phase = fract((mover === "l" ? 0.5 : 0) + this.duty / 2);
    const moverFoot = this.feet[mover];
    const supportFoot = this.feet[support];
    supportFoot.mode = "stance";
    supportFoot.phase = fract(this.phase + OFFSET_PHASE[support]);
    supportFoot.stanceProgress = 0.5;
    supportFoot.contact = true;
    supportFoot.timedSwing = false;
    moverFoot.phase = fract(this.phase + OFFSET_PHASE[mover]);
    this.beginSwing(moverFoot, moverFoot.phase, false);
  }

  update(input: GaitInput): void {
    this.events.length = 0;
    const { dt, root, yaw, velocity, grounded, tuning } = input;
    this.speed = Math.hypot(velocity.x, velocity.z);
    const desiredSpeed = Math.hypot(input.desiredVelocity.x, input.desiredVelocity.z);

    profileForSpeed(this.speed, this.profile);
    this.profile.swingHeight *= tuning.kneeLift;
    // Heel strike and toe-off belong to forward travel; stepping backward or sideways lands and leaves flat-footed.
    const forwardness = this.speed > 0.1 ? clamp((velocity.x * Math.sin(input.yaw) + velocity.z * Math.cos(input.yaw)) / this.speed, 0, 1) : 1;
    this.profile.heelStrike *= forwardness;
    this.profile.toeOff *= 0.3 + 0.7 * forwardness;
    this.duty = this.profile.duty;
    this.run = runness(this.duty);
    // The leg reaches far less to the side (and backward) than forward, so those strides are shorter and quicker.
    const alongFacing = this.speed > 0.1 ? (velocity.x * Math.sin(input.yaw) + velocity.z * Math.cos(input.yaw)) / this.speed : 1;
    const directionScale = alongFacing >= 0 ? 1 - 0.62 * (1 - alongFacing) : 0.8 - 0.3 * (-alongFacing);
    this.strideLength = Math.max(0.25, (2 * this.profile.stepLength * tuning.strideLength * directionScale) / tuning.stepFrequency);
    this.cadence = this.speed > 1e-3 ? (2 * this.speed) / this.strideLength : 0;

    if (!grounded) {
      this.airborne = true;
      return;
    }
    if (this.airborne) {
      this.airborne = false;
      this.landed(root, yaw, input.ground);
    }

    if (this.mode === "idle" && this.speed > START_SPEED && desiredSpeed > 0.1) {
      this.startMoving();
    } else if (this.mode === "moving" && !this.stopping && this.speed < STOP_SPEED && desiredSpeed < 0.1) {
      this.stopping = true;
    }

    if (this.mode === "moving") this.updateCycle(input);
    else this.updateIdle(input);

    this.updateWeightShift(dt);
  }

  private updateCycle(input: GaitInput): void {
    const { dt, root, yaw, velocity } = input;
    const naturalRate = this.speed / this.strideLength;
    const rate = this.stopping ? Math.max(naturalRate, FINISH_RATE) : naturalRate;
    this.phase = fract(this.phase + rate * dt);

    for (const side of ["l", "r"] as const) {
      const foot = this.feet[side];
      const previous = foot.phase;
      foot.phase = fract(this.phase + OFFSET_PHASE[side]);
      if (foot.mode === "stance" && foot.phase >= previous && (foot.phase >= this.duty || this.outOfReach(foot, input))) {
        // Normally the phase ends the stance; if the body is accelerating away from a planted foot, the foot
        // lifts early rather than being dragged past the reach of the leg.
        this.beginSwing(foot, foot.phase, true);
        this.events.push({ type: "liftoff", side, position: foot.originAnkle.clone() });
      } else if (foot.mode === "swing" && foot.phase < previous) {
        this.touchDown(foot, root, yaw, velocity);
      }
    }

    for (const side of ["l", "r"] as const) {
      const foot = this.feet[side];
      if (foot.mode === "swing") {
        foot.swingProgress = clamp01((foot.phase - foot.swingStartPhase) / Math.max(1 - foot.swingStartPhase, 1e-3));
        const untilTouchdown = (1 - foot.phase) / Math.max(rate, 0.3);
        foot.swingRemaining = Math.max(untilTouchdown, 0);
        // No lower bound: at touchdown the target must be exactly where the hip will be, not a moment later.
        this.aimSwing(foot, input, clamp(untilTouchdown, 0, 0.7));
        this.evaluateSwingFoot(foot);
      } else {
        foot.stanceProgress = clamp01(foot.phase / Math.max(this.duty, 1e-3));
        const target = stancePitch(foot.stanceProgress, this.profile.heelStrike, this.profile.toeOff, this.profile.heelRise);
        this.refreshStance(foot, root, yaw, target, dt);
      }
      if (input.inPlace && foot.mode === "stance") {
        foot.frame.flatAnkle.x -= velocity.x * dt;
        foot.frame.flatAnkle.z -= velocity.z * dt;
      }
      foot.plantAge += dt;
    }

    if (this.stopping && this.feet.l.mode === "stance" && this.feet.r.mode === "stance") {
      this.mode = "idle";
      this.stopping = false;
    }
  }

  /**
   * True when a planted foot has ended up where the leg cannot comfortably stay: too far behind or ahead of the
   * hip, or across to the wrong side of the body (as happens when the body turns or sidesteps away from it).
   */
  private outOfReach(foot: FootRuntime, input: GaitInput): boolean {
    if (this.speed < 0.5 || foot.stanceProgress < 0.2) return false;
    const dx = foot.frame.flatAnkle.x - input.root.x;
    const dz = foot.frame.flatAnkle.z - input.root.z;
    const forward = dx * Math.sin(input.yaw) + dz * Math.cos(input.yaw);
    const left = dx * Math.cos(input.yaw) - dz * Math.sin(input.yaw);
    if (forward < -MAX_TRAILING || forward > MAX_TOTAL_AHEAD + 0.12) return true;
    return foot.side === "l" ? left < -STANCE_CROSS_MARGIN || left > MAX_STANCE_SIDE : left > STANCE_CROSS_MARGIN || left < -MAX_STANCE_SIDE;
  }

  private updateIdle(input: GaitInput): void {
    const { dt, root, yaw, ground } = input;
    // Corrective steps: planted feet that drift too far from the body, or point too far from its heading, re-step.
    const stepping = this.feet.l.mode === "swing" || this.feet.r.mode === "swing";
    if (!stepping) {
      let worst: FootRuntime | null = null;
      let worstScore = 1;
      for (const side of ["l", "r"] as const) {
        const foot = this.feet[side];
        this.idleSpot(side, root, yaw, scratchTarget);
        const distance = Math.hypot(foot.frame.flatAnkle.x - scratchTarget.x, foot.frame.flatAnkle.z - scratchTarget.z);
        const yawError = Math.abs(wrapPi(foot.frame.yaw - (yaw + (side === "l" ? TOE_OUT : -TOE_OUT))));
        const score = Math.max(distance / IDLE_STEP_DISTANCE, yawError / IDLE_STEP_YAW);
        if (score > worstScore) {
          worst = foot;
          worstScore = score;
        }
      }
      if (worst) this.beginTimedStep(worst, root, yaw, ground);
    }

    for (const side of ["l", "r"] as const) {
      const foot = this.feet[side];
      if (foot.mode === "swing") {
        foot.swingTimer += dt;
        foot.swingProgress = clamp01(foot.swingTimer / foot.swingDuration);
        foot.swingRemaining = Math.max(foot.swingDuration - foot.swingTimer, 0);
        this.idleSpot(side, root, yaw, scratchTarget);
        placeFootOnGround(ground, scratchTarget.x, scratchTarget.z, yaw + (side === "l" ? TOE_OUT : -TOE_OUT), root.y + 0.3, this.body.geometry, this.body.ankleHeight, foot.target);
        this.evaluateSwingFoot(foot);
        if (foot.swingProgress >= 1) this.touchDown(foot, root, yaw, scratchDir.set(0, 0, 0));
      } else {
        this.refreshStance(foot, root, yaw, 0, dt);
      }
      foot.plantAge += dt;
    }
  }

  private idleSpot(side: Side, root: Vector3, yaw: number, out: Vector3): Vector3 {
    const sign = side === "l" ? 1 : -1;
    scratchLeft.set(Math.cos(yaw), 0, -Math.sin(yaw));
    return out.copy(root).addScaledVector(scratchLeft, sign * this.profile.footWidth);
  }

  private beginTimedStep(foot: FootRuntime, root: Vector3, yaw: number, ground: GroundProvider): void {
    this.beginSwing(foot, 0, false);
    foot.timedSwing = true;
    foot.swingTimer = 0;
    foot.swingDuration = IDLE_STEP_DURATION;
    this.idleSpot(foot.side, root, yaw, scratchTarget);
    placeFootOnGround(ground, scratchTarget.x, scratchTarget.z, yaw, root.y + 0.3, this.body.geometry, this.body.ankleHeight, foot.target);
    this.events.push({ type: "liftoff", side: foot.side, position: foot.originAnkle.clone() });
  }

  private beginSwing(foot: FootRuntime, startPhase: number, fromStance: boolean): void {
    foot.mode = "swing";
    foot.contact = false;
    foot.timedSwing = false;
    foot.swingStartPhase = startPhase;
    foot.swingProgress = 0;
    copyFootFrame(foot.originFrame, foot.frame);
    foot.originAnkle.copy(foot.ankle);
    foot.originPitch = foot.pitch;
    if (!fromStance) copyFootFrame(foot.target, foot.frame);
  }

  private touchDown(foot: FootRuntime, root: Vector3, yaw: number, velocity: Vector3): void {
    copyFootFrame(foot.frame, foot.target);
    foot.mode = "stance";
    foot.contact = true;
    foot.stanceProgress = 0;
    foot.timedSwing = false;
    foot.pitch = -this.profile.heelStrike;
    this.storePlant(foot, root, yaw, this.speed, velocity);
    this.events.push({ type: "touchdown", side: foot.side, position: foot.frame.flatAnkle.clone() });
  }

  /** Records where the foot landed relative to the body, for the follow-the-body (IK off) behavior. */
  private storePlant(foot: FootRuntime, root: Vector3, yaw: number, speed: number, velocity: Vector3): void {
    scratchTarget.copy(foot.frame.flatAnkle).sub(root);
    foot.plantLocal.set(
      scratchTarget.x * Math.cos(yaw) - scratchTarget.z * Math.sin(yaw),
      scratchTarget.y,
      scratchTarget.x * Math.sin(yaw) + scratchTarget.z * Math.cos(yaw),
    );
    const nominal = nearestCanonicalSpeed(speed);
    if (speed > 1e-3) {
      const vx = (velocity.x / speed) * nominal;
      const vz = (velocity.z / speed) * nominal;
      foot.nominalLocalVelocity.set(vx * Math.cos(yaw) - vz * Math.sin(yaw), 0, vx * Math.sin(yaw) + vz * Math.cos(yaw));
    } else {
      foot.nominalLocalVelocity.set(0, 0, 0);
    }
    foot.plantAge = 0;
  }

  /** Aims the landing frame of a swinging foot using a capture-point style placement. */
  private aimSwing(foot: FootRuntime, input: GaitInput, remaining: number): void {
    const { root, velocity, desiredVelocity, ground } = input;
    // Aim in the facing the body will have at touchdown, not the one it has now.
    const yaw = input.yaw + input.yawRate * remaining;
    const sign = foot.side === "l" ? 1 : -1;
    scratchForward.set(root.x + velocity.x * remaining, root.y, root.z + velocity.z * remaining);
    scratchLeft.set(Math.cos(yaw), 0, -Math.sin(yaw));
    scratchTarget.copy(scratchForward).addScaledVector(scratchLeft, sign * this.profile.footWidth);

    if (this.speed > 0.05) {
      // Land ahead of the body by half the distance it travels while the foot is down, so the stance is centered.
      // Walking centers the stance on the hip; running lands closer to the body and leaves farther behind it,
      // because the stance leg can push back much farther than it can reach forward.
      const centered = this.duty * this.strideLength;
      const reach = Math.min(centered * (0.5 - 0.17 * this.run), MAX_LANDING_AHEAD) * smoothstep(this.speed / 0.6);
      scratchTarget.x += (velocity.x / this.speed) * reach;
      scratchTarget.z += (velocity.z / this.speed) * reach;
    }
    // Braking: step farther ahead the more the body is over-speed relative to the request (capture point).
    scratchDir.set(velocity.x - desiredVelocity.x, 0, velocity.z - desiredVelocity.z);
    const excess = scratchDir.length();
    if (excess > 1e-3) {
      const offset = Math.min(excess * CAPTURE_GAIN, MAX_CAPTURE_OFFSET);
      scratchTarget.addScaledVector(scratchDir, offset / excess);
    }
    // Whatever the placement rules ask for, the foot never lands farther ahead of the hip than the leg can reach.
    scratchDir.set(
      scratchTarget.x - scratchForward.x - scratchLeft.x * sign * this.profile.footWidth,
      0,
      scratchTarget.z - scratchForward.z - scratchLeft.z * sign * this.profile.footWidth,
    );
    // Limit the landing offset per axis: far forward is fine, far to the side tilts the ankle past its range.
    const forwardOffset = scratchDir.x * Math.sin(yaw) + scratchDir.z * Math.cos(yaw);
    const leftOffset = scratchDir.x * scratchLeft.x + scratchDir.z * scratchLeft.z;
    // When nothing is asking for movement any more, the last steps stay close to the body so it can settle.
    const settling = Math.hypot(desiredVelocity.x, desiredVelocity.z) < 0.5 ? MAX_SETTLING_AHEAD : MAX_TOTAL_AHEAD;
    const forwardClamped = clamp(forwardOffset, -MAX_BEHIND_LANDING, settling);
    scratchTarget.x += (forwardClamped - forwardOffset) * Math.sin(yaw);
    scratchTarget.z += (forwardClamped - forwardOffset) * Math.cos(yaw);
    void leftOffset;
    // Each foot stays on its own side of the body: sidestepping or turning must never cross the legs.
    const lateral = (scratchTarget.x - scratchForward.x) * scratchLeft.x + (scratchTarget.z - scratchForward.z) * scratchLeft.z;
    const lateralClamped = sign > 0 ? clamp(lateral, MIN_SIDE_LANDING, MAX_SIDE_LANDING) : clamp(lateral, -MAX_SIDE_LANDING, -MIN_SIDE_LANDING);
    scratchTarget.x += (lateralClamped - lateral) * scratchLeft.x;
    scratchTarget.z += (lateralClamped - lateral) * scratchLeft.z;
    const toeOut = foot.side === "l" ? TOE_OUT : -TOE_OUT;
    const previousX = foot.target.flatAnkle.x;
    const previousZ = foot.target.flatAnkle.z;
    placeFootOnGround(
      ground,
      scratchTarget.x,
      scratchTarget.z,
      yaw + toeOut * (1 - this.run * 0.6),
      Math.max(root.y, foot.originAnkle.y - this.body.ankleHeight) + 0.3,
      this.body.geometry,
      this.body.ankleHeight,
      foot.target,
    );
    // The landing spot is re-aimed every step as speed and heading change. A foot far along its swing would jump by
    // almost the whole change, so the horizontal target eases toward the new aim instead of following it instantly.
    if (foot.swingProgress > 0.02) {
      const follow = 1 - Math.exp(-TARGET_FOLLOW_RATE * input.dt);
      foot.target.flatAnkle.x = previousX + (foot.target.flatAnkle.x - previousX) * follow;
      foot.target.flatAnkle.z = previousZ + (foot.target.flatAnkle.z - previousZ) * follow;
    }
  }

  private evaluateSwingFoot(foot: FootRuntime): void {
    const pitch = evaluateSwing(
      {
        originAnkle: foot.originAnkle,
        originFrame: foot.originFrame,
        originPitch: foot.originPitch,
        target: foot.target,
        landingPitch: -this.profile.heelStrike,
      },
      foot.swingProgress,
      foot.timedSwing ? 0.07 : this.profile.swingHeight,
      this.profile.heelStrike,
      this.body.geometry,
      foot.ankle,
      foot.rotation,
      foot.landingAnkle,
    );
    foot.pitch = pitch;
    foot.toeFlex = -Math.max(pitch, 0);
    foot.followAnkle.copy(foot.ankle);
    foot.followRotation.copy(foot.rotation);
  }

  /** Pose of a planted foot for the requested pitch, locked to the world and (for IK < 1) the body-following alternative. */
  /**
   * Turns a planted foot toward the body heading about its contact point (heel or ball), so a long stance during a
   * turn cannot twist the hip past its limit. The contact point itself never moves.
   */
  private pivotStance(foot: FootRuntime, yaw: number, dt: number): void {
    const target = yaw + (foot.side === "l" ? TOE_OUT : -TOE_OUT);
    const error = wrapPi(target - foot.frame.yaw);
    const excess = Math.abs(error) - PIVOT_DEADZONE;
    if (excess <= 0) return;
    const delta = Math.sign(error) * Math.min(Math.min(excess * PIVOT_GAIN, PIVOT_MAX_RATE) * dt, excess);
    const pivot = foot.pitch < 0 ? this.body.geometry.heel : this.body.geometry.ball;
    scratchLeft.copy(pivot).applyQuaternion(foot.frame.q0).add(foot.frame.flatAnkle);
    foot.frame.yaw = wrapPi(foot.frame.yaw + delta);
    flatFootOrientation(foot.frame.yaw, foot.frame.normal, foot.frame.q0);
    foot.frame.flatAnkle.copy(scratchLeft).sub(scratchDir.copy(pivot).applyQuaternion(foot.frame.q0));
  }

  private refreshStance(foot: FootRuntime, root: Vector3, yaw: number, targetPitch: number, dt: number): void {
    this.pivotStance(foot, yaw, dt);
    foot.pitch = damp(foot.pitch, targetPitch, 45, dt);
    rollFoot(foot.frame, foot.pitch, this.body.geometry, foot.ankle, foot.rotation);
    foot.toeFlex = -Math.max(foot.pitch, 0);

    // Alternative target that moves with the body at a fixed nominal speed (what a canned clip would do).
    const age = foot.plantAge;
    const lx = foot.plantLocal.x - foot.nominalLocalVelocity.x * age;
    const lz = foot.plantLocal.z - foot.nominalLocalVelocity.z * age;
    const wx = lx * Math.cos(yaw) + lz * Math.sin(yaw);
    const wz = -lx * Math.sin(yaw) + lz * Math.cos(yaw);
    const saved = foot.frame.flatAnkle.clone();
    foot.frame.flatAnkle.set(root.x + wx, root.y + foot.plantLocal.y, root.z + wz);
    rollFoot(foot.frame, foot.pitch, this.body.geometry, foot.followAnkle, foot.followRotation);
    foot.frame.flatAnkle.copy(saved);
  }

  private updateWeightShift(dt: number): void {
    for (const side of ["l", "r"] as const) {
      const foot = this.feet[side];
      foot.support = damp(foot.support, foot.mode === "stance" ? 1 : 0, 14, dt);
    }
    const target = (this.feet.l.support - this.feet.r.support) / Math.max(this.feet.l.support + this.feet.r.support, 0.5);
    this.weightShift = damp(this.weightShift, clamp(target, -1, 1), 12, dt);
  }
}
