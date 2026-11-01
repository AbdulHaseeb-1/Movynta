import { Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { CharacterSimulation } from "./CharacterSimulation";
import { isWithinLimits } from "./character/JointLimits";
import { BONE_NAMES } from "./character/types";
import { DEG, eulerFromQuat } from "./core/math";
import { FIXED_DT } from "./core/SimulationClock";
import { SPEED_FAST_RUN, SPEED_RUN, SPEED_SPRINT, SPEED_WALK } from "./animation/types";
import { MotionDiagnostics, type DiagnosticsSummary } from "./testing/MotionDiagnostics";
import type { TerrainPreset } from "./physics/Terrain";

/** Acceptance targets from the task statement. */
const MAX_STANCE_DRIFT = 0.02;
const MAX_PENETRATION = -0.01;

async function create(terrain: TerrainPreset = "flat"): Promise<CharacterSimulation> {
  return CharacterSimulation.create({ terrain });
}

function record(sim: CharacterSimulation, settleSeconds = 0): MotionDiagnostics {
  const diagnostics = new MotionDiagnostics().attach(sim);
  diagnostics.settleSeconds = settleSeconds;
  return diagnostics;
}

/** The checks every motion must satisfy, whatever it is. */
function expectHealthy(s: DiagnosticsSummary): void {
  expect(s.nonFinite).toBe(0);
  expect(s.invalidQuaternions).toBe(0);
  expect(s.rootTeleports).toBe(0);
  expect(s.invertedKneeSteps).toBe(0);
  expect(s.maxKneeOffAxisDegrees).toBeLessThan(0.01);
  expect(s.snapEvents).toEqual([]);
  expect(s.limitCorrectionSteps).toBe(0);
  expect(s.minFootClearance).toBeGreaterThan(MAX_PENETRATION);
  expect(s.penetrationSteps).toBe(0);
  expect(s.maxStanceDrift).toBeLessThan(MAX_STANCE_DRIFT);
  expect(s.maxAnkleError).toBeLessThan(0.005);
  expect(s.alternating).toBe(true);
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - meanA;
    const db = (b[i] ?? 0) - meanB;
    ab += da * db;
    aa += da * da;
    bb += db * db;
  }
  return ab / Math.sqrt(aa * bb);
}

const euler = new Vector3();
function pitchOf(sim: CharacterSimulation, bone: (typeof BONE_NAMES)[number]): number {
  return eulerFromQuat(sim.pose.rotations[bone], euler).x / DEG;
}

beforeAll(async () => {
  // Warm up the WebAssembly module once so individual tests do not each pay for it.
  const sim = await create();
  sim.dispose();
}, 60_000);

describe("Test B: walking for 20 seconds", () => {
  it("steps in alternation, plants the support foot, and keeps arms opposite the legs", async () => {
    const sim = await create();
    const diagnostics = record(sim, 2);
    const armL: number[] = [];
    const legR: number[] = [];
    const legL: number[] = [];
    sim.observers.push((s) => {
      if (s.stepCount < 240) return;
      armL.push(pitchOf(s, "upper_arm_l"));
      legR.push(pitchOf(s, "thigh_r"));
      legL.push(pitchOf(s, "thigh_l"));
    });
    sim.setSpeed(SPEED_WALK);
    sim.run(20);
    const s = diagnostics.finish();

    expectHealthy(s);
    expect(s.states).toContain("walk");
    // 20 s at ~2 steps/s, split evenly between the feet.
    expect(s.touchdowns.l + s.touchdowns.r).toBeGreaterThan(36);
    expect(Math.abs(s.touchdowns.l - s.touchdowns.r)).toBeLessThanOrEqual(1);
    expect(s.flightSteps).toBe(0); // walking always has a foot down
    // Distance travelled agrees with the speed (accelerating for the first ~0.2 s).
    expect(sim.position.z).toBeGreaterThan(SPEED_WALK * 19.5);
    expect(sim.position.z).toBeLessThan(SPEED_WALK * 20);
    expect(Math.abs(sim.position.x)).toBeLessThan(0.05);
    // Contralateral swing: the left arm moves with the right leg and against the left leg.
    expect(correlation(armL, legR)).toBeGreaterThan(0.85);
    expect(correlation(armL, legL)).toBeLessThan(-0.55); // legs swing fast and stand slowly, so not a pure sine
    // Steady vertical bounce, a few centimeters.
    expect(s.maxPelvisY - s.minPelvisY).toBeLessThan(0.12);
  }, 60_000);
});

