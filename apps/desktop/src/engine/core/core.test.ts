import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { EngineLoop, type FrameScheduler } from "./EngineLoop";
import { DEG, SpringDamper, damp, eulerFromQuat, fract, quatFromEuler, wrapPi } from "./math";
import { FIXED_DT, SimulationClock } from "./SimulationClock";

describe("math", () => {
  it("wraps angles and fractions", () => {
    expect(wrapPi(3.2 * Math.PI)).toBeCloseTo(-0.8 * Math.PI, 9);
    expect(wrapPi(-3.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 9);
    expect(fract(-0.25)).toBeCloseTo(0.75, 12);
  });

  it("round-trips XYZ Euler angles and matches three.js", () => {
    const q = new Quaternion();
    const e = new Vector3();
    for (const [x, y, z] of [[0.3, -0.4, 0.2], [-1.9, 0.7, 0.1], [2.0, 0, -0.5]] as const) {
      quatFromEuler(q, x, y, z);
      eulerFromQuat(q, e);
      expect(e.x).toBeCloseTo(x, 9);
      expect(e.y).toBeCloseTo(y, 9);
      expect(e.z).toBeCloseTo(z, 9);
    }
  });

  it("damp is frame-rate independent", () => {
    let coarse = 0;
    for (let i = 0; i < 30; i++) coarse = damp(coarse, 1, 5, 1 / 30);
    let fine = 0;
    for (let i = 0; i < 120; i++) fine = damp(fine, 1, 5, 1 / 120);
    expect(coarse).toBeCloseTo(fine, 6);
  });

  it("spring settles without overshoot when critically damped", () => {
    const spring = new SpringDamper(0, 12, 1);
    let peak = 0;
    for (let i = 0; i < 600; i++) peak = Math.max(peak, spring.update(1, FIXED_DT));
    expect(peak).toBeLessThan(1.01);
    expect(spring.value).toBeCloseTo(1, 3);
    expect(DEG).toBeGreaterThan(0);
  });
});

describe("SimulationClock", () => {
  it("runs the same number of steps regardless of render rate", () => {
    const counts = [30, 60, 120, 144].map((fps) => {
      const clock = new SimulationClock();
      for (let i = 0; i < fps * 5; i++) clock.advance(1 / fps);
      return clock.steps;
    });
    for (const count of counts) expect(Math.abs(count - 600)).toBeLessThanOrEqual(1);
  });

  it("drops very long pauses instead of simulating them", () => {
    const clock = new SimulationClock();
    expect(clock.advance(30).steps).toBeLessThanOrEqual(31);
  });
});

describe("EngineLoop", () => {
  function manualScheduler() {
    const queue = new Map<number, (t: number) => void>();
    let next = 1;
    const scheduler: FrameScheduler = {
      request: (cb) => {
        queue.set(next, cb);
        return next++;
      },
      cancel: (h) => void queue.delete(h),
    };
    const flush = (t: number) => {
      const callbacks = [...queue.values()];
      queue.clear();
      callbacks.forEach((cb) => cb(t));
    };
    return { scheduler, flush, pending: () => queue.size };
  }

  it("never schedules more than one frame, even if started twice", () => {
    const { scheduler, flush, pending } = manualScheduler();
    const deltas: number[] = [];
    const loop = new EngineLoop((dt) => deltas.push(dt), scheduler);
    loop.start();
    loop.start();
    expect(pending()).toBe(1);
    flush(1000);
    flush(1016);
    expect(pending()).toBe(1);
    expect(deltas[1]).toBeCloseTo(0.016, 6);
    loop.stop();
    expect(pending()).toBe(0);
    expect(loop.running).toBe(false);
  });
});
