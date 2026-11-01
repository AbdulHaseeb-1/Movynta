import { Quaternion, Vector3 } from "three";
import type { CharacterRig } from "../character/CharacterRig";
import type { Pose } from "../character/Pose";
import { armBones, legBones, sideSign, type Side } from "../character/types";
import { SpringDamper, clamp, damp, fract, quatFromEuler, smoothstep } from "../core/math";
import { createLegTarget, type LegTarget } from "../ik/LegIK";
import type { BodyDynamics } from "../motion/BodyDynamics";
import type { SecondaryOutput } from "../motion/SecondaryMotion";
import { SpineController, type SpineResult } from "../motion/SpineController";
import { createGroundHit, type GroundProvider } from "../physics/GroundDetection";
import type { StateStyle } from "./AnimationBlender";
import type { GaitController, FootRuntime } from "./GaitController";
import type { JumpSequence } from "./JumpSequence";
import type { AnimationTuning } from "./types";

export interface LocomotionContext {
  readonly time: number;
  readonly dt: number;
  readonly rig: CharacterRig;
  readonly gait: GaitController;
  readonly tuning: AnimationTuning;
  readonly style: StateStyle;
  readonly dynamics: BodyDynamics;
  readonly secondary: SecondaryOutput;
  readonly jump: JumpSequence;
  readonly ground: GroundProvider;
  readonly root: Vector3;
  readonly yaw: number;
  readonly yawRate: number;
  /** Speed along the facing axis (negative when backpedaling) and toward the left, m/s. */
  readonly forwardSpeed: number;
  readonly leftSpeed: number;
  /** World-space horizontal velocity. */
  readonly velocity: Vector3;
  readonly speed: number;
  /** Smoothed 0..1 weight of the airborne leg shape. */
  readonly airborne: number;
  /** Manual spine bend in radians (positive forward), already smoothed. */
  readonly manualBend: number;
  /** True for exactly one step: the feet have just touched down after being airborne. */
  readonly justLanded: boolean;
}

export interface LocomotionReport {
  /** True when the pelvis had to be lowered so a foot could still be reached. */
  reachLimited: boolean;
  /** Pelvis height above the ground under the feet. */
  pelvisHeight: number;
  /** Pelvis height the style asked for, and the highest the planted legs allow (local to the root). */
  desiredHeight: number;
  heightLimit: number;
  /** Forward lean applied this frame (radians). */
  lean: number;
  spine: SpineResult;
}

const TOE_AIR = new Vector3(0, 0, 1);
/** Widest a swinging foot may be from the body midline (meters); slightly more than the landing limit, so touchdown is continuous. */
const SWING_SIDE_LIMIT = 0.38;
/** How quickly a foot held to the body after a landing is released into its swing (1/s). */
const LANDING_RELEASE_RATE = 22;
/** Sole clearance kept above terrain for feet that are not planted (meters). */
const CLEARANCE_MARGIN = 0.012;
/**
 * Longest a moving leg is allowed to be, as a fraction of its full length. Near full extension the knee angle changes
 * extremely fast for a tiny change in distance, so a leg in motion is never driven all the way to straight.
 */
const MAX_LEG_EXTENSION = 0.965;
/** Closest the ankle may come to the hip, as a fraction of leg length (a ~130 degree knee bend). */
const MIN_LEG_FRACTION = 0.4;
/** Fastest the pelvis may rise (m/s). */
const MAX_PELVIS_RISE = 1.6;
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
const pelvisWorld = new Vector3();
const hipWorld = new Vector3();
const forwardDir = new Vector3();

/** Rotates a facing-frame offset into world axes (rotation about +Y by `yaw`). */
function toWorld(yaw: number, x: number, z: number, out: Vector3): Vector3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return out.set(x * c + z * s, 0, -x * s + z * c);
}

/**
 * Builds the pelvis, spine, arms and head from the gait's contact state, and turns the gait's foot poses
 * into leg targets. Everything is derived from foot contacts and the actual motion; no limb is driven by
 * an independent oscillator.
 */