describe("Test C: running for 20 seconds", () => {
  it("has contact and flight phases, steady speed and no impossible rotations", async () => {
    const sim = await create();
    const diagnostics = record(sim, 2);
    const speeds: number[] = [];
    sim.observers.push((s) => {
      if (s.stepCount > 360) speeds.push(s.controller.horizontalSpeed);
    });
    sim.setSpeed(SPEED_RUN);
    sim.run(20);
    const s = diagnostics.finish();

    expectHealthy(s);
    expect(s.states).toContain("run");
    expect(sim.gait.duty).toBeLessThan(0.5);
    expect(s.flightSteps).toBeGreaterThan(0.1 * 18 * 120);
    // Faster stepping than walking, with the same left/right balance.
    expect(s.meanStepInterval).toBeGreaterThan(0.28);
    expect(s.meanStepInterval).toBeLessThan(0.4);
    expect(Math.abs(s.touchdowns.l - s.touchdowns.r)).toBeLessThanOrEqual(1);
    // Speed progression: reaches the target and holds it.
    expect(Math.min(...speeds)).toBeGreaterThan(SPEED_RUN - 0.05);
    expect(Math.max(...speeds)).toBeLessThan(SPEED_RUN + 0.05);
    // No excessive vertical bouncing.
    expect(s.maxPelvisY - s.minPelvisY).toBeLessThan(0.16);
  }, 60_000);
});

describe("Test D: acceleration to sprint, then deceleration", () => {
  it("accelerates smoothly with growing stride, cadence and lean, and returns to idle", async () => {
    const sim = await create();
    const diagnostics = record(sim, 0.3);
    const samples: { speed: number; stride: number; cadence: number; lean: number; state: string }[] = [];
    const speedTrace: number[] = [];
    sim.observers.push((s) => {
      speedTrace.push(s.controller.horizontalSpeed);
      // Only the acceleration phase is sampled for the speed-versus-shape comparison; braking has its own lean.
      if (s.stepCount % 12 === 0 && s.stepCount <= 6 * 120) {
        samples.push({ speed: s.controller.horizontalSpeed, stride: s.gait.strideLength, cadence: s.gait.cadence, lean: s.generator.report.lean, state: s.state });
      }
    });
    sim.setSpeed(SPEED_SPRINT);
    sim.run(6);
    const atSprint = sim.state;
    sim.setSpeed(0);
    sim.run(6);
    const s = diagnostics.finish();

    expectHealthy(s);
    expect(atSprint).toBe("sprint");
    expect(s.states).toEqual(expect.arrayContaining(["accelerate", "sprint", "decelerate", "stop", "idle"]));
    expect(sim.state).toBe("idle");
    expect(sim.controller.horizontalSpeed).toBeLessThan(0.01);
    expect(sim.gait.mode).toBe("idle");

    // Speed never jumps: the largest per-step change is bounded by the controller's acceleration limits.
    let largestStepChange = 0;
    for (let i = 1; i < speedTrace.length; i++) {
      largestStepChange = Math.max(largestStepChange, Math.abs((speedTrace[i] ?? 0) - (speedTrace[i - 1] ?? 0)));
    }
    expect(largestStepChange).toBeLessThan(sim.controller.params.deceleration * FIXED_DT * 1.05);

    // Stride, cadence and lean all grow with speed.
    const at = (target: number) => samples.reduce((best, x) => (Math.abs(x.speed - target) < Math.abs(best.speed - target) ? x : best));
    const walk = at(SPEED_WALK);
    const run = at(SPEED_RUN);
    const fast = at(SPEED_FAST_RUN);
    const sprint = at(SPEED_SPRINT);
    expect(run.stride).toBeGreaterThan(walk.stride);
    expect(fast.stride).toBeGreaterThan(run.stride);
    expect(sprint.stride).toBeGreaterThan(fast.stride);
    expect(run.cadence).toBeGreaterThan(walk.cadence);
    expect(sprint.cadence).toBeGreaterThan(run.cadence);
    expect(sprint.lean).toBeGreaterThan(fast.lean);
    expect(fast.lean).toBeGreaterThan(run.lean);
    expect(run.lean).toBeGreaterThan(walk.lean);
    expect(sprint.lean).toBeGreaterThan(0.3); // clearly leaning forward at full speed
  }, 60_000);
});

