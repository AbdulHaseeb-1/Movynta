import type { AnimationStateId } from "./types";
import type { JumpPhase } from "./JumpSequence";

export interface StateMachineInput {
  readonly speed: number;
  readonly desiredSpeed: number;
  /** Acceleration along the direction of travel (m/s^2); negative when braking. */
  readonly forwardAcceleration: number;
  readonly grounded: boolean;
  readonly verticalVelocity: number;
  readonly yawRate: number;
  readonly jumpPhase: JumpPhase;
  /** True while a corrective turn-in-place step is in progress. */
  readonly stepTurning: boolean;
}

export interface StateTransition {
  readonly from: AnimationStateId;
  readonly to: AnimationStateId;
  /** Simulation time of the change (seconds). */
  readonly time: number;
  readonly reason: string;
}

/** Speed bands (m/s) with separate enter/exit values so a speed near a boundary cannot flicker between states. */
const BANDS = [
  { state: "walk", enter: 0.3, exit: 0.2 },
  { state: "run", enter: 2.45, exit: 2.15 },
  { state: "fast_run", enter: 4.6, exit: 4.3 },
  { state: "sprint", enter: 6.7, exit: 6.4 },
] as const;

const MIN_LOCOMOTION_HOLD = 0.12;
const STOP_DURATION = 0.45;
const HISTORY_LIMIT = 40;

/**
 * Chooses the active animation state from speed, grounding, vertical velocity, turning and commands.
 * Air and landing states always win; then turn, stop, accelerate and decelerate; then the speed bands.
 */
export class AnimationStateMachine {
  current: AnimationStateId = "idle";
  previous: AnimationStateId = "idle";
  /** Seconds in the current state. */
  timeInState = 0;
  /** Recent transitions for the debugging interface, newest last. */
  readonly history: StateTransition[] = [];
  /** Speed band the character is in regardless of overlay states (walk, run, ...). */
  band: AnimationStateId = "idle";
  private stopTimer = 0;
  private clock = 0;
  private lastReason = "start";

  update(dt: number, input: StateMachineInput): AnimationStateId {
    this.clock += dt;
    this.timeInState += dt;
    this.band = this.nextBand(input.speed);

    const next = this.choose(dt, input);
    if (next !== this.current) this.transition(next);
    return this.current;
  }

  /** Forces a state (editor command). It still falls back to the normal rules on the next update. */
  force(state: AnimationStateId, reason = "command"): void {
    if (state !== this.current) {
      this.lastReason = reason;
      this.transition(state);
    }
  }

  reset(): void {
    this.current = "idle";
    this.previous = "idle";
    this.band = "idle";
    this.timeInState = 0;
    this.stopTimer = 0;
    this.history.length = 0;
  }

  private nextBand(speed: number): AnimationStateId {
    // Walk up while the speed beats the next entry value; fall back below the exit value.
    let index = this.band === "idle" ? -1 : BANDS.findIndex((band) => band.state === this.band);
    while (index + 1 < BANDS.length && speed >= (BANDS[index + 1]?.enter ?? Infinity)) index += 1;
    while (index >= 0 && speed < (BANDS[index]?.exit ?? 0)) index -= 1;
    return index < 0 ? "idle" : (BANDS[index]?.state ?? "idle");
  }

  private choose(dt: number, input: StateMachineInput): AnimationStateId {
    if (!input.grounded) {
      // A jump counts as "jump" while rising and through the apex; everything else in the air is a fall.
      const rising = input.verticalVelocity > 0.3 || (input.jumpPhase !== "none" && input.verticalVelocity > -0.3);
      this.lastReason = rising ? "airborne, rising" : "airborne, falling";
      return rising ? "jump" : "fall";
    }
    if (input.jumpPhase === "anticipation") {
      this.lastReason = "jump command";
      return "jump";
    }
    if (input.jumpPhase === "landing") {
      this.lastReason = "touched down";
      return "land";
    }

    const moving = this.band !== "idle";
    const slow = input.speed < 1.4;

    if (input.stepTurning && !moving) {
      this.lastReason = "turning in place";
      return "turn";
    }
    if (Math.abs(input.yawRate) > 1.6 && slow && input.speed > 0.2) {
      this.lastReason = "sharp turn at low speed";
      return "turn";
    }

    // Stop: the body is still moving but nothing is asking for movement any more.
    const wantsStop = input.desiredSpeed < 0.1 && input.speed > 0.15;
    if (wantsStop) {
      this.stopTimer += dt;
      if (input.speed > 1.8 && input.forwardAcceleration < -2.5) {
        this.lastReason = "braking from speed";
        return "decelerate";
      }
      this.lastReason = "coming to rest";
      return "stop";
    }
    this.stopTimer = 0;

    const holding = this.timeInState < MIN_LOCOMOTION_HOLD && this.isLocomotion(this.current);
    if (!holding) {
      if (input.desiredSpeed > input.speed + 0.7 && input.forwardAcceleration > 2.5 && input.desiredSpeed > 0.5) {
        this.lastReason = "speeding up";
        return "accelerate";
      }
      if (input.desiredSpeed < input.speed - 0.7 && input.forwardAcceleration < -2.5 && input.speed > 0.8) {
        this.lastReason = "slowing down";
        return "decelerate";
      }
    } else if (this.current === "accelerate" || this.current === "decelerate") {
      return this.current;
    }
    this.lastReason = this.band === "idle" ? "at rest" : `speed ${input.speed.toFixed(1)} m/s`;
    return this.band;
  }

  private isLocomotion(state: AnimationStateId): boolean {
    return state !== "jump" && state !== "fall" && state !== "land";
  }

  private transition(next: AnimationStateId): void {
    this.history.push({ from: this.current, to: next, time: this.clock, reason: this.lastReason });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.previous = this.current;
    this.current = next;
    this.timeInState = 0;
  }

  /** Remaining time (seconds) of the stop pose, for the blender. */
  get stopFraction(): number {
    return Math.min(this.stopTimer / STOP_DURATION, 1);
  }
}
