import { Matrix4, Quaternion, Vector3 } from "three";

export interface TwoBoneSolution {
  readonly knee: Vector3;
  /** The reachable ankle position (the target, pulled in if it was out of reach). */
  readonly ankle: Vector3;
  readonly thighRotation: Quaternion;
  readonly shinRotation: Quaternion;
  /** Distance to the target divided by the full leg length before clamping. Above 1 means out of reach. */
  reachRatio: number;
  /** Interior angle at the knee in radians; PI is a straight leg. */
  kneeAngle: number;
}

export function createTwoBoneSolution(): TwoBoneSolution {
  return {
    knee: new Vector3(),
    ankle: new Vector3(),
    thighRotation: new Quaternion(),
    shinRotation: new Quaternion(),
    reachRatio: 0,
    kneeAngle: Math.PI,
  };
}

/** Fraction of full extension a leg is allowed to reach; a fully locked knee looks wrong and is numerically unstable. */
export const MAX_EXTENSION = 0.9995;

const FALLBACK_BULGE = new Vector3(0, 0, 1);
const scratchAxis = new Vector3();
const scratchBulge = new Vector3();
const scratchX = new Vector3();
const scratchY = new Vector3();
const scratchZ = new Vector3();
const scratchMatrix = new Matrix4();

/**
 * Orientation of a bone whose rest axis is -Y: local -Y points along `direction` and local +Z lies in the
 * plane of `direction` and `hint` (as close to `hint` as possible).
 */
export function orientLimb(direction: Vector3, hint: Vector3, out: Quaternion): Quaternion {
  scratchY.copy(direction).negate().normalize();
  scratchZ.copy(hint).addScaledVector(scratchY, -hint.dot(scratchY));
  if (scratchZ.lengthSq() < 1e-8) scratchZ.copy(FALLBACK_BULGE).addScaledVector(scratchY, -FALLBACK_BULGE.dot(scratchY));
  scratchZ.normalize();
  scratchX.crossVectors(scratchY, scratchZ);
  scratchMatrix.makeBasis(scratchX, scratchY, scratchZ);
  return out.setFromRotationMatrix(scratchMatrix);
}

/**
 * Analytic two-bone solver (law of cosines). The knee bends toward `bulge`, so the rotation between thigh
 * and shin is a pure hinge and the knee can never invert.
 */
export function solveTwoBone(
  hip: Vector3,
  target: Vector3,
  upperLength: number,
  lowerLength: number,
  bulge: Vector3,
  out: TwoBoneSolution,
): TwoBoneSolution {
  scratchAxis.subVectors(target, hip);
  const rawDistance = scratchAxis.length();
  const maxReach = (upperLength + lowerLength) * MAX_EXTENSION;
  const minReach = Math.abs(upperLength - lowerLength) + 1e-3;
  const distance = Math.min(Math.max(rawDistance, minReach), maxReach);
  if (rawDistance < 1e-9) scratchAxis.set(0, -1, 0);
  else scratchAxis.multiplyScalar(1 / rawDistance);

  out.reachRatio = rawDistance / (upperLength + lowerLength);
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(upperLength * upperLength - along * along, 0));

  scratchBulge.copy(bulge).addScaledVector(scratchAxis, -bulge.dot(scratchAxis));
  if (scratchBulge.lengthSq() < 1e-8) {
    scratchBulge.copy(FALLBACK_BULGE).addScaledVector(scratchAxis, -FALLBACK_BULGE.dot(scratchAxis));
  }
  scratchBulge.normalize();

  out.knee.copy(hip).addScaledVector(scratchAxis, along).addScaledVector(scratchBulge, height);
  out.ankle.copy(hip).addScaledVector(scratchAxis, distance);
  out.kneeAngle = Math.acos(
    Math.min(1, Math.max(-1, (upperLength * upperLength + lowerLength * lowerLength - distance * distance) / (2 * upperLength * lowerLength))),
  );

  // Orient both bones with the same bending-plane hint, then a hinge is all that separates them.
  const thighDirection = new Vector3().subVectors(out.knee, hip).normalize();
  const shinDirection = new Vector3().subVectors(out.ankle, out.knee).normalize();
  orientLimb(thighDirection, scratchBulge, out.thighRotation);
  orientLimb(shinDirection, scratchBulge, out.shinRotation);
  return out;
}