describe("animation states follow speed", () => {
  it("shows walk, run, fast run and sprint as the commanded speed rises in steps, and idle when it stops", async () => {
    const sim = await create();
    const seen: Record<string, string> = {};
    for (const [label, speed] of [["walk", SPEED_WALK], ["run", SPEED_RUN], ["fast_run", SPEED_FAST_RUN], ["sprint", SPEED_SPRINT]] as const) {
      sim.setSpeed(speed);
      sim.run(4);
      seen[label] = sim.state;
    }
    sim.setSpeed(0);
    sim.run(5);
    seen["idle"] = sim.state;
    expect(seen).toEqual({ walk: "walk", run: "run", fast_run: "fast_run", sprint: "sprint", idle: "idle" });
  }, 60_000);

  it("never flickers between neighbouring states near a speed boundary", async () => {
    const sim = await create();
    sim.setSpeed(2.3); // sits between the walk and run bands
    sim.run(4);
    const before = sim.machine.history.length;
    sim.run(6);
    expect(sim.machine.history.length - before).toBeLessThanOrEqual(1);
  }, 60_000);

  it("keeps the blend weights a valid distribution through every transition", async () => {
    const sim = await create();
    let worst = 0;
    sim.observers.push((s) => {
      const total = Object.values(s.blender.weights).reduce((a, b) => a + b, 0);
      worst = Math.max(worst, Math.abs(total - 1));
    });
    sim.setSpeed(SPEED_SPRINT);
    sim.run(3);
    sim.jumpNow();
    sim.run(2);
    sim.setSpeed(0);
    sim.run(4);
    expect(worst).toBeLessThan(1e-6);
  }, 60_000);
});

describe("Test E: back bending", () => {
  it("spreads a backward bend over several joints, compensates, and returns to neutral", async () => {
    const sim = await create();
    const diagnostics = record(sim);
    sim.run(1);
    const totals: number[] = [];
    for (const target of [-20, -40, -60]) {
      sim.tuning.spineBend = target;
      sim.run(2);
      totals.push(pitchOf(sim, "spine_lower") + pitchOf(sim, "spine_mid") + pitchOf(sim, "spine_upper"));
    }
    // Progressive extension: each step bends further back.
    expect(totals[1]).toBeLessThan(totals[0] ?? 0);
    expect(totals[2]).toBeLessThan(totals[1] ?? 0);

    // Every spine joint takes part, none past its limit.
    for (const bone of ["spine_lower", "spine_mid", "spine_upper"] as const) {
      expect(pitchOf(sim, bone)).toBeLessThan(-5);
      expect(isWithinLimits(bone, sim.pose.rotations[bone])).toBe(true);
    }
    // Pelvis compensates: it tips forward and the hips move forward over the feet.
    expect(pitchOf(sim, "pelvis")).toBeGreaterThan(3);
    expect(sim.pose.pelvisPosition.z).toBeGreaterThan(0.03);
    // The head stays controlled: neck and head flex forward to keep the gaze up, within their limits.
    expect(pitchOf(sim, "neck")).toBeGreaterThan(0);
    expect(pitchOf(sim, "head")).toBeGreaterThan(0);
    expect(isWithinLimits("neck", sim.pose.rotations.neck)).toBe(true);
    expect(isWithinLimits("head", sim.pose.rotations.head)).toBe(true);
    // No joint anywhere left its range, and the planted feet did not move.
    for (const bone of BONE_NAMES) if (bone !== "root") expect(isWithinLimits(bone, sim.pose.rotations[bone])).toBe(true);

    sim.tuning.spineBend = 0;
    sim.run(3);
    for (const bone of ["spine_lower", "spine_mid", "spine_upper", "neck", "head", "pelvis"] as const) {
      expect(Math.abs(pitchOf(sim, bone))).toBeLessThan(1.5);
    }
    const s = diagnostics.finish();
    expect(s.jointSnaps).toBe(0);
    expect(s.maxJointStepDegrees).toBeLessThan(3);
    expect(s.maxStanceDrift).toBeLessThan(0.001);
    expect(s.limitCorrectionSteps).toBe(0);
  }, 60_000);

  it("bends forward through the same joints and keeps the head level", async () => {
    const sim = await create();
    sim.run(1);
    sim.tuning.spineBend = 60;
    sim.run(3);
    for (const bone of ["spine_lower", "spine_mid", "spine_upper"] as const) expect(pitchOf(sim, bone)).toBeGreaterThan(5);
    expect(sim.pose.pelvisPosition.z).toBeLessThan(-0.05); // hips move back as the torso goes forward
    expect(pitchOf(sim, "neck") + pitchOf(sim, "head")).toBeLessThan(-30); // head counter-rotates
  }, 60_000);
});

