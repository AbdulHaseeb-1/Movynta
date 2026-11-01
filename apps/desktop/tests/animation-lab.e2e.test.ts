import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Browser tests advance simulated time and render in software, so they get a generous per-test limit.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

/**
 * Drives the real Animation Lab in headless Chromium (software WebGL). Time is advanced explicitly through the
 * capture handle, so the results do not depend on how fast the machine renders.
 */
let server: ViteDevServer;
let browser: Browser;
let page: Page;
let baseUrl = "";
const problems: string[] = [];

interface Snapshot {
  state: string;
  speed: number;
  yawDegrees: number;
  headingDegrees: number;
  grounded: boolean;
  jumpPhase: string;
  position: { x: number; y: number; z: number };
  tuning: Record<string, number>;
  timelineActive: boolean;
  timelineTime: number;
  timelineState: string;
  inPlace: boolean;
  gaitMode: string;
  bones: Record<string, { x: number; y: number; z: number }>;
  cameraType: string;
  cameraDistance: number;
  canvasCount: number;
}

async function snapshot(): Promise<Snapshot> {
  return page.evaluate(() => {
    const lab = Reflect.get(window, "movyntaLab");
    const sim = lab.sim;
    const euler = (name: string) => {
      const q = sim.pose.rotations[name];
      return { x: q.x, y: q.y, z: q.z };
    };
    const camera = lab.scene.activeCamera;
    return {
      state: sim.machine.current,
      speed: sim.controller.horizontalSpeed,
      yawDegrees: (sim.controller.yaw * 180) / Math.PI,
      headingDegrees: (sim.command.heading * 180) / Math.PI,
      grounded: sim.controller.grounded,
      jumpPhase: sim.jump.phase,
      position: { x: sim.position.x, y: sim.position.y, z: sim.position.z },
      tuning: { ...sim.tuning },
      timelineActive: sim.timelineActive,
      timelineTime: sim.timeline.time,
      timelineState: sim.timeline.state,
      inPlace: sim.inPlace,
      gaitMode: sim.gait.mode,
      bones: { spine_lower: euler("spine_lower"), spine_mid: euler("spine_mid"), upper_arm_l: euler("upper_arm_l"), thigh_l: euler("thigh_l") },
      cameraType: camera.type,
      cameraDistance: camera.position.distanceTo(lab.scene.controls.target),
      canvasCount: document.querySelectorAll("canvas").length,
    };
  });
}

/** Advances the simulation by `seconds` and redraws once. */
async function wait(seconds: number): Promise<void> {
  await page.evaluate((s) => Reflect.get(window, "movyntaLab").fastForward(s), seconds);
}

const click = (id: string) => page.getByTestId(id).click();

async function openLab(): Promise<void> {
  // A real query string (not just a hash) so a page already open on the lab is reloaded with the capture handle.
  await page.goto(`${baseUrl}/?capture#/lab`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => Reflect.get(window, "movyntaLab") !== undefined, null, { timeout: 30_000 });
  await click("button-reset-pose");
  // Flat ground: the course's raised landing would (correctly) make a long sprint fall off its far edge.
  await page.getByTestId("select-terrain").click();
  await page.getByRole("option", { name: "Flat" }).click();
  await wait(0.5);
}

/** Sets a slider by keyboard, the way a user without a mouse would. */
async function setSlider(id: string, key: "Home" | "End" | "ArrowRight" | "ArrowLeft", presses = 1): Promise<void> {
  const thumb = page.locator(`[data-testid="slider-${id}"] [role="slider"]`);
  await thumb.focus();
  for (let i = 0; i < presses; i++) await thumb.press(key);
}

