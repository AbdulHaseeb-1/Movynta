import { SpringDamper, clamp } from "../core/math";

/** Follow-through channels, in radians. All are additive and scaled by the user's secondary-motion setting. */
export interface SecondaryOutput {
  headPitch: number;
  headRoll: number;
  headYaw: number;
  chestPitch: number;
  armLag: number;
  armOutward: number;
}

export function createSecondaryOutput(): SecondaryOutput {
  return { headPitch: 0, headRoll: 0, headYaw: 0, chestPitch: 0, armLag: 0, armOutward: 0 };
}

/**
 * Inertial springs: each channel is displaced by acceleration of the body and then relaxes to rest,
 * so the head, chest and arms lag the motion and settle afterward.
 */
export class SecondaryMotion {
  private readonly head = new SpringDamper(0, 14, 0.45);
  private readonly headSide = new SpringDamper(0, 12, 0.5);
  private readonly headTurn = new SpringDamper(0, 10, 0.55);
  private readonly chest = new SpringDamper(0, 11, 0.5);
  private readonly arms = new SpringDamper(0, 9, 0.4);
  private readonly outward = new SpringDamper(0, 7, 0.5);
  readonly output: SecondaryOutput = createSecondaryOutput();

  update(dt: number, forwardAccel: number, lateralAccel: number, yawRate: number, speed: number, intensity: number): SecondaryOutput {
    // Inertial force pushes the springs opposite to the acceleration.
    this.head.velocity -= forwardAccel * 0.05 * dt * 6;
    this.headSide.velocity += lateralAccel * 0.04 * dt * 6;
    this.headTurn.velocity -= yawRate * 0.9 * dt * 4;
    this.chest.velocity -= forwardAccel * 0.03 * dt * 6;
    this.arms.velocity += forwardAccel * 0.08 * dt * 6;
    this.outward.velocity += Math.abs(yawRate) * speed * 0.03 * dt * 6;
    for (const spring of [this.head, this.headSide, this.headTurn, this.chest, this.arms, this.outward]) {
      spring.update(0, dt);
    }
    const k = clamp(intensity, 0, 2);
    const out = this.output;
    out.headPitch = clamp(this.head.value, -0.35, 0.35) * k;
    out.headRoll = clamp(this.headSide.value, -0.3, 0.3) * k;
    out.headYaw = clamp(this.headTurn.value, -0.4, 0.4) * k;
    out.chestPitch = clamp(this.chest.value, -0.2, 0.2) * k;
    out.armLag = clamp(this.arms.value, -0.5, 0.5) * k;
    out.armOutward = clamp(this.outward.value, 0, 0.4) * k;
    return out;
  }

  reset(): void {
    for (const spring of [this.head, this.headSide, this.headTurn, this.chest, this.arms, this.outward]) spring.reset(0);
  }
}