describe("Test F: jumping and landing", () => {
  it("takes off, follows gravity, lands, compresses and recovers", async () => {
    const sim = await create();
    const diagnostics = record(sim);
    sim.run(1);
    const standingPelvis = sim.rig.worldPosition.pelvis.y;
    const states: string[] = [];
    const heights: number[] = [];
    const velocities: number[] = [];
    let takeoffVelocity = 0;
    let airSteps = 0;
    let lowestPelvis = Infinity;
    expect(sim.jumpNow()).toBe(true);
    expect(sim.jumpNow()).toBe(false); // a second request while jumping is ignored
    sim.observers.push((s) => {
      if (states[states.length - 1] !== s.state) states.push(s.state);
      if (!s.controller.grounded) {
        airSteps += 1;
        heights.push(s.position.y);
        velocities.push(s.controller.velocity.y);
        takeoffVelocity = Math.max(takeoffVelocity, s.controller.velocity.y);
      }
      if (s.jump.phase === "landing") lowestPelvis = Math.min(lowestPelvis, s.rig.worldPosition.pelvis.y);
    });
    sim.run(3);
    const s = diagnostics.finish();

    expect(states).toEqual(expect.arrayContaining(["jump", "fall", "land", "idle"]));
    expect(states.indexOf("jump")).toBeLessThan(states.indexOf("fall"));
    expect(states.indexOf("fall")).toBeLessThan(states.indexOf("land"));
    expect(takeoffVelocity).toBeGreaterThan(3.8);
    // Airborne for about v0 * 2 / g.
    const airTime = airSteps * FIXED_DT;
    expect(airTime).toBeGreaterThan(0.7);
    expect(airTime).toBeLessThan(0.9);
    expect(Math.max(...heights)).toBeGreaterThan(0.7);
    // Gravity-driven: vertical velocity falls by g every second while airborne.
    const slope = ((velocities[velocities.length - 5] ?? 0) - (velocities[5] ?? 0)) / ((velocities.length - 10) * FIXED_DT);
    expect(slope).toBeGreaterThan(-9.81 * 1.03);
    expect(slope).toBeLessThan(-9.81 * 0.97);
    // Landing: back on the ground, pelvis compressed, then recovered.
    expect(sim.controller.grounded).toBe(true);
    expect(sim.position.y).toBeLessThan(0.05);
    expect(standingPelvis - lowestPelvis).toBeGreaterThan(0.05);
    expect(Math.abs(sim.rig.worldPosition.pelvis.y - standingPelvis)).toBeLessThan(0.02);
    expect(sim.jump.phase).toBe("none");
    expect(s.nonFinite).toBe(0);
    expect(s.jointSnaps).toBe(0);
    expect(s.penetrationSteps).toBe(0);
    expect(s.invertedKneeSteps).toBe(0);
  }, 60_000);

  it("jumps while running without losing speed or the gait", async () => {
    const sim = await create();
    const diagnostics = record(sim, 2.5);
    sim.setSpeed(SPEED_RUN);
    sim.run(3);
    sim.jumpNow();
    sim.run(3);
    const s = diagnostics.finish();
    expect(sim.state).toBe("run");
    expect(sim.controller.horizontalSpeed).toBeGreaterThan(SPEED_RUN - 0.1);
    expect(s.states).toEqual(expect.arrayContaining(["jump", "fall", "land"]));
    expect(s.nonFinite).toBe(0);
    expect(s.jointSnaps).toBe(0);
    expect(s.penetrationSteps).toBe(0);
    expect(s.maxStanceDrift).toBeLessThan(MAX_STANCE_DRIFT);
  }, 60_000);
});

