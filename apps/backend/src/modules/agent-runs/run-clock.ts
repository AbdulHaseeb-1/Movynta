/** Why a run was stopped by its clock. */
export type RunStop = "timeout" | "stalled";

export interface RunClockLimits {
  /** Longest active time for the whole run, in milliseconds. */
  readonly totalMs: number;
  /** Longest silence between two signs of progress, in milliseconds. */
  readonly idleMs: number;
}

/**
 * Stops a run that runs too long or that goes quiet. The idle limit restarts with each sign of progress, so
 * a run that keeps working is never cut short; the total limit does not restart. The clock is stopped while a
 * run waits for an approval, because that wait belongs to the user.
 */
export class RunClock {
  private total: NodeJS.Timeout | undefined;
  private idle: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly limits: RunClockLimits,
    private readonly onStop: (stop: RunStop) => void,
  ) {}

  start(): void {
    this.running = true;
    this.total = setTimeout(() => this.fire("timeout"), this.limits.totalMs);
    this.touch();
  }

  /** Records progress: the idle limit starts again from now. */
  touch(): void {
    if (!this.running) return;
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.fire("stalled"), this.limits.idleMs);
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.total);
    clearTimeout(this.idle);
    this.total = undefined;
    this.idle = undefined;
  }

  private fire(stop: RunStop): void {
    this.stop();
    this.onStop(stop);
  }
}
