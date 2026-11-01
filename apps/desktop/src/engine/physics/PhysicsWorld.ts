import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { createGroundHit, type GroundHit, type GroundProvider } from "./GroundDetection";
import { buildTerrain, GROUND_RECENTER_DISTANCE, GROUND_RECENTER_GRID, type TerrainPiece, type TerrainPreset } from "./Terrain";

export interface CapsuleSpec {
  readonly radius: number;
  /** Half the length of the straight part of the capsule. */
  readonly halfHeight: number;
}

export const DEFAULT_CAPSULE: CapsuleSpec = { radius: 0.25, halfHeight: 0.6 };
export const GRAVITY = 9.81;

/** Distance the controller keeps from surfaces. */
const CONTROLLER_SKIN = 0.02;
const MAX_STEP_HEIGHT = 0.22;
const MIN_STEP_WIDTH = 0.12;
const SNAP_DISTANCE = 0.22;
const MAX_CLIMB_SLOPE = (45 * Math.PI) / 180;
const MIN_SLIDE_SLOPE = (50 * Math.PI) / 180;
/** Rays start this far above the query height so a foot standing on a ledge still finds it. */
const RAY_LIFT = 0.45;
const RAY_RANGE = 4;

let rapierReady: Promise<void> | null = null;

function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export interface MoveResult {
  /** Corrected translation to apply this step. */
  readonly translation: Vector3;
  readonly grounded: boolean;
}

/** The character's collision capsule and kinematic controller inside a `PhysicsWorld`. */
export class PhysicsCharacter {
  readonly spec: CapsuleSpec;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly world: RAPIER.World;
  private readonly ground: GroundProvider;
  private readonly position = new Vector3();
  private readonly groundHit = createGroundHit();

  constructor(world: RAPIER.World, spec: CapsuleSpec, ground: GroundProvider) {
    this.world = world;
    this.ground = ground;
    this.spec = spec;
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(spec.halfHeight, spec.radius));
    this.controller = world.createCharacterController(CONTROLLER_SKIN);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(MAX_STEP_HEIGHT, MIN_STEP_WIDTH, false);
    // Rapier's built-in snap-to-ground drops horizontal movement on some steps and lets the capsule sink, so the
    // controller never snaps; `move` settles the capsule onto the ground itself.
    this.controller.disableSnapToGround();
    this.controller.setMaxSlopeClimbAngle(MAX_CLIMB_SLOPE);
    this.controller.setMinSlopeSlideAngle(MIN_SLIDE_SLOPE);
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  /** Vertical offset from the feet (root point) to the capsule center. */
  get centerHeight(): number {
    return this.spec.halfHeight + this.spec.radius;
  }

  /** Root position: the point on the ground below the capsule center. */
  getPosition(out: Vector3): Vector3 {
    return out.copy(this.position);
  }

  setPosition(root: Vector3): void {
    this.position.copy(root);
    this.collider.setTranslation({ x: root.x, y: root.y + this.centerHeight, z: root.z });
  }

  /**
   * Moves the capsule by `desired`, sliding along obstacles and stepping over small ledges. When `snap` is
   * true and the capsule ends the move just above the ground (walking down a slope or off a small ledge),
   * it settles onto the surface and counts as grounded.
   */
  move(desired: Vector3, snap: boolean, out: MoveResult["translation"]): MoveResult {
    this.controller.computeColliderMovement(this.collider, { x: desired.x, y: desired.y, z: desired.z });
    const m = this.controller.computedMovement();
    out.set(m.x, m.y, m.z);
    let grounded = this.controller.computedGrounded();
    if (snap && !grounded) grounded = this.settleOntoGround(out);
    this.position.add(out);
    this.collider.setTranslation({ x: this.position.x, y: this.position.y + this.centerHeight, z: this.position.z });
    return { translation: out, grounded };
  }

  /**
   * Removes a hover left after a landing: the controller stops a falling capsule a few centimeters above the
   * surface when it arrives fast. Only called at the moment of landing, never while stepping over ledges.
   */
  settle(): void {
    const hit = this.ground.sample(this.position.x, this.position.z, this.position.y + 0.05, this.groundHit);
    if (!hit.found) return;
    const gap = this.position.y - hit.height - CONTROLLER_SKIN;
    if (gap <= 0.004 || gap > 0.15) return;
    this.position.y -= gap;
    this.collider.setTranslation({ x: this.position.x, y: this.position.y + this.centerHeight, z: this.position.z });
  }

