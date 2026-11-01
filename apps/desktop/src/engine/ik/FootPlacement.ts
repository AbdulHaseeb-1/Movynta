import { Quaternion, Vector3 } from "three";
import type { FootGeometry } from "../character/types";
import { clamp01, lerp, smootherstep, smoothstep } from "../core/math";
import { createGroundHit, type GroundHit, type GroundProvider } from "../physics/GroundDetection";

const UP = new Vector3(0, 1, 0);
const yawAxis = new Vector3(0, 1, 0);
const pitchAxis = new Vector3(1, 0, 0);

/** A foot resting flat on the ground: where the ankle is, how the sole is oriented, and which way is up. */
export interface FootFrame {
  /** Ankle joint position when the sole lies flat. */
  readonly flatAnkle: Vector3;
  /** Foot orientation when flat: ground normal tilt combined with heading. */
  readonly q0: Quaternion;
  yaw: number;
  readonly normal: Vector3;
}

export function createFootFrame(): FootFrame {
  return { flatAnkle: new Vector3(), q0: new Quaternion(), yaw: 0, normal: new Vector3(0, 1, 0) };
}

export function copyFootFrame(out: FootFrame, source: FootFrame): FootFrame {
  out.flatAnkle.copy(source.flatAnkle);
  out.q0.copy(source.q0);
  out.yaw = source.yaw;
  out.normal.copy(source.normal);
  return out;
}

const tiltQuat = new Quaternion();
const yawQuat = new Quaternion();

/** Foot orientation lying on a surface with `normal`, heading `yaw`. */
export function flatFootOrientation(yaw: number, normal: Vector3, out: Quaternion): Quaternion {
  yawQuat.setFromAxisAngle(yawAxis, yaw);
  tiltQuat.setFromUnitVectors(UP, normal);
  return out.copy(tiltQuat).multiply(yawQuat);
}

const hit = createGroundHit();
const heelWorld = new Vector3();
const ballWorld = new Vector3();
const toeWorld = new Vector3();
const offset = new Vector3();

/**
 * Plants a foot on the ground at (x, z). The sole follows the surface normal at the ankle, and the ankle
 * is raised until the heel, ball and toe tip are all at or above the surface (so a foot straddling a
 * ledge rests on the higher part instead of sinking into it).
 */
export function placeFootOnGround(
  ground: GroundProvider,
  x: number,
  z: number,
  yaw: number,
  aboveY: number,
  geometry: FootGeometry,
  ankleHeight: number,
  out: FootFrame,
): FootFrame {
  ground.sample(x, z, aboveY, hit);
  out.normal.copy(hit.normal);
  out.yaw = yaw;
  flatFootOrientation(yaw, out.normal, out.q0);
  out.flatAnkle.set(x, hit.height, z).addScaledVector(out.normal, ankleHeight);

  let lift = 0;
  for (const [local, scratch] of [
    [geometry.heel, heelWorld],
    [geometry.ball, ballWorld],
    [geometry.toeTip, toeWorld],
  ] as const) {
    scratch.copy(local).applyQuaternion(out.q0).add(out.flatAnkle);
    const probe: GroundHit = ground.sample(scratch.x, scratch.z, Math.max(scratch.y, aboveY), hit);
    if (probe.found) lift = Math.max(lift, probe.height - scratch.y);
  }
  if (lift > 0) out.flatAnkle.y += lift;
  return out;
}

const pitchQuat = new Quaternion();

/**
 * Pose of a foot rolling over a fixed contact point. Negative `pitch` (toes up) pivots about the heel,
 * positive pitch (heel up) pivots about the ball, so the contact point never moves.
 */
export function rollFoot(
  frame: FootFrame,
  pitch: number,
  geometry: FootGeometry,
  outAnkle: Vector3,
  outRotation: Quaternion,
): void {
  pitchQuat.setFromAxisAngle(pitchAxis, pitch);
  const pivot = pitch < 0 ? geometry.heel : geometry.ball;
  offset.copy(pivot).applyQuaternion(pitchQuat);
  offset.subVectors(pivot, offset).applyQuaternion(frame.q0);
  outAnkle.copy(frame.flatAnkle).add(offset);
  outRotation.copy(frame.q0).multiply(pitchQuat);
}

/** Foot pitch (radians, plantar positive) during stance as a function of stance progress u in [0, 1]. */
export function stancePitch(u: number, heelStrike: number, toeOff: number, heelRise: number): number {
  const strike = 0.14;
  if (u < strike) return -heelStrike * (1 - smoothstep(u / strike));
  if (u < heelRise) return 0;
  return toeOff * smoothstep((u - heelRise) / (1 - heelRise));
}

/** Foot pitch during swing as a function of swing progress s in [0, 1], starting from the pitch at liftoff. */
export function swingPitch(s: number, liftoffPitch: number, heelStrike: number): number {
  const lift = liftoffPitch * (1 - smoothstep(s / 0.45));
  const reach = -heelStrike * smoothstep((s - 0.55) / 0.45);
  return lift + reach;
}

/** Height profile of a swing: rises early, peaks around 40% and settles before touchdown. */
export function swingArc(s: number): number {
  const t = clamp01(s);
  return Math.sin(Math.PI * Math.pow(t, 0.85)) ** 1.1;
}

export interface SwingEndpoints {
  readonly originAnkle: Vector3;
  readonly originFrame: FootFrame;
  readonly originPitch: number;
  /** Frame the foot will land in. */
  readonly target: FootFrame;
  readonly landingPitch: number;
}

const landingAnkle = new Vector3();
const landingRotation = new Quaternion();
const swingRotation = new Quaternion();

/** Ankle position and orientation of a swinging foot at progress `s`. */
export function evaluateSwing(
  endpoints: SwingEndpoints,
  s: number,
  peakHeight: number,
  heelStrike: number,
  geometry: FootGeometry,
  outAnkle: Vector3,
  outRotation: Quaternion,
  outLanding?: Vector3,
): number {
  const progress = clamp01(s);
  rollFoot(endpoints.target, endpoints.landingPitch, geometry, landingAnkle, landingRotation);
  outLanding?.copy(landingAnkle);
  const horizontal = smootherstep(progress);
  const vertical = smoothstep(progress);
  outAnkle.x = lerp(endpoints.originAnkle.x, landingAnkle.x, horizontal);
  outAnkle.z = lerp(endpoints.originAnkle.z, landingAnkle.z, horizontal);
  outAnkle.y = lerp(endpoints.originAnkle.y, landingAnkle.y, vertical) + peakHeight * swingArc(progress);

  swingRotation.copy(endpoints.originFrame.q0).slerp(endpoints.target.q0, smoothstep(progress));
  const pitch = swingPitch(progress, endpoints.originPitch, heelStrike);
  pitchQuat.setFromAxisAngle(pitchAxis, pitch);
  outRotation.copy(swingRotation).multiply(pitchQuat);
  return pitch;
}
