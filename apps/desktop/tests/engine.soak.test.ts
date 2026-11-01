import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CharacterSimulation } from "../src/engine/CharacterSimulation";
import { FIXED_DT } from "../src/engine/core/SimulationClock";
import { SPEED_FAST_RUN, SPEED_RUN, SPEED_SPRINT, SPEED_WALK } from "../src/engine/animation/types";
import { STICKMAN_CHARACTER_CONFIG } from "../src/engine/character/SkeletonBuilder";
import { MotionDiagnostics } from "../src/engine/testing/MotionDiagnostics";

/** Heap size after a full garbage collection, so growth means retained objects rather than pending garbage. */
function collectedHeapBytes(): number {
  setFlagsFromString("--expose-gc");
  const collect: unknown = runInNewContext("gc");
  if (typeof collect === "function") collect();
  return process.memoryUsage().heapUsed;
}

describe("Test H: long-running stability", () => {
  it("survives five minutes of mixed movement without drift, NaN, teleports or leaks", async () => {
    const sim = await CharacterSimulation.create({ terrain: "flat", config: STICKMAN_CHARACTER_CONFIG });
    const diagnostics = new MotionDiagnostics();
    diagnostics.settleSeconds = 1;
    diagnostics.heapSampler = collectedHeapBytes;
    diagnostics.attach(sim); // after the sampler is set, so the baseline heap is measured once, collected

    const plan: { speed: number; seconds: number; jump?: boolean; turn?: number }[] = [
      { speed: SPEED_WALK, seconds: 8 },
      { speed: SPEED_RUN, seconds: 8, turn: Math.PI / 2 },
      { speed: SPEED_SPRINT, seconds: 8, jump: true },
      { speed: 0, seconds: 5 },
      { speed: SPEED_FAST_RUN, seconds: 7, turn: -Math.PI },
      { speed: SPEED_WALK, seconds: 6, jump: true },
      { speed: 0, seconds: 3 },
    ];
    let heading = 0;
    const visited = new Set<string>();
    let lastChange = 0;
    let longestStuck = 0;
    let previousState = sim.state;
    let maxStep = 0;
    let lastPosition = sim.position.clone();
    let rootYMin = Infinity;
    let rootYMax = -Infinity;
    sim.observers.push((s) => {
      visited.add(s.state);
      if (s.state !== previousState) {
        longestStuck = Math.max(longestStuck, s.stepCount - lastChange);
        lastChange = s.stepCount;
        previousState = s.state;
      }
      maxStep = Math.max(maxStep, s.position.distanceTo(lastPosition));
      lastPosition = s.position.clone();
      rootYMin = Math.min(rootYMin, s.position.y);
      rootYMax = Math.max(rootYMax, s.position.y);
    });

    let elapsed = 0;
    while (elapsed < 300) {
      for (const phase of plan) {
        heading += phase.turn ?? 0;
        sim.setHeading(heading);
        sim.setSpeed(phase.speed);
        if (phase.jump) {
          sim.run(2);
          sim.jumpNow();
          sim.run(phase.seconds - 2);
        } else {
          sim.run(phase.seconds);
        }
        elapsed += phase.seconds;
        if (elapsed >= 300) break;
      }
    }
    const s = diagnostics.finish();

    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(s.steps).toBeGreaterThanOrEqual(300 * 120);
    expect(s.steps).toBeLessThan(300 * 120 + 120 * 20); // every step was recorded once
    expect(s.nonFinite).toBe(0);
    expect(s.invalidQuaternions).toBe(0);
    expect(s.invertedKneeSteps).toBe(0);
    expect(s.rootTeleports).toBe(0);
    expect(maxStep).toBeLessThan(0.12); // 8 m/s * 1/120 s is 0.067 m; nothing near a jump
    // No vertical drift: the character stays on the ground plane throughout.
    expect(rootYMin).toBeGreaterThan(-0.02);
    expect(rootYMax).toBeLessThan(1.1); // a jump apex, never more
    expect(sim.position.y).toBeLessThan(0.05);
    // State machine keeps moving: every state in the plan was reached, and none lasted more than 20 s.
    expect(visited).toEqual(expect.objectContaining({}));
    for (const state of ["idle", "walk", "run", "sprint", "jump", "land"]) expect(visited.has(state)).toBe(true);
    expect(longestStuck * FIXED_DT).toBeLessThan(20);
    expect(s.snapEvents.length).toBeLessThanOrEqual(2);
    expect(s.minFootClearance).toBeGreaterThan(-0.03);
    expect(s.maxStanceDrift).toBeLessThan(0.03);
    expect(s.heapGrowthMb).toBeLessThan(25);
  }, 180_000);
});