  /** Lowers `translation` so the capsule rests on ground at most `SNAP_DISTANCE` below it. */
  private settleOntoGround(translation: Vector3): boolean {
    const x = this.position.x + translation.x;
    const z = this.position.z + translation.z;
    const y = this.position.y + translation.y;
    const hit = this.ground.sample(x, z, y + 0.05, this.groundHit);
    if (!hit.found) return false;
    const gap = y - hit.height - CONTROLLER_SKIN;
    if (gap < -0.02 || gap > SNAP_DISTANCE) return false;
    translation.y -= gap;
    return true;
  }

  /** Exposed so debug views can draw the capsule. */
  get colliderHandle(): number {
    return this.collider.handle;
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.removeCollider(this.collider, false);
  }
}

/**
 * Owns the Rapier world: terrain, the character capsule, and ground queries.
 * Create with `PhysicsWorld.create`, which waits for the WebAssembly module.
 */
export class PhysicsWorld implements GroundProvider {
  private readonly world: RAPIER.World;
  private terrainColliders: RAPIER.Collider[] = [];
  private groundCollider: RAPIER.Collider | null = null;
  private groundCenterX = 0;
  private groundCenterZ = 0;
  private character: PhysicsCharacter | null = null;
  private pieces: TerrainPiece[] = [];
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  private constructor(fixedDt: number) {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = fixedDt;
  }

  static async create(fixedDt: number, preset: TerrainPreset = "course"): Promise<PhysicsWorld> {
    await initRapier();
    const physics = new PhysicsWorld(fixedDt);
    physics.setTerrain(buildTerrain(preset));
    return physics;
  }

  get terrainPieces(): readonly TerrainPiece[] {
    return this.pieces;
  }

  setTerrain(pieces: readonly TerrainPiece[]): void {
    for (const collider of this.terrainColliders) this.world.removeCollider(collider, false);
    this.groundCollider = null;
    this.groundCenterX = 0;
    this.groundCenterZ = 0;
    this.terrainColliders = pieces.map((piece) => {
      const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), piece.pitch);
      const desc = RAPIER.ColliderDesc.cuboid(...piece.halfExtents)
        .setTranslation(...piece.center)
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
        .setFriction(1);
      const collider = this.world.createCollider(desc);
      if (piece.id === "ground") this.groundCollider = collider;
      return collider;
    });
    this.pieces = [...pieces];
    // Scene queries (rays, character movement) read a spatial index that only a step refreshes.
    this.world.step();
  }

  /** Keeps the ground slab under the character so the world never ends. Cheap enough to call every step. */
  followGround(x: number, z: number): void {
    const collider = this.groundCollider;
    if (!collider) return;
    if (Math.abs(x - this.groundCenterX) < GROUND_RECENTER_DISTANCE && Math.abs(z - this.groundCenterZ) < GROUND_RECENTER_DISTANCE) return;
    this.groundCenterX = Math.round(x / GROUND_RECENTER_GRID) * GROUND_RECENTER_GRID;
    this.groundCenterZ = Math.round(z / GROUND_RECENTER_GRID) * GROUND_RECENTER_GRID;
    collider.setTranslation({ x: this.groundCenterX, y: -0.5, z: this.groundCenterZ });
    this.world.step();
  }

  /** Current center of the ground slab (for drawing). */
  get groundCenter(): { x: number; z: number } {
    return { x: this.groundCenterX, z: this.groundCenterZ };
  }

  createCharacter(spec: CapsuleSpec = DEFAULT_CAPSULE): PhysicsCharacter {
    this.character?.dispose();
    this.character = new PhysicsCharacter(this.world, spec, this);
    return this.character;
  }

  sample(x: number, z: number, aboveY: number, out: GroundHit): GroundHit {
    this.ray.origin.x = x;
    this.ray.origin.y = aboveY + RAY_LIFT;
    this.ray.origin.z = z;
    // Passing the character's own collider as excluded keeps rays from hitting the capsule.
    const excluded = this.character?.colliderHandle;
    const hit =
      excluded === undefined
        ? this.world.castRayAndGetNormal(this.ray, RAY_RANGE, true)
        : this.world.castRayAndGetNormal(this.ray, RAY_RANGE, true, undefined, undefined, undefined, undefined, (c) => c.handle !== excluded);
    if (!hit) {
      out.found = false;
      out.height = 0;
      out.normal.set(0, 1, 0);
      return out;
    }
    out.found = true;
    out.height = aboveY + RAY_LIFT - hit.timeOfImpact;
    out.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    if (out.normal.y < 0) out.normal.negate();
    return out;
  }

  dispose(): void {
    this.world.free();
  }
}