beforeAll(async () => {
  server = await createServer({ server: { port: 1437, strictPort: false, host: "127.0.0.1" }, logLevel: "error", clearScreen: false });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Dev server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  page = await browser.newPage({ viewport: { width: 1500, height: 880 } });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  await openLab();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe("Animation Lab: page", () => {
  it("renders a real 3D scene with no console errors or warnings", async () => {
    const canvas = page.getByTestId("lab-viewport").locator("canvas");
    expect(await canvas.count()).toBe(1);
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(400);
    expect(box?.height).toBeGreaterThan(300);
    // A blank canvas is one flat color; a rendered scene has many.
    const png = await page.getByTestId("lab-viewport").screenshot();
    const distinct = await page.evaluate(async (data) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
      if (!surface) return 0;
      surface.drawImage(bitmap, 0, 0);
      const pixels = surface.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const colors = new Set<number>();
      for (let i = 0; i < pixels.length; i += 4 * 97) colors.add(((pixels[i] ?? 0) << 16) | ((pixels[i + 1] ?? 0) << 8) | (pixels[i + 2] ?? 0));
      return colors.size;
    }, png.toString("base64"));
    expect(distinct).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });

  it("is reachable from Home", async () => {
    await page.goto(`${baseUrl}/?capture#/`, { waitUntil: "load" });
    await click("open-animation-lab");
    await page.getByTestId("animation-lab").waitFor({ state: "attached", timeout: 15_000 });
    expect(page.url()).toContain("#/lab");
    // The Home card opens the plain lab; tests then reopen it with the capture handle.
    await openLab();
  });
});

describe("Animation Lab: movement buttons", () => {
  it.each([
    ["button-walk", "walk", 1.4],
    ["button-run", "run", 3.5],
    ["button-fast_run", "fast_run", 5.5],
    ["button-sprint", "sprint", 8],
  ] as const)("%s puts the character in the %s state at the right speed", async (id, state, speed) => {
    await click("button-reset-pose");
    await click(id);
    await wait(4);
    const s = await snapshot();
    expect(s.state).toBe(state);
    expect(s.speed).toBeGreaterThan(speed - 0.1);
    expect(s.speed).toBeLessThan(speed + 0.1);
    await expect.poll(() => page.getByTestId("state-badge").textContent(), { timeout: 5000 }).toBe(state.replace("_", " "));
  });

  it("Stop and Idle bring a running character to rest", async () => {
    await click("button-run");
    await wait(3);
    await click("button-stop");
    await wait(0.12);
    expect((await snapshot()).state).toMatch(/stop|decelerate/);
    await wait(3);
    const s = await snapshot();
    expect(s.state).toBe("idle");
    expect(s.speed).toBeLessThan(0.01);
    await click("button-sprint");
    await wait(2);
    await click("button-idle");
    await wait(4);
    expect((await snapshot()).state).toBe("idle");
  });

  it("Jump takes off, flies and lands, and a second press mid-air does nothing", async () => {
    await click("button-reset-pose");
    await wait(0.5);
    await click("button-jump");
    await wait(0.45);
    const flying = await snapshot();
    expect(flying.grounded).toBe(false);
    expect(flying.position.y).toBeGreaterThan(0.2);
    await click("button-jump");
    await wait(2);
    const landed = await snapshot();
    expect(landed.grounded).toBe(true);
    expect(landed.position.y).toBeLessThan(0.1);
    expect(landed.state).toBe("idle");
  });

  it("Turn Left and Turn Right rotate the heading by a quarter turn and the body follows smoothly", async () => {
    await click("button-reset-pose");
    await click("button-turn-left");
    await wait(0.15);
    const partway = await snapshot();
    expect(partway.headingDegrees).toBeCloseTo(90, 0);
    expect(partway.yawDegrees).toBeGreaterThan(0);
    expect(partway.yawDegrees).toBeLessThan(90); // not teleported
    await wait(2);
    expect((await snapshot()).yawDegrees).toBeCloseTo(90, 0);
    await click("button-turn-right");
    await click("button-turn-right");
    await wait(3);
    expect((await snapshot()).yawDegrees).toBeCloseTo(-90, 0);
  });

  it("Bend Forward and Bend Backward move the spine in opposite directions, and Reset Pose restores it", async () => {
    await click("button-reset-pose");
    await wait(0.5);
    await click("button-bend-forward");
    await wait(2.5);
    const forward = await snapshot();
    await click("button-bend-backward");
    await wait(3);
    const backward = await snapshot();
    expect(forward.bones["spine_mid"]?.x).toBeGreaterThan(0.1);
    expect(backward.bones["spine_mid"]?.x).toBeLessThan(-0.05);
    await click("button-reset-pose");
    await wait(3);
    const reset = await snapshot();
    expect(Math.abs(reset.bones["spine_mid"]?.x ?? 1)).toBeLessThan(0.02);
    expect(reset.tuning["spineBend"]).toBe(0);
    expect(reset.state).toBe("idle");
  });
});

describe("Animation Lab: every slider changes real behavior", () => {
  const sliders = [
    ["strideLength", "End", 1.5],
    ["stepFrequency", "End", 1.4],
    ["forwardLean", "End", 2],
    ["spineBend", "End", 90],
    ["armSwing", "End", 2],
    ["kneeLift", "End", 2],
    ["pelvisBounce", "End", 2],
    ["turningSpeed", "End", 540],
    ["blendDuration", "End", 1],
    ["footIK", "Home", 0],
    ["secondaryMotion", "End", 2],
  ] as const;

  it.each(sliders)("%s reaches the simulation when moved", async (key, edge, expected) => {
    await click("button-reset-pose");
    await setSlider(key, edge);
    await wait(0.2);
    const s = await snapshot();
    expect(s.tuning[key]).toBeCloseTo(expected, 5);
    expect(((await page.getByTestId(`value-${key}`).textContent()) ?? "").length).toBeGreaterThan(0);
  });

  it("Movement speed drives the character", async () => {
    await click("button-reset-pose");
    await setSlider("speed", "End");
    await wait(4);
    expect((await snapshot()).speed).toBeGreaterThan(9.5);
    await setSlider("speed", "Home");
    await wait(3);
    expect((await snapshot()).state).toBe("idle");
  });

  it("stride length and step frequency change the gait, not just a number", async () => {
    const measure = async (key: "strideLength" | "stepFrequency" | null) => {
      await click("button-reset-pose");
      if (key) await setSlider(key, "End");
      await click("button-run");
      await wait(3);
      return page.evaluate(() => {
        const sim = Reflect.get(window, "movyntaLab").sim;
        return { stride: sim.gait.strideLength as number, cadence: sim.gait.cadence as number };
      });
    };
    const base = await measure(null);
    const longer = await measure("strideLength");
    const quicker = await measure("stepFrequency");
    expect(longer.stride).toBeGreaterThan(base.stride * 1.3);
    expect(quicker.cadence).toBeGreaterThan(base.cadence * 1.3);
  });
});

describe("Animation Lab: modes, camera and debug", () => {
  it("in-place mode keeps the character on the spot while it runs", async () => {
    await click("button-reset-pose");
    await page.getByTestId("switch-in-place").click();
    await click("button-run");
    await wait(4);
    const s = await snapshot();
    expect(s.state).toBe("run");
    expect(Math.hypot(s.position.x, s.position.z)).toBeLessThan(0.05);
    expect(s.inPlace).toBe(true);
    await page.getByTestId("switch-in-place").click();
    await click("button-idle");
    await wait(2);
  });

  it("switches between perspective and orthographic cameras and the preset views", async () => {
    await click("button-reset-pose");
    await click("button-orthographic");
    await wait(0.3);
    expect((await snapshot()).cameraType).toBe("OrthographicCamera");
    await click("button-perspective");
    await wait(0.3);
    expect((await snapshot()).cameraType).toBe("PerspectiveCamera");

    const direction = async (view: string) => {
      await click(`button-view-${view}`);
      await wait(0.3);
      return page.evaluate(() => {
        const lab = Reflect.get(window, "movyntaLab");
        const offset = lab.scene.activeCamera.position.clone().sub(lab.sim.position);
        return { x: offset.x as number, z: offset.z as number };
      });
    };
    const front = await direction("front");
    const rear = await direction("rear");
    const side = await direction("side");
    expect(front.z).toBeGreaterThan(2);
    expect(rear.z).toBeLessThan(-2);
    expect(Math.abs(side.x)).toBeGreaterThan(2);
    expect(Math.abs(side.z)).toBeLessThan(0.5);
  });

  it("follow camera keeps the character in view while it runs", async () => {
    await click("button-reset-pose");
    await click("button-view-side");
    await click("button-run");
    await wait(5);
    const distance = (await snapshot()).cameraDistance;
    expect(distance).toBeGreaterThan(2);
    expect(distance).toBeLessThan(8);
    const screen = await page.evaluate(() => {
      const lab = Reflect.get(window, "movyntaLab");
      const point = lab.sim.rig.worldPosition.pelvis.clone().project(lab.scene.activeCamera);
      return {
        x: point.x as number,
        y: point.y as number,
      };
    });
    // Normalized screen coordinates: 0 is the center, +-1 the edges.
    expect(Math.abs(screen.x)).toBeLessThan(0.3);
    expect(Math.abs(screen.y)).toBeLessThan(0.3);
    await click("button-idle");
  });

  it("each debug overlay changes what is drawn", async () => {
    await click("button-reset-pose");
    await click("button-idle");
    await wait(1);
    const frame = async () => (await page.getByTestId("lab-viewport").screenshot()).toString("base64");
    const baseline = await frame();
    for (const key of ["skeleton", "ikTargets", "contacts", "collider", "centerOfMass"]) {
      await page.getByTestId(`switch-debug-${key}`).click();
      await wait(0.1);
      expect(await frame(), `${key} overlay`).not.toBe(baseline);
      await page.getByTestId(`switch-debug-${key}`).click();
      await wait(0.1);
    }
    await page.getByTestId("switch-debug-trajectory").click();
    await click("button-run");
    await wait(2);
    const withTrail = await frame();
    await page.getByTestId("switch-debug-trajectory").click();
    await wait(0.1);
    expect(await frame()).not.toBe(withTrail);
    await click("button-idle");
  });

  it("changes the terrain and stands the character on it", async () => {
    await click("button-reset-pose");
    await page.getByTestId("select-terrain").click();
    await page.getByRole("option", { name: "Slope" }).click();
    await wait(0.5);
    await click("button-walk");
    await wait(14);
    expect((await snapshot()).position.y).toBeGreaterThan(1);
    await page.getByTestId("select-terrain").click();
    await page.getByRole("option", { name: "Flat" }).click();
    await wait(0.5);
    expect((await snapshot()).position.y).toBeLessThan(0.1);
  });

  it("pausing freezes the simulation and resuming continues it", async () => {
    await click("button-reset-pose");
    await click("button-run");
    await wait(1);
    await click("button-pause");
    const before = await snapshot();
    await page.waitForTimeout(400);
    const after = await snapshot();
    expect(after.position.z).toBeCloseTo(before.position.z, 5);
    await click("button-pause");
    await click("button-idle");
  });

  it("shows live telemetry that matches the simulation", async () => {
    await click("button-reset-pose");
    await click("button-run");
    await wait(4);
    await expect.poll(async () => Number.parseFloat((await page.getByTestId("speed-actual").textContent()) ?? "0"), { timeout: 5000 }).toBeGreaterThan(3.4);
    await expect.poll(() => page.getByTestId("grounded").textContent(), { timeout: 5000 }).toBe("yes");
    await expect.poll(() => page.getByTestId("transition-log").textContent(), { timeout: 5000 }).toContain("→");
    const planted = await page.locator('[data-testid^="foot-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-contact")));
    expect(planted).toHaveLength(2);
    await click("button-idle");
  });
});

describe("Animation Lab: timeline", () => {
  it("plays, pauses, resumes, stops and scrubs", async () => {
    await click("button-reset-pose");
    await click("timeline-play");
    await wait(0.7);
    const playing = await snapshot();
    expect(playing.timelineState).toBe("playing");
    expect(playing.timelineTime).toBeGreaterThan(0.5);
    await click("timeline-pause");
    const pausedAt = (await snapshot()).timelineTime;
    await wait(1);
    expect((await snapshot()).timelineTime).toBeCloseTo(pausedAt, 5);
    await click("timeline-resume");
    await wait(0.3);
    expect((await snapshot()).timelineTime).toBeGreaterThan(pausedAt + 0.2);
    await click("timeline-stop");
    const stopped = await snapshot();
    expect(stopped.timelineTime).toBe(0);
    expect(stopped.timelineState).toBe("stopped");
    const scrub = page.getByTestId("timeline-scrub").getByRole("slider");
    await scrub.focus();
    for (let i = 0; i < 50; i++) await scrub.press("ArrowRight");
    await wait(0.1);
    expect((await snapshot()).timelineTime).toBeCloseTo(0.5, 1);
  });

  it("loops at the end of the clip and holds at the end when loop is off", async () => {
    await click("timeline-stop");
    await click("timeline-play");
    await wait(2.4);
    expect((await snapshot()).timelineTime).toBeLessThan(0.6); // wrapped around
    await click("timeline-loop"); // loop off
    await click("timeline-stop");
    await click("timeline-play");
    await wait(2.6);
    const ended = await snapshot();
    expect(ended.timelineTime).toBeCloseTo(2, 1);
    expect(ended.timelineState).toBe("paused");
    await click("timeline-loop");
    await click("timeline-stop");
  });

  it("editing a joint writes a key that overrides the procedural pose, and the key can be deleted", async () => {
    await click("button-reset-pose");
    await click("button-walk");
    await wait(2);
    const before = await snapshot();
    await setSlider("joint-x", "End");
    await wait(0.3);
    const keyed = await snapshot();
    expect(keyed.timelineActive).toBe(true);
    // The upper arm now holds the keyed rotation instead of swinging with the walk.
    expect(Math.abs(keyed.bones["upper_arm_l"]?.x ?? 0)).toBeGreaterThan(Math.abs(before.bones["upper_arm_l"]?.x ?? 0));
    await expect.poll(() => page.getByTestId("timeline-keys").textContent(), { timeout: 5000 }).toContain("0.00");
    await click("timeline-delete-key");
    await expect.poll(() => page.getByTestId("timeline-keys").textContent(), { timeout: 5000 }).toContain("No keys");
    await click("button-idle");
  });

  it("exports the clip as JSON and imports it back", async () => {
    await click("button-reset-pose");
    await setSlider("joint-z", "End");
    await click("timeline-export");
    const json = await page.getByTestId("timeline-json").inputValue();
    const clip = JSON.parse(json) as { version: number; tracks: Record<string, unknown[]> };
    expect(clip.version).toBe(1);
    expect(clip.tracks["upper_arm_l"]?.length).toBe(1);
    await click("timeline-delete-key");
    await expect.poll(() => page.getByTestId("timeline-keys").textContent(), { timeout: 5000 }).toContain("No keys");
    await page.getByTestId("timeline-json").fill(json);
    await click("timeline-import");
    await expect.poll(() => page.getByTestId("timeline-keys").textContent(), { timeout: 5000 }).toContain("0.00");
    // Invalid data is rejected without disturbing the clip.
    await page.getByTestId("timeline-json").fill('{"version":2}');
    await click("timeline-import");
    await expect.poll(() => page.getByTestId("timeline-keys").textContent(), { timeout: 5000 }).toContain("0.00");
  });
});

describe("Animation Lab: lifecycle", () => {
  it("leaving the page releases the scene and coming back makes exactly one", async () => {
    await openLab();
    expect((await snapshot()).canvasCount).toBe(1);
    await page.evaluate(() => {
      window.location.hash = "#/";
    });
    await page.waitForFunction(() => Reflect.get(window, "movyntaLab") === undefined);
    expect(await page.locator("canvas").count()).toBe(0);
    await page.evaluate(() => {
      window.location.hash = "#/lab";
    });
    await page.waitForFunction(() => Reflect.get(window, "movyntaLab") !== undefined, null, { timeout: 30_000 });
    const s = await snapshot();
    expect(s.canvasCount).toBe(1);
    // One animation loop: the controller is running and ticking at a normal pace.
    const loops = await page.evaluate(() => Reflect.get(window, "movyntaLab").running as boolean);
    expect(loops).toBe(true);
  });

  it("finishes the run without errors or warnings in the console", () => {
    expect(problems).toEqual([]);
  });
});
