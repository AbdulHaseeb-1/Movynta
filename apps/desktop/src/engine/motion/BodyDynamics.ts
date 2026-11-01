import { SpringDamper, clamp } from "../core/math";

/** Spring-driven body state: lean into acceleration and turns, plus landing compression. */
export class BodyDynamics {
  /** Forward lean from acceleration (radians). Negative when braking. */
  readonly accelLean = new SpringDamper(0, 9, 0.9);
  /** Sideways lean into a turn (radians). Positive leans toward the left. */
  readonly turnLean = new SpringDamper(0, 8, 0.9);
  /** Downward pelvis displacement from landing impact and crouching (meters, positive is lower). */
  readonly compression = new SpringDamper(0, 14, 0.65);
  /** Pelvis height follow, smooths contact changes and steps (meters of offset). */
  readonly heightOffset = new SpringDamper(0, 30, 1);
  /** Intentional crouch depth requested by the jump sequence (meters). */
  crouch = 0;

  /**
   * @param forwardAccel acceleration along the facing axis (m/s^2)
   * @param lateralAccel acceleration toward the left (m/s^2)
   * @param forwardLeanScale user scaling of the lean response
   */
  update(dt: number, forwardAccel: number, lateralAccel: number, speed: number, yawRate: number, forwardLeanScale: number): void {
    const accelTarget = clamp(forwardAccel * 0.022, -0.32, 0.3) * forwardLeanScale;
    this.accelLean.update(accelTarget, dt);

    // Lean toward the inside of a turn: tan(angle) = v * omega / g.
    const centripetal = Math.atan((speed * yawRate) / 9.81);
    const lateralLean = clamp(lateralAccel * 0.012, -0.2, 0.2);
    this.turnLean.update(clamp(centripetal * 0.9 + lateralLean, -0.45, 0.45), dt);

    this.compression.update(this.crouch, dt);
  }

  /** Landing impact adds a downward velocity kick; the spring then absorbs it. */
  landingImpact(speed: number): void {
    this.compression.velocity += clamp(speed, 0, 9) * 0.85;
  }

  reset(): void {
    this.accelLean.reset(0);
    this.turnLean.reset(0);
    this.compression.reset(0);
    this.heightOffset.reset(0);
    this.crouch = 0;
  }
}