describe("Test G: variable frame rate", () => {
  const TARGET_STEPS = 1200;

  async function runAt(frameSeconds: (frame: number) => number): Promise<CharacterSimulation> {
    const sim = await create();
    sim.setSpeed(SPEED_RUN);
    let frame = 0;
    let jumped = false;
    while (sim.stepCount < TARGET_STEPS) {
      sim.advance(frameSeconds(frame++));
      if (!jumped && sim.stepCount >= 600) {
        jumped = true;
        sim.jumpNow();
      }
    }
    return sim;
  }

  it("produces the same displacement and animation state at 30, 60 and 120 FPS rendering", async () => {
    const results = await Promise.all([30, 60, 120, 144].map((fps) => runAt(() => 1 / fps)));
    const reference = results[0];
    if (!reference) throw new Error("no reference run");
    for (const sim of results) {
      // The fixed step makes these identical, apart from the one step of rounding the accumulator can add.
      expect(Math.abs(sim.stepCount - reference.stepCount)).toBeLessThanOrEqual(2);
      expect(sim.position.distanceTo(reference.position)).toBeLessThan(0.1);
      expect(sim.state).toBe(reference.state);
      expect(sim.gait.mode).toBe(reference.gait.mode);
      expect(Math.abs(sim.gait.phase - reference.gait.phase)).toBeLessThan(0.1);
    }
  }, 120_000);

  it("is unaffected by uneven frame times", async () => {
    let seed = 11;
    const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 0.035 + 0.004;
    const steady = await runAt(() => 1 / 60);
    const uneven = await runAt(jitter);
    expect(uneven.position.distanceTo(steady.position)).toBeLessThan(0.15);
    expect(uneven.state).toBe(steady.state);
  }, 120_000);

  it("steps identically when advanced in whole fixed steps", async () => {
    const a = await create();
    const b = await create();
    a.setSpeed(SPEED_RUN);
    b.setSpeed(SPEED_RUN);
    a.run(5);
    for (let i = 0; i < 5 * 120; i++) b.advance(FIXED_DT);
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-9);
    expect(a.gait.phase).toBeCloseTo(b.gait.phase, 12);
  }, 60_000);
});

describe("uneven terrain", () => {
  it("walks up a slope, keeping the feet on the surface", async () => {
    const sim = await create("slope");
    const diagnostics = record(sim, 1);
    sim.setSpeed(SPEED_WALK);
    sim.run(14);
    const s = diagnostics.finish();
    expect(sim.position.y).toBeGreaterThan(1.1); // climbed the ramp
    expect(s.penetrationSteps).toBe(0);
    expect(s.maxStanceDrift).toBeLessThan(MAX_STANCE_DRIFT);
    expect(s.jointSnaps).toBe(0);
    expect(s.limitCorrectionSteps).toBe(0);
  }, 60_000);

  it.each([
    ["walking", SPEED_WALK, 9],
    ["running", SPEED_RUN, 6],
  ] as const)("steps up onto a small step while %s", async (_label, speed, seconds) => {
    const sim = await create("step");
    const diagnostics = record(sim, 1);
    sim.setSpeed(speed);
    sim.run(seconds);
    const s = diagnostics.finish();
    expect(sim.position.y).toBeGreaterThan(0.1);
    expect(s.penetrationSteps).toBe(0);
    expect(s.maxStanceDrift).toBeLessThan(MAX_STANCE_DRIFT);
    expect(s.jointSnaps).toBe(0);
  }, 60_000);

  it("jumps onto a raised platform", async () => {
    const sim = await create("platform");
    const diagnostics = record(sim, 1);
    sim.setSpeed(2.5);
    sim.run(2);
    sim.jumpNow();
    sim.run(2);
    sim.setSpeed(0);
    sim.run(2);
    const s = diagnostics.finish();
    expect(sim.position.y).toBeGreaterThan(0.38);
    expect(s.penetrationSteps).toBe(0);
    expect(s.nonFinite).toBe(0);
    expect(sim.state).toBe("idle");
  }, 60_000);
});

