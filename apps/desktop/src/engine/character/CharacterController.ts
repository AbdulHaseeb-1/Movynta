import { Vector3 } from "three";
import { clamp, moveToward, smoothstep, wrapPi } from "../core/math";
import { GRAVITY, type PhysicsCharacter } from "../physics/PhysicsWorld";

export interface ControllerParams {
  /** Horizontal acceleration while speeding up on the ground (m/s^2). */
  acceleration: number;
  /** Horizontal deceleration on the ground (m/s^2). */
  deceleration: number;
  /** Fraction of ground acceleration available in the air. */
  airControl: number;
  /** Maximum turn rate in radians per second. */
  turnSpeed: number;
  /** Rate at which the turn rate itself can change (rad/s^2), so heading changes never snap. */
  turnAcceleration: number;
  jumpSpeed: number;
}

export const DEFAULT_CONTROLLER_PARAMS: ControllerParams = {
  acceleration: 9,
  deceleration: 12,
  airControl: 0.15,
  turnSpeed: (280 * Math.PI) / 180,
  turnAcceleration: 40,
  jumpSpeed: 4.1,
};

export type FacingMode = "movement" | "locked";

export interface MovementCommand {
  /** World-space velocity the player asks for (horizontal). */
  readonly desiredVelocity: Vector3;
  /** Heading used for facing when the character is slow or idle, radians (0 faces +Z). */
  heading: number;
  facing: FacingMode;
  /** Heading to hold when `facing` is "locked" (strafing and backpedaling). */
  lockedYaw: number;
}

export function createMovementCommand(): MovementCommand {
  return { desiredVelocity: new Vector3(), heading: 0, facing: "movement", lockedYaw: 0 };
}

const scratchMove = new Vector3();
const scratchDesired = new Vector3();
const scratchTranslation = new Vector3();
const scratchPosition = new Vector3();

/**
 * Kinematic movement. Rapier decides what motion is legal (walls, steps, slopes, grounding);
 * the animation system only reads the result and never moves the character itself.
 */
export class CharacterController {
  readonly params: ControllerParams;
  readonly position = new Vector3();
  /** Actual world velocity, including vertical. */
  readonly velocity = new Vector3();
  /** Horizontal acceleration of the last step (m/s^2). */
  readonly acceleration = new Vector3();
  yaw = 0;
  yawRate = 0;
  grounded = true;
  /** Seconds since the feet last left the ground (0 while grounded). */
  airTime = 0;
  /** Downward speed at the most recent landing (m/s), for one-shot reactions. */
  lastImpactSpeed = 0;
  /** Set for exactly one step when the character lands. */
  justLanded = false;
  /** Set for exactly one step when the character leaves the ground. */
  justLeftGround = false;
  /** Treadmill mode: horizontal velocity is simulated but the character does not translate. */
  inPlace = false;
  private readonly physics: PhysicsCharacter;
  private verticalVelocity = 0;
  private readonly previousHorizontal = new Vector3();

  constructor(physics: PhysicsCharacter, params: ControllerParams = DEFAULT_CONTROLLER_PARAMS) {
    this.physics = physics;
    this.params = { ...params };
  }

