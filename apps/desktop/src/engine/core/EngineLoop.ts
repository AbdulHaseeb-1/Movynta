export type FrameCallback = (deltaSeconds: number, nowSeconds: number) => void;

export interface FrameScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
}

const browserScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * One animation-frame loop per instance. `start` is idempotent, so mounting twice
 * cannot create duplicate loops, and `stop` always releases the pending frame.
 */
export class EngineLoop {
  private handle: number | null = null;
  private lastTimestampMs: number | null = null;
  private readonly callback: FrameCallback;
  private readonly scheduler: FrameScheduler;

  constructor(callback: FrameCallback, scheduler: FrameScheduler = browserScheduler) {
    this.callback = callback;
    this.scheduler = scheduler;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  start(): void {
    if (this.handle !== null) return;
    this.lastTimestampMs = null;
    this.handle = this.scheduler.request(this.tick);
  }

  stop(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    this.lastTimestampMs = null;
  }

  private readonly tick = (timestampMs: number): void => {
    const previous = this.lastTimestampMs;
    this.lastTimestampMs = timestampMs;
    const delta = previous === null ? 0 : (timestampMs - previous) / 1000;
    this.handle = this.scheduler.request(this.tick);
    this.callback(delta, timestampMs / 1000);
  };
}
