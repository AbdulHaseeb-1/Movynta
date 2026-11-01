import { Vector3 } from "three";
import { CharacterSimulation } from "@/engine/CharacterSimulation";
import { STICKMAN_CHARACTER_CONFIG } from "@/engine/character/SkeletonBuilder";
import { EngineLoop } from "@/engine/core/EngineLoop";
import type { BoneName } from "@/engine/character/types";
import { CharacterView } from "./CharacterView";
import { DebugOverlay } from "./DebugOverlay";
import { TURN_STEP_RADIANS, type LabSettings } from "./labSettings";
import { LabScene } from "./LabScene";
import type { Telemetry } from "./telemetry";
import { TerrainView } from "./TerrainView";
import { TimelineApi } from "./TimelineApi";

const DEG = Math.PI / 180;
const FPS_WINDOW = 30;

/**
 * Owns the simulation, the three.js scene and the single animation loop. React talks to it through
 * `apply(settings)` and a few commands; per-frame work never goes through React.
 */
export class LabController {
  readonly sim: CharacterSimulation;
  readonly scene: LabScene;
  readonly timeline: TimelineApi;
  private readonly character: CharacterView;
  private readonly terrain: TerrainView;
  private readonly debug: DebugOverlay;
  private readonly loop: EngineLoop;
  private settings: LabSettings;
  private appliedTerrain: LabSettings["terrain"];
  private appliedView: LabSettings["view"] | null = null;
  private paused = false;
  private disposed = false;
  private readonly frameTimes: number[] = [];
  private readonly scratch = new Vector3();
  private alpha = 0;
  private lockedYaw = 0;
  /** True while a capture tool drives time itself instead of the browser's frame clock. */
  manualClock = false;

  private constructor(sim: CharacterSimulation, container: HTMLElement, settings: LabSettings) {
    this.sim = sim;
    this.timeline = new TimelineApi(sim);
    this.settings = settings;
    this.appliedTerrain = settings.terrain;
    this.scene = new LabScene(container);
    this.character = new CharacterView(sim);
    this.terrain = new TerrainView();
    this.debug = new DebugOverlay(sim);
    this.scene.scene.add(this.terrain.root, this.character.root, this.debug.root);
    this.terrain.setPieces(sim.physics.terrainPieces);
    this.loop = new EngineLoop((dt) => this.frame(dt));
    this.apply(settings);
    this.character.update(1);
    this.scene.setView(settings.view, sim.position, sim.controller.yaw);
    this.appliedView = settings.view;
    this.render();
  }

  static async create(container: HTMLElement, settings: LabSettings): Promise<LabController> {
    const sim = await CharacterSimulation.create({ terrain: settings.terrain, tuning: settings.tuning, config: STICKMAN_CHARACTER_CONFIG });
    return new LabController(sim, container, settings);
  }

  start(): void {
    if (!this.manualClock) this.loop.start();
  }

  /** Pushes React-side settings into the simulation, camera and overlays. Cheap; call on every change. */
  apply(settings: LabSettings): void {
    const previous = this.settings;
    this.settings = settings;
    Object.assign(this.sim.tuning, settings.tuning);
    this.paused = settings.paused;
    this.sim.inPlace = settings.inPlace;

    if (settings.terrain !== this.appliedTerrain) {
      this.appliedTerrain = settings.terrain;
      this.sim.setTerrain(settings.terrain);
      this.terrain.setPieces(this.sim.physics.terrainPieces);
      this.debug.clearTrail();
      this.scene.setView(settings.view === "free" ? "three-quarter" : settings.view, this.sim.position, this.sim.controller.yaw);
    }

    // A locked facing holds the heading from the moment it was turned on; the direction is relative to it.
    if (settings.lockedFacing && !previous.lockedFacing) this.lockedYaw = this.sim.controller.yaw;
    if (settings.lockedFacing) {
      this.sim.setFacing("locked", this.lockedYaw);
      this.sim.setHeading(this.lockedYaw + settings.strafeDirection * DEG);
    } else if (previous.lockedFacing) {
      this.sim.setFacing("movement");
      this.sim.setHeading(this.sim.controller.yaw);
    }
    this.sim.setSpeed(settings.speed);

    this.scene.setProjection(settings.projection);
    this.scene.setFollow(settings.followCamera);
    if (settings.view !== this.appliedView) {
      this.appliedView = settings.view;
      this.scene.setView(settings.view, this.sim.position, this.sim.controller.yaw);
    }
    this.debug.setVisible(settings.debug);
  }

  jump(): boolean {
    return this.sim.jumpNow();
  }