describe("turning, strafing and standing", () => {
  it("turns smoothly while running with no limb snapping or teleporting", async () => {
    const sim = await create();
    const diagnostics = record(sim, 2);
    sim.setSpeed(SPEED_RUN);
    sim.run(3);
    const yaws: number[] = [];
    sim.observers.push((s) => yaws.push(s.controller.yaw));
    sim.setHeading(Math.PI / 2);
    sim.run(4);
    const s = diagnostics.finish();
    expect(sim.controller.yaw).toBeCloseTo(Math.PI / 2, 1);
    // Heading changes gradually: no step turns the body more than the turn-rate limit allows.
    let largest = 0;
    for (let i = 1; i < yaws.length; i++) largest = Math.max(largest, Math.abs((yaws[i] ?? 0) - (yaws[i - 1] ?? 0)));
    expect(largest).toBeLessThan((280 * DEG) * FIXED_DT);
    expect(s.jointSnaps).toBe(0);
    expect(s.rootTeleports).toBe(0);
    expect(s.penetrationSteps).toBe(0);
    expect(s.maxStanceDrift).toBeLessThan(MAX_STANCE_DRIFT);
  }, 60_000);

  it("turns in place by stepping", async () => {
    const sim = await create();
    const diagnostics = record(sim);
    sim.setHeading(Math.PI);
    sim.run(4);
    const s = diagnostics.finish();
    expect(Math.abs(Math.abs(sim.controller.yaw) - Math.PI)).toBeLessThan(0.05);
    expect(s.states).toContain("turn");
    expect(s.touchdowns.l + s.touchdowns.r).toBeGreaterThanOrEqual(2); // feet were repositioned
    expect(s.jointSnaps).toBe(0);
    expect(s.limitCorrectionSteps).toBe(0);
    expect(s.penetrationSteps).toBe(0);
    expect(sim.position.length()).toBeLessThan(0.01); // turned without drifting
  }, 60_000);

  it.each([
    ["backward", Math.PI],
    ["sideways", Math.PI / 2],
    ["diagonally backward", Math.PI * 0.75],
  ] as const)("moves %s with a locked facing", async (_label, heading) => {
    const sim = await create();
    const diagnostics = record(sim, 1);
    sim.setFacing("locked", 0);
    sim.setHeading(heading);
    sim.setSpeed(1.6);
    sim.run(8);
    const s = diagnostics.finish();
    expect(sim.controller.yaw).toBeCloseTo(0, 5); // still facing forward
    expect(Math.hypot(sim.position.x, sim.position.z)).toBeGreaterThan(10);
    expect(s.limitCorrectionSteps).toBe(0);
    expect(s.penetrationSteps).toBe(0);
    expect(s.jointSnaps).toBe(0);
    expect(s.maxStanceDrift).toBeLessThan(MAX_STANCE_DRIFT);
  }, 120_000);

  it("stands still for twenty seconds without moving anything", async () => {
    const sim = await create();
    const diagnostics = record(sim, 0.5);
    sim.run(20);
    const s = diagnostics.finish();
    expect(sim.position.length()).toBeLessThan(1e-6);
    expect(s.maxStanceDrift).toBeLessThan(1e-6);
    expect(s.jointSnaps).toBe(0);
    expect(s.minPelvisY).toBeGreaterThan(sim.rig.hipHeight - 0.05);
    // Breathing and weight shift are present but subtle.
    expect(s.states).toEqual(["idle"]);
  }, 60_000);
});

describe("foot IK strength", () => {
  it("lets stance feet slide when IK is off and locks them when it is on", async () => {
    const drift = async (strength: number): Promise<number> => {
      const sim = await create();
      sim.tuning.footIK = strength;
      const diagnostics = record(sim, 1.5);
      // A speed between the reference gaits makes a canned clip slide.
      sim.setSpeed(2.9);
      sim.run(8);
      return diagnostics.finish().maxStanceDrift;
    };
    const locked = await drift(1);
    const free = await drift(0);
    expect(locked).toBeLessThan(MAX_STANCE_DRIFT);
    expect(free).toBeGreaterThan(0.05);
    expect(await drift(0.5)).toBeGreaterThan(locked);
  }, 120_000);
});