  teleport(position: Vector3, yaw: number): void {
    this.position.copy(position);
    this.physics.setPosition(position);
    this.yaw = yaw;
    this.yawRate = 0;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.grounded = true;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Starts a jump. Ignored while airborne. Returns whether it started. */
  jump(): boolean {
    if (!this.grounded) return false;
    this.verticalVelocity = this.params.jumpSpeed;
    this.grounded = false;
    return true;
  }

  step(dt: number, command: MovementCommand): void {
    this.justLanded = false;
    this.justLeftGround = false;
    const wasGrounded = this.grounded;
    this.previousHorizontal.set(this.velocity.x, 0, this.velocity.z);

    // 1. Horizontal velocity eases toward the request; braking is faster than speeding up.
    scratchDesired.set(command.desiredVelocity.x, 0, command.desiredVelocity.z);
    const speedingUp = scratchDesired.lengthSq() > this.previousHorizontal.lengthSq();
    let rate = speedingUp ? this.params.acceleration : this.params.deceleration;
    if (!this.grounded) rate *= this.params.airControl;
    scratchMove.subVectors(scratchDesired, this.previousHorizontal);
    const gap = scratchMove.length();
    const maxDelta = rate * dt;
    if (gap > maxDelta) scratchMove.multiplyScalar(maxDelta / gap);
    const vx = this.previousHorizontal.x + scratchMove.x;
    const vz = this.previousHorizontal.z + scratchMove.z;

    // 2. Vertical velocity.
    // A grounded character asks for no vertical motion: a constant downward nudge makes the collision solver
    // discard horizontal movement on some steps and slowly push the capsule up. Snap-to-ground keeps it on slopes.
    if (this.grounded && this.verticalVelocity <= 0) this.verticalVelocity = 0;
    else this.verticalVelocity -= GRAVITY * dt;

    // 3. Let physics find the legal displacement.
    scratchTranslation.set(this.inPlace ? 0 : vx * dt, this.verticalVelocity * dt, this.inPlace ? 0 : vz * dt);
    const snap = this.grounded && this.verticalVelocity <= 0;
    const result = this.physics.move(scratchTranslation, snap, scratchPosition);
    this.position.copy(this.physics.getPosition(scratchMove));

    const impactSpeed = -this.verticalVelocity;
    // While still moving upward the character has not landed, even if the capsule touches the ground this step.
    this.grounded = result.grounded && this.verticalVelocity <= 0;
    if (this.grounded) {
      if (!wasGrounded) {
        this.physics.settle();
        this.position.copy(this.physics.getPosition(scratchMove));
        this.justLanded = true;
        this.lastImpactSpeed = Math.max(impactSpeed, 0);
      }
      this.verticalVelocity = 0;
      this.airTime = 0;
    } else {
      if (wasGrounded) this.justLeftGround = true;
      this.airTime += dt;
      // Hitting a ceiling stops upward motion.
      if (result.translation.y < scratchTranslation.y * 0.5 && this.verticalVelocity > 0) this.verticalVelocity = 0;
    }

    // 4. Actual velocity comes from the realized displacement, so walls and steps are reflected honestly.
    const realizedX = this.inPlace ? vx : result.translation.x / dt;
    const realizedZ = this.inPlace ? vz : result.translation.z / dt;
    this.velocity.set(realizedX, this.grounded ? 0 : this.verticalVelocity, realizedZ);
    this.acceleration.set((this.velocity.x - this.previousHorizontal.x) / dt, 0, (this.velocity.z - this.previousHorizontal.z) / dt);

    this.updateFacing(dt, command);
  }

  private updateFacing(dt: number, command: MovementCommand): void {
    const speed = this.horizontalSpeed;
    let target: number;
    if (command.facing === "locked") {
      target = command.lockedYaw;
    } else if (speed > 0.6) {
      // Face where the body is actually going once it moves; blend from the commanded heading at low speed.
      const travel = Math.atan2(this.velocity.x, this.velocity.z);
      const blend = smoothstep((speed - 0.6) / 1.6);
      target = command.heading + wrapPi(travel - command.heading) * blend;
    } else {
      target = command.heading;
    }

    const error = wrapPi(target - this.yaw);
    const maxRate = this.params.turnSpeed;
    // Slow down as the target is approached (critically damped feel), capped at the maximum rate.
    const desiredRate = clamp(error * 9, -maxRate, maxRate);
    this.yawRate = moveToward(this.yawRate, desiredRate, this.params.turnAcceleration * dt);
    const next = this.yaw + this.yawRate * dt;
    // Never overshoot the target within one step.
    this.yaw = Math.sign(wrapPi(target - next)) === Math.sign(error) || Math.abs(error) < 1e-6 ? next : target;
    this.yaw = wrapPi(this.yaw);
  }
}
