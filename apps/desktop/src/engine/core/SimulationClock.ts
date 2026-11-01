/** Fixed simulation step in seconds. Physics, gait and root motion are deterministic at this rate. */
export const FIXED_DT = 1 / 120;

/** Largest real-time gap accepted in one update. Longer pauses (tab switch) are dropped, not simulated. */
const MAX_FRAME_SECONDS = 0.25;

export interface ClockAdvance {
  /** Whole fixed steps to run for this frame. */
  readonly steps: number;
  /** Fraction of the next step already elapsed, for render interpolation (0..1). */
  readonly alpha: number;
}

/**
 * Converts variable real frame time into a count of fixed steps. The simulated
 * result depends only on the number of steps, never on the render frame rate.
 */
export class SimulationClock {
  private accumulator = 0;
  private stepCount = 0;
  readonly fixedDt: number;
  timeScale = 1;

  constructor(fixedDt: number = FIXED_DT) {
    this.fixedDt = fixedDt;
  }

  get steps(): number {
    return this.stepCount;
  }

  /** Simulated time in seconds. */
  get time(): number {
    return this.stepCount * this.fixedDt;
  }

  advance(realDeltaSeconds: number): ClockAdvance {
    const delta = Math.min(Math.max(realDeltaSeconds, 0), MAX_FRAME_SECONDS) * this.timeScale;
    this.accumulator += delta;
    // A small epsilon keeps whole-multiple deltas (for example 60 Hz render over a 120 Hz step) from losing a step to rounding.
    const steps = Math.floor(this.accumulator / this.fixedDt + 1e-9);
    this.accumulator -= steps * this.fixedDt;
    if (this.accumulator < 0) this.accumulator = 0;
    this.stepCount += steps;
    return { steps, alpha: this.accumulator / this.fixedDt };
  }

  reset(): void {
    this.accumulator = 0;
    this.stepCount = 0;
  }
}