export class LocomotionGenerator {
  readonly legTargets: Record<Side, LegTarget> = { l: createLegTarget(), r: createLegTarget() };
  readonly report: LocomotionReport;
  private readonly spine = new SpineController();
  /** Foot rotation (relative to the shin) from the previous step, and from the moment each foot lifted off. */
  private readonly previousFoot: Record<Side, Quaternion> = { l: new Quaternion(), r: new Quaternion() };
  private readonly liftoffFoot: Record<Side, Quaternion> = { l: new Quaternion(), r: new Quaternion() };
  /** Extra height currently added to a swinging or airborne foot so its sole clears the terrain. */
  private readonly clearance: Record<Side, number> = { l: 0, r: 0 };
  private readonly groundHit = createGroundHit();
  private readonly neutralAnkle = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.14);
  private readonly height = new SpringDamper(0, 48, 1);
  private groundBase = 0;
  private lastPelvisY: number | null = null;
  /** After a landing, a freed foot stays with the body for a moment, then is released into its swing. */
  private readonly landingHold: Record<Side, number> = { l: 0, r: 0 };
  private readonly heldOffset: Record<Side, Vector3> = { l: new Vector3(), r: new Vector3() };
  private readonly lastAnkleOffset: Record<Side, Vector3> = { l: new Vector3(), r: new Vector3() };
  private movingBlend = 0;
  private initialised = false;

  constructor() {
    this.report = { reachLimited: false, pelvisHeight: 0, desiredHeight: 0, heightLimit: 0, lean: 0, spine: this.spine.result };
  }

  reset(): void {
    this.initialised = false;
    this.movingBlend = 0;
    this.groundBase = 0;
    this.lastPelvisY = null;
    this.landingHold.l = 0;
    this.landingHold.r = 0;
  }

  generate(ctx: LocomotionContext, pose: Pose): void {
    const { rig, gait, tuning, style, dynamics, secondary, jump, root, yaw, dt, time } = ctx;
    const profile = gait.profile;
    const moving = gait.mode === "moving" ? 1 : 0;
    this.movingBlend = damp(this.movingBlend, moving, 7, dt);
    const motion = this.movingBlend;
    const run = gait.run;
    const phase = gait.phase;
    const airborne = ctx.airborne;

    for (const side of ["l", "r"] as const) this.previousFoot[side].copy(pose.rotations[legBones(side).foot]);
    for (const event of gait.events) if (event.type === "liftoff") this.liftoffFoot[event.side].copy(this.previousFoot[event.side]);
    pose.resetRotations();

    // ---- Pelvis position in the facing frame -------------------------------------------------
    const cyclicSway = Math.cos(2 * Math.PI * (phase - gait.duty / 2));
    const idleSway = 0.011 * Math.sin(2 * Math.PI * 0.09 * time) + gait.weightShift * 0.03 * (1 - motion);
    const sway = profile.sway * cyclicSway * motion + idleSway * (1 - motion);

    // ---- Lean and spine ---------------------------------------------------------------------
    const direction = ctx.speed > 0.15 ? clamp(ctx.forwardSpeed / ctx.speed, -1, 1) : 1;
    const speedLean = profile.lean * (direction >= 0 ? direction : direction * 0.3);
    const crouchLean = 0.55 * jump.crouchAmount + 1.1 * Math.max(dynamics.compression.value, 0);
    const lean = clamp(
      (speedLean + style.leanAdd) * tuning.forwardLean + dynamics.accelLean.value + crouchLean * (1 - airborne),
      -0.5,
      0.75,
    );
    const manualBend = ctx.manualBend;
    const lateralLean = clamp(dynamics.turnLean.value * style.turnLean + (ctx.leftSpeed / Math.max(ctx.speed, 1)) * 0.12 * Math.min(ctx.speed / 3, 1), -0.5, 0.5);
    const chestYaw = profile.chestYaw * Math.cos(2 * Math.PI * phase) * motion + clamp(ctx.yawRate * 0.06, -0.25, 0.25) * style.turnLean;
    const breath = Math.sin(2 * Math.PI * 0.27 * time);
    const idleAmount = 1 - motion;

    const flexion = lean * 0.75 + manualBend + secondary.chestPitch - 0.014 * breath * idleAmount;
    const spine = this.spine.apply(pose, {
      flexion,
      lateral: lateralLean,
      twist: chestYaw,
      headStabilization: 0.7,
      pelvisPitch: lean * 0.25,
    });

    // ---- Pelvis orientation ----------------------------------------------------------------
    const pelvisYaw = -profile.pelvisYaw * Math.cos(2 * Math.PI * phase) * motion - clamp(ctx.yawRate * 0.02, -0.08, 0.08);
    const pelvisRoll = 0.035 * gait.weightShift * (1 - run) * motion + lateralLean * 0.25;
    quatFromEuler(pose.rotations.pelvis, lean * 0.25 + spine.pelvisPitch, pelvisYaw, pelvisRoll);

    // ---- Foot targets from the gait (world space), before the pelvis height is known ----------
    const feet = gait.feet;
    for (const side of ["l", "r"] as const) this.groundTarget(feet[side], tuning.footIK, this.legTargets[side], side);

    // ---- Pelvis height ---------------------------------------------------------------------
    const stepPhase = fract(2 * phase);
    const bobSign = 1 - 2 * run;
    const bounce =
      profile.bounce * tuning.pelvisBounce * style.bounce * bobSign * Math.cos(2 * Math.PI * (stepPhase - fract(gait.duty))) * motion;
    this.updateGroundBase(ctx, airborne);
    const drop = profile.pelvisDrop + style.pelvisDrop + Math.max(dynamics.compression.value, -0.05) + spine.pelvisDrop;
    const hipHeight = rig.hipHeight;
    let desired = this.groundBase + hipHeight - drop + bounce;
    if (!this.initialised) {
      this.height.reset(desired);
      this.initialised = true;
    }
    desired = this.height.update(desired, dt);

    const localX = sway + spine.pelvisShift * 0;
    const localZ = spine.pelvisShift;
    let pelvisY = this.clampToReach(ctx, desired, localX, localZ, pelvisYaw, airborne);
    // Going down is immediate (a foot must never be out of reach), but rising is rate-limited: a nearly straight
    // knee is extremely sensitive to small height changes, and a sudden rise shows up as a pop.
    if (this.initialised && this.lastPelvisY !== null && airborne < 0.5) pelvisY = Math.min(pelvisY, this.lastPelvisY + MAX_PELVIS_RISE * dt);
    this.lastPelvisY = pelvisY;
    pose.pelvisPosition.set(localX, pelvisY, localZ);
    this.pullSwingFeetIntoReach(ctx, localX, localZ, pelvisY, pelvisYaw);

    // ---- Airborne leg shape ----------------------------------------------------------------
    toWorld(yaw, localX, localZ, pelvisWorld).add(root);
    pelvisWorld.y = root.y + pelvisY;
    if (airborne > 0.001) {
      for (const side of ["l", "r"] as const) this.mixAirborne(side, jump, pelvisWorld, yaw, airborne, ctx.rig.thighLength + ctx.rig.shinLength);
    }
    for (const side of ["l", "r"] as const) {
      this.holdAfterLanding(ctx, side);
      const free = feet[side].mode !== "stance" || airborne > 0.001;
      this.legTargets[side].autoToe = free;
      this.clearTerrain(ctx, side, free);
      this.kneeDirection(this.legTargets[side], side, yaw);
    }

    this.report.pelvisHeight = pelvisY - (this.groundBase);
    this.report.lean = lean;

    // ---- Arms -------------------------------------------------------------------------------
    this.arms(ctx, pose, motion, run, phase, pelvisWorld, forwardDir);

    // ---- Head and neck extras -----------------------------------------------------------------
    const headYaw = clamp(ctx.yawRate * 0.07, -0.3, 0.3) * style.turnLean + secondary.headYaw + idleAmount * (0.03 * Math.sin(2 * Math.PI * 0.11 * time) + 0.02 * Math.sin(2 * Math.PI * 0.23 * time + 1));
    const headRoll = -lateralLean * 0.55 + secondary.headRoll;
    const headPitch = style.headDown + secondary.headPitch + idleAmount * 0.012 * breath;
    quatFromEuler(tmpQ, headPitch, headYaw, headRoll);
    pose.rotations.head.multiply(tmpQ);
    // Subtle shoulder rise with breathing.
    for (const side of ["l", "r"] as const) {
      quatFromEuler(pose.rotations[armBones(side).clavicle], 0, 0, sideSign(side) * 0.035 * breath * idleAmount);
    }
  }

  /** Foot pose from the gait, blended with the body-following alternative by IK strength. */
  private groundTarget(foot: FootRuntime, ikStrength: number, out: LegTarget, side: Side): void {
    const lock = foot.mode === "stance" ? clamp(ikStrength, 0, 1) : 1;
    out.ankle.copy(foot.followAnkle).lerp(foot.ankle, lock);
    out.footRotation.copy(foot.followRotation).slerp(foot.rotation, lock);
    out.toeFlex = foot.toeFlex;

    if (foot.mode !== "swing") {
      out.relaxed = 0;
      return;
    }
    // Early swing: ease the ankle from where it was at liftoff to neutral. Late swing: hand over to the landing attitude.
    const s = foot.swingProgress;
    const early = smoothstep(s / 0.45);
    out.relaxedLocal.copy(this.liftoffFoot[side]).slerp(this.neutralAnkle, early);
    out.relaxed = s < 0.45 ? 1 : 1 - smoothstep((s - 0.45) / 0.55);
  }

  private updateGroundBase(ctx: LocomotionContext, airborne: number): void {
    const { gait, rig, root, dt } = ctx;
    let sum = 0;
    let weight = 0;
    for (const side of ["l", "r"] as const) {
      const foot = gait.feet[side];
      if (foot.mode !== "stance") continue;
      sum += foot.frame.flatAnkle.y - rig.config.proportions.ankleHeight;
      weight += 1;
    }
    const base = weight > 0 ? sum / weight - root.y : this.groundBase;
    // Airborne: the capsule position is the reference; on the ground the feet decide, smoothed over steps.
    const target = airborne > 0.5 ? 0 : base;
    this.groundBase = damp(this.groundBase, target, 18, dt);
  }

  /** Lowers the pelvis, if needed, so every foot target stays within reach of its hip. */
  private clampToReach(ctx: LocomotionContext, desired: number, localX: number, localZ: number, pelvisYaw: number, airborne: number): number {
    const { rig, root, yaw } = ctx;
    const reach = (rig.thighLength + rig.shinLength) * MAX_LEG_EXTENSION;
    toWorld(yaw, localX, localZ, pelvisWorld).add(root);
    let limit = Infinity;
    for (const side of ["l", "r"] as const) {
      const foot = ctx.gait.feet[side];
      const sign = sideSign(side);
      toWorld(yaw + pelvisYaw, sign * rig.config.proportions.hipHalfWidth, 0, hipWorld);
      hipWorld.add(pelvisWorld);
      if (foot.mode === "stance") {
        // A planted foot holds the pelvis down outright.
        const ankle = this.legTargets[side].ankle;
        const horizontal = Math.hypot(hipWorld.x - ankle.x, hipWorld.z - ankle.z);
        const vertical = Math.sqrt(Math.max(reach * reach - horizontal * horizontal, 0.04));
        limit = Math.min(limit, ankle.y + vertical - root.y);
        continue;
      }
      // A swinging foot is pulled in to a reachable spot for now, but its landing will need a lower pelvis, so
      // the pelvis eases down ahead of touchdown: measured against where the hip will be when the foot lands.
      const w = smoothstep((foot.swingProgress - 0.3) / 0.7);
      if (w <= 0) continue;
      const landing = foot.landingAnkle;
      const hx = hipWorld.x + ctx.velocity.x * foot.swingRemaining;
      const hz = hipWorld.z + ctx.velocity.z * foot.swingRemaining;
      const horizontal = Math.hypot(hx - landing.x, hz - landing.z);
      const vertical = Math.sqrt(Math.max(reach * reach - horizontal * horizontal, 0.04));
      const future = landing.y + vertical - root.y;
      if (future < desired) limit = Math.min(limit, desired + w * (future - desired));
    }
    this.report.reachLimited = desired > limit && airborne < 0.5;
    this.report.desiredHeight = desired;
    this.report.heightLimit = limit;
    return airborne > 0.5 ? desired : Math.min(desired, limit);
  }

  /** A swinging foot may lead the hip; its target is shortened to what the leg can reach this moment. */
  private pullSwingFeetIntoReach(ctx: LocomotionContext, localX: number, localZ: number, pelvisY: number, pelvisYaw: number): void {
    const { rig, root, yaw, gait } = ctx;
    const reach = (rig.thighLength + rig.shinLength) * MAX_LEG_EXTENSION;
    const minimum = (rig.thighLength + rig.shinLength) * MIN_LEG_FRACTION;
    toWorld(yaw, localX, localZ, pelvisWorld).add(root);
    pelvisWorld.y = root.y + pelvisY;
    for (const side of ["l", "r"] as const) {
      if (gait.feet[side].mode === "stance") continue;
      toWorld(yaw + pelvisYaw, sideSign(side) * rig.config.proportions.hipHalfWidth, 0, hipWorld);
      hipWorld.add(pelvisWorld);
      const ankle = this.legTargets[side].ankle;
      tmpA.subVectors(ankle, hipWorld);
      const length = tmpA.length();
      // Keep the foot inside the shell the leg can actually form: not past full extension, and not folded
      // tighter than the knee can bend.
      if (length > reach) ankle.copy(hipWorld).addScaledVector(tmpA, reach / length);
      else if (length < minimum && length > 1e-6) ankle.copy(hipWorld).addScaledVector(tmpA, minimum / length);
      // A swinging foot never crosses to the other side of the body, however the body has turned meanwhile.
      toWorld(yaw + pelvisYaw, 1, 0, tmpB);
      const lateral = (ankle.x - pelvisWorld.x) * tmpB.x + (ankle.z - pelvisWorld.z) * tmpB.z;
      const clamped = side === "l" ? clamp(lateral, 0, SWING_SIDE_LIMIT) : clamp(lateral, -SWING_SIDE_LIMIT, 0);
      if (clamped !== lateral) ankle.addScaledVector(tmpB, clamped - lateral);
    }
  }

  private mixAirborne(side: Side, jump: JumpSequence, pelvis: Vector3, yaw: number, weight: number, legLength: number): void {
    const sign = sideSign(side);
    const extension = jump.legExtension;
    const air = this.legTargets[side];
    // Legs hang below the pelvis; tucked legs lift the feet and bend the knees forward.
    toWorld(yaw, sign * 0.11, 0.05 + 0.2 * (1 - extension) + (side === "l" ? 0.04 : -0.02) * (1 - extension), tmpA);
    tmpA.add(pelvis);
    // Scaled by the leg: a fully reaching leg (extension 1) hangs the foot just short of straight, whatever the body.
    tmpA.y = pelvis.y - legLength * (0.5 + 0.47 * extension);
    // Toes point down in the air and level off as the feet reach for the ground.
    quatFromEuler(tmpQ, 0.55 * (1 - extension) + 0.1, 0, 0);
    tmpQ2.setFromAxisAngle(new Vector3(0, 1, 0), yaw + sign * 0.08).multiply(tmpQ);
    const w = smoothstep(weight);
    air.ankle.lerp(tmpA, w);
    air.footRotation.slerp(tmpQ2, w);
    air.toeFlex = air.toeFlex * (1 - w);
  }

  /**
   * The foot that starts swinging at the moment of landing was carried by the body in the air. Releasing it into its
   * swing at once would whip the leg back; it stays at its last body-relative position and eases into the swing.
   */
  private holdAfterLanding(ctx: LocomotionContext, side: Side): void {
    const target = this.legTargets[side];
    if (ctx.justLanded) {
      this.landingHold[side] = 1;
      this.heldOffset[side].copy(this.lastAnkleOffset[side]);
    }
    const weight = this.landingHold[side];
    if (weight > 0.002 && ctx.gait.feet[side].mode === "swing") {
      tmpA.copy(ctx.root).add(this.heldOffset[side]);
      target.ankle.lerp(tmpA, weight);
    }
    this.landingHold[side] = weight * Math.exp(-LANDING_RELEASE_RATE * ctx.dt);
    this.lastAnkleOffset[side].subVectors(target.ankle, ctx.root);
  }

  /**
   * Keeps the sole of a swinging or airborne foot above the terrain it is passing over (a step riser, a platform
   * edge, a slope), by raising the target by exactly the shortfall. The lift rises fast and falls slowly, so
   * crossing an edge does not pop the foot.
   */
  private clearTerrain(ctx: LocomotionContext, side: Side, active: boolean): void {
    const target = this.legTargets[side];
    let required = 0;
    if (active) {
      const { foot } = ctx.rig;
      for (const local of [foot.heel, foot.ball, foot.toeTip]) {
        tmpA.copy(local).applyQuaternion(target.footRotation).add(target.ankle);
        const hit = ctx.ground.sample(tmpA.x, tmpA.z, tmpA.y + 0.3, this.groundHit);
        if (hit.found) required = Math.max(required, hit.height + CLEARANCE_MARGIN - tmpA.y);
      }
    }
    const rate = required > this.clearance[side] ? 32 : 10;
    this.clearance[side] = damp(this.clearance[side], required, rate, ctx.dt);
    if (this.clearance[side] > 1e-4) target.ankle.y += this.clearance[side];
  }

  private kneeDirection(target: LegTarget, side: Side, yaw: number): void {
    // The knee points the way the foot faces, turned slightly outward.
    forwardDir.copy(TOE_AIR).applyQuaternion(target.footRotation);
    forwardDir.y = 0;
    if (forwardDir.lengthSq() < 1e-6) toWorld(yaw, 0, 1, forwardDir);
    forwardDir.normalize();
    const outward = sideSign(side) * 0.1;
    tmpB.set(forwardDir.x * Math.cos(outward) + forwardDir.z * Math.sin(outward), 0, -forwardDir.x * Math.sin(outward) + forwardDir.z * Math.cos(outward));
    target.kneeDirection.copy(tmpB);
  }

  private arms(ctx: LocomotionContext, pose: Pose, motion: number, run: number, phase: number, pelvis: Vector3, forward: Vector3): void {
    const { gait, tuning, style, secondary, jump, yaw } = ctx;
    const profile = gait.profile;
    toWorld(yaw, 0, 1, forward);
    const extent = Math.max(0.12, gait.duty * gait.strideLength * 0.5);
    const amplitude = profile.armSwing * tuning.armSwing * style.armSwing * motion;
    const swing: Record<Side, number> = { l: 0, r: 0 };
    for (const side of ["l", "r"] as const) {
      const foot = gait.feet[side];
      const offset = (foot.ankle.x - pelvis.x) * forward.x + (foot.ankle.z - pelvis.z) * forward.z;
      const normalized = clamp(offset / extent, -1.25, 1.25);
      // Arms swing back less far than they swing forward.
      swing[side] = normalized < 0 ? normalized * 0.7 : normalized;
    }
    void phase;
    for (const side of ["l", "r"] as const) {
      const opposite: Side = side === "l" ? "r" : "l";
      const sign = sideSign(side);
      const bones = armBones(side);
      const forwardSwing = amplitude * swing[opposite] - secondary.armLag * 0.6;
      const raise = jump.armRaise * (jump.armRaise > 0 ? 1.7 : 0.9);
      const flexion = forwardSwing + raise + style.armsOut * 0.2;
      const elbow =
        0.12 + (profile.elbowBase - 0.12) * motion + profile.elbowSwing * Math.max(forwardSwing, 0) * motion + style.elbowAdd * motion +
        (jump.armRaise > 0 ? 0.35 * jump.armRaise : 0) + 0.25 * ctx.airborne;
      const abduction = sign * (0.09 + style.armsOut * 0.95 + secondary.armOutward - 0.12 * run * Math.max(forwardSwing, 0) + 0.2 * Math.max(jump.armRaise, 0));
      quatFromEuler(pose.rotations[bones.upperArm], -flexion, sign * -0.15 * run * motion, abduction);
      quatFromEuler(pose.rotations[bones.forearm], -elbow, sign * -0.35 * run * motion, 0);
      quatFromEuler(pose.rotations[bones.hand], -0.12, 0, 0);
    }
  }
}

export { legBones };
