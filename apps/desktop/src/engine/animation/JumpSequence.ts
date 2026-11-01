import { clamp, damp, smoothstep } from "../core/math";
import type { CharacterController } from "../character/CharacterController";
import type { BodyDynamics } from "../motion/BodyDynamics";

export type JumpPhase = "none" | "anticipation" | "airborne" | "landing";

/** Deepest pelvis drop of a full crouch, in meters. */
export const MAX_CROUCH_DEPTH = 0.27;

/**
 * Sequences a jump: anticipation (crouch), push-off, ascent, apex, descent, landing and recovery.
 * It issues the physical impulse at the right moment and exposes the body-shape parameters the
 * pose generator needs; it never moves the character itself.
 */
export class JumpSequence {
  phase: JumpPhase = "none";
  /** Seconds spent in the current phase. */
  time = 0;
  anticipationDuration = 0.17;
  landingDuration = 0.34;
  /** 0..1 crouch request while preparing to jump. */
  crouchAmount = 0;
  /** 0 is tucked, 1 is legs reaching for the ground. */
  legExtension = 0.6;
  /** -1 arms swung back for the crouch, +1 arms raised for the takeoff. */
  armRaise = 0;
  /** True when the airborne phase is a controlled jump rather than a fall. */
  jumped = false;
  private armTarget = 0;
  private extensionTarget = 0.6;

  /** Starts a jump if the character is on the ground and idle in the sequence. */
  request(controller: CharacterController): boolean {
    if (this.phase !== "none" || !controller.grounded) return false;
    this.phase = "anticipation";
    this.time = 0;
    this.jumped = true;
    return true;
  }

  update(dt: number, controller: CharacterController, dynamics: BodyDynamics): void {
    this.time += dt;
    switch (this.phase) {
      case "none":
        this.crouchAmount = 0;
        this.armTarget = 0;
        if (!controller.grounded && controller.airTime > 0.09) {
          // Walked off a ledge: a fall, not a jump.
          this.phase = "airborne";
          this.time = controller.airTime;
          this.jumped = false;
        }
        break;
      case "anticipation": {
        const t = clamp(this.time / this.anticipationDuration, 0, 1);
        this.crouchAmount = smoothstep(t);
        this.armTarget = -smoothstep(t);
        if (t >= 1 && controller.jump()) {
          this.phase = "airborne";
          this.time = 0;
          this.crouchAmount = 0;
          this.armTarget = 1;
        } else if (t >= 1 && !controller.grounded) {
          this.phase = "airborne";
          this.time = 0;
        }
        break;
      }
      case "airborne": {
        const vy = controller.velocity.y;
        this.crouchAmount = 0;
        // Tucked while rising and at the apex; the legs reach down as the fall speeds up.
        this.extensionTarget = this.jumped ? 0.3 + 0.65 * smoothstep(-vy / 4.2) : 0.55 + 0.4 * smoothstep(-vy / 5);
        this.armTarget = this.jumped ? 1 - 0.75 * smoothstep(-vy / 3.5) : 0.35;
        if (controller.justLanded) {
          dynamics.landingImpact(controller.lastImpactSpeed);
          this.phase = "landing";
          this.time = 0;
        }
        break;
      }
      case "landing":
        this.armTarget = 0;
        this.crouchAmount = 0;
        if (this.time >= this.landingDuration) {
          this.phase = "none";
          this.time = 0;
          this.jumped = false;
        }
        break;
    }
    // Arms and legs ease toward their targets so a change of phase never snaps a limb.
    this.armRaise = damp(this.armRaise, this.armTarget, 14, dt);
    this.legExtension = damp(this.legExtension, this.extensionTarget, 16, dt);
    dynamics.crouch = this.crouchAmount * MAX_CROUCH_DEPTH;
  }

  reset(): void {
    this.phase = "none";
    this.time = 0;
    this.crouchAmount = 0;
    this.armRaise = 0;
    this.armTarget = 0;
    this.legExtension = 0.6;
    this.extensionTarget = 0.6;
    this.jumped = false;
  }
}