describe("tuning sliders change behavior", () => {
  async function measure(tune: (sim: CharacterSimulation) => void, speed = SPEED_RUN): Promise<{ stride: number; lean: number; arm: number; knee: number; bounce: number; interval: number }> {
    const sim = await create();
    tune(sim);
    const diagnostics = record(sim, 2);
    let arm = 0;
    let knee = 0;
    sim.setSpeed(speed);
    sim.observers.push((s) => {
      if (s.stepCount < 240) return;
      arm = Math.max(arm, Math.abs(pitchOf(s, "upper_arm_l")));
      knee = Math.max(knee, Math.max(-s.legReports.l.kneeAngle, 0) + (Math.PI - s.legReports.l.kneeAngle));
    });
    sim.run(8);
    const s = diagnostics.finish();
    return { stride: sim.gait.strideLength, lean: sim.generator.report.lean, arm, knee, bounce: s.maxPelvisY - s.minPelvisY, interval: s.meanStepInterval };
  }

  it("stride length and step frequency change stride and cadence while the speed stays fixed", async () => {
    const base = await measure(() => undefined);
    const longer = await measure((s) => (s.tuning.strideLength = 1.3));
    const quicker = await measure((s) => (s.tuning.stepFrequency = 1.25));
    expect(longer.stride).toBeGreaterThan(base.stride * 1.25);
    expect(longer.interval).toBeGreaterThan(base.interval * 1.2);
    expect(quicker.interval).toBeLessThan(base.interval * 0.85);
  }, 120_000);

  it("forward lean, arm swing, knee lift and pelvis bounce scale their motion", async () => {
    const base = await measure(() => undefined);
    expect((await measure((s) => (s.tuning.forwardLean = 2))).lean).toBeGreaterThan(base.lean * 1.5);
    expect((await measure((s) => (s.tuning.forwardLean = 0))).lean).toBeLessThan(base.lean * 0.5);
    expect((await measure((s) => (s.tuning.armSwing = 2))).arm).toBeGreaterThan(base.arm * 1.15);
    expect((await measure((s) => (s.tuning.armSwing = 0))).arm).toBeLessThan(base.arm * 0.7);
    expect((await measure((s) => (s.tuning.kneeLift = 1.6))).knee).toBeGreaterThan(base.knee * 1.02);
    expect((await measure((s) => (s.tuning.pelvisBounce = 2))).bounce).toBeGreaterThan(base.bounce);
    expect((await measure((s) => (s.tuning.pelvisBounce = 0))).bounce).toBeLessThan(base.bounce);
  }, 240_000);

  it("turning speed limits how fast the character can change heading", async () => {
    const turnTime = async (degPerSecond: number): Promise<number> => {
      const sim = await create();
      sim.tuning.turningSpeed = degPerSecond;
      sim.setHeading(Math.PI / 2);
      let steps = 0;
      while (Math.abs(Math.PI / 2 - sim.controller.yaw) > 0.05 && steps < 2000) {
        sim.step();
        steps += 1;
      }
      return steps * FIXED_DT;
    };
    expect(await turnTime(120)).toBeGreaterThan((await turnTime(400)) * 1.6);
  }, 60_000);

  it("blend duration changes how long a state crossfade takes", async () => {
    const settle = async (duration: number): Promise<number> => {
      const sim = await create();
      sim.tuning.blendDuration = duration;
      sim.setSpeed(SPEED_RUN);
      sim.run(4);
      sim.setSpeed(0);
      let steps = 0;
      while (sim.blender.weights.idle < 0.99 && steps < 3000) {
        sim.step();
        steps += 1;
      }
      return steps * FIXED_DT;
    };
    expect(await settle(0.8)).toBeGreaterThan((await settle(0.1)) + 0.4);
  }, 60_000);

  it("secondary motion intensity scales head and arm follow-through", async () => {
    const response = async (intensity: number): Promise<number> => {
      const sim = await create();
      sim.tuning.secondaryMotion = intensity;
      sim.setSpeed(SPEED_SPRINT);
      let peak = 0;
      sim.observers.push((s) => (peak = Math.max(peak, Math.abs(s.secondary.output.headPitch) + Math.abs(s.secondary.output.armLag))));
      sim.run(3);
      return peak;
    };
    const off = await response(0);
    const on = await response(1);
    expect(off).toBe(0);
    expect(on).toBeGreaterThan(0.01);
    expect(await response(2)).toBeGreaterThan(on);
  }, 60_000);
});