  /** Turns the intended direction of travel by a quarter turn. Positive turns toward the character's left. */
  turn(direction: 1 | -1): void {
    if (this.settings.lockedFacing) return;
    this.sim.setHeading(this.sim.command.heading + direction * TURN_STEP_RADIANS);
  }

  /** Returns the character to the origin, standing, and clears the debug trail. */
  reset(): void {
    this.sim.reset();
    this.debug.clearTrail();
    this.scene.setView(this.settings.view === "free" ? "three-quarter" : this.settings.view, this.sim.position, this.sim.controller.yaw);
    this.character.update(1);
  }

  private frame(deltaSeconds: number): void {
    if (this.disposed) return;
    this.trackFps(deltaSeconds);
    if (!this.paused) this.alpha = this.sim.advance(deltaSeconds);
    this.updateViews(deltaSeconds);
    this.render();
  }

  /**
   * Advances simulated time by exactly `seconds` and draws one frame. Used by capture tools, which need frames at
   * exact intervals regardless of how fast the machine can render.
   */
  advance(seconds: number): void {
    this.manualClock = true;
    this.loop.stop();
    this.trackFps(seconds);
    this.alpha = this.sim.advance(seconds);
    this.updateViews(seconds);
    this.render();
  }

  /**
   * Advances simulated time by `seconds` in 1/60 s slices and draws only the last frame. For tests and tools that
   * want to reach a moment quickly rather than record every frame on the way.
   */
  fastForward(seconds: number): void {
    this.manualClock = true;
    this.loop.stop();
    const slices = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < slices; i++) this.alpha = this.sim.advance(1 / 60);
    this.trackFps(1 / 60);
    this.updateViews(seconds);
    this.render();
  }

  private updateViews(dt: number): void {
    this.character.update(this.paused ? 1 : this.alpha);
    this.terrain.follow(this.sim.position.x, this.sim.position.z);
    this.debug.update(dt);
    this.scene.update(this.sim.position);
  }

  private render(): void {
    this.scene.render();
  }

  private trackFps(dt: number): void {
    if (dt <= 0) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > FPS_WINDOW) this.frameTimes.shift();
  }

  get fps(): number {
    if (this.frameTimes.length === 0) return 0;
    const total = this.frameTimes.reduce((a, b) => a + b, 0);
    return this.frameTimes.length / total;
  }

  /** Whether the animation loop is currently running (false when paused by a capture tool or after dispose). */
  get running(): boolean {
    return this.loop.running;
  }

  telemetry(): Telemetry {
    const sim = this.sim;
    const feet = (side: "l" | "r") => {
      const foot = sim.gait.feet[side];
      return { mode: foot.mode, contact: foot.contact, progress: foot.mode === "stance" ? foot.stanceProgress : foot.swingProgress };
    };
    return {
      state: sim.machine.current,
      previousState: sim.machine.previous,
      timeInState: sim.machine.timeInState,
      transitions: [...sim.machine.history],
      fps: this.fps,
      steps: sim.stepCount,
      simulationTime: sim.stepCount * sim.dt,
      speed: sim.controller.horizontalSpeed,
      desiredSpeed: Math.hypot(sim.command.desiredVelocity.x, sim.command.desiredVelocity.z),
      heading: sim.command.heading,
      yaw: sim.controller.yaw,
      grounded: sim.controller.grounded,
      verticalVelocity: sim.controller.velocity.y,
      jumpPhase: sim.jump.phase,
      gaitMode: sim.gait.mode,
      gaitPhase: sim.gait.phase,
      strideLength: sim.gait.strideLength,
      cadence: sim.gait.cadence,
      duty: sim.gait.duty,
      lean: sim.generator.report.lean,
      pelvisHeight: sim.rig.worldPosition.pelvis.y,
      feet: { l: feet("l"), r: feet("r") },
      position: { x: sim.position.x, y: sim.position.y, z: sim.position.z },
      limitCorrections: sim.limitCorrections,
      timeline: {
        active: sim.timelineActive,
        state: sim.timeline.state,
        time: sim.timeline.time,
        duration: sim.timeline.duration,
        loop: sim.timeline.loop,
        speed: sim.timeline.speed,
      },
    };
  }

  /** World position of a bone, for the rig panel. */
  bonePosition(bone: BoneName): Vector3 {
    return this.scratch.copy(this.sim.rig.worldPosition[bone]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.debug.dispose();
    this.character.dispose();
    this.terrain.dispose();
    this.scene.dispose();
    this.sim.dispose();
  }
}
