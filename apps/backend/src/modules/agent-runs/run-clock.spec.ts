import { jest } from "@jest/globals";
import { RunClock, type RunStop } from "./run-clock.js";

describe("RunClock", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("stops a run that goes quiet, and starts the quiet period again with each sign of progress", () => {
    const stops: RunStop[] = [];
    const clock = new RunClock({ totalMs: 60_000, idleMs: 1_000 }, (stop) => stops.push(stop));
    clock.start();
    jest.advanceTimersByTime(900);
    clock.touch();
    jest.advanceTimersByTime(900);
    expect(stops).toEqual([]);
    jest.advanceTimersByTime(200);
    expect(stops).toEqual(["stalled"]);
  });

  it("stops a run that lasts longer than its total limit, even while it keeps making progress", () => {
    const stops: RunStop[] = [];
    const clock = new RunClock({ totalMs: 5_000, idleMs: 1_000 }, (stop) => stops.push(stop));
    clock.start();
    for (let step = 0; step < 9; step += 1) {
      jest.advanceTimersByTime(500);
      clock.touch();
    }
    expect(stops).toEqual([]);
    jest.advanceTimersByTime(500);
    expect(stops).toEqual(["timeout"]);
  });

  it("does nothing once it is stopped, and ignores progress after that", () => {
    const stops: RunStop[] = [];
    const clock = new RunClock({ totalMs: 5_000, idleMs: 1_000 }, (stop) => stops.push(stop));
    clock.start();
    clock.stop();
    clock.touch();
    jest.advanceTimersByTime(10_000);
    expect(stops).toEqual([]);
  });
});
