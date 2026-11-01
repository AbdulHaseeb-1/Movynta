import {
  BoxGeometry,
  GridHelper,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Material,
} from "three";
import type { TerrainPiece } from "@/engine/physics/Terrain";
import { themeColor } from "./labTheme";

const GROUND_SIZE = 240;
/** The visible ground and grid recenter under the character in these increments (meters). */
const GROUND_SNAP = 10;
const GRID_SNAP = 1;

/** Draws the test world: an endless-looking floor with a grid, and every terrain piece. */
export class TerrainView {
  readonly root = new Group();
  private readonly ground: Mesh;
  private readonly grid: GridHelper;
  private pieces: Mesh[] = [];
  private readonly materials: Material[] = [];
  private readonly geometries: { dispose(): void }[] = [];

  constructor() {
    const groundGeometry = new PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
    groundGeometry.rotateX(-Math.PI / 2);
    const groundMaterial = new MeshStandardMaterial({ color: themeColor("muted"), roughness: 0.95, metalness: 0 });
    this.ground = new Mesh(groundGeometry, groundMaterial);
    this.ground.receiveShadow = true;
    this.ground.position.y = -0.002;

    // The center lines get the same color as the rest: a brighter axis line would read as a stray line at foot level.
    this.grid = new GridHelper(GROUND_SIZE, GROUND_SIZE, themeColor("accent"), themeColor("accent"));
    this.grid.position.y = 0.001;
    const gridMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 });
    this.grid.material = gridMaterial;
    this.materials.push(gridMaterial);
    this.geometries.push(groundGeometry);
    this.materials.push(groundMaterial);
    this.root.add(this.ground, this.grid);
  }

  /** Rebuilds the solid pieces (slope, platform, step, wall) from the physics world's definition. */
  setPieces(pieces: readonly TerrainPiece[]): void {
    for (const mesh of this.pieces) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.pieces = [];
    const material = new MeshStandardMaterial({ color: themeColor("accent"), roughness: 0.8, metalness: 0.02 });
    const edge = new MeshStandardMaterial({ color: themeColor("muted-foreground"), roughness: 0.8 });
    this.materials.push(material, edge);
    for (const piece of pieces) {
      if (piece.kind === "ground") continue;
      const geometry = new BoxGeometry(piece.halfExtents[0] * 2, piece.halfExtents[1] * 2, piece.halfExtents[2] * 2);
      const mesh = new Mesh(geometry, piece.kind === "obstacle" ? edge : material);
      mesh.position.set(...piece.center);
      mesh.rotation.x = piece.pitch;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.pieces.push(mesh);
    }
  }

  /** Keeps the floor and grid under the character so the world seems to have no edge. */
  follow(x: number, z: number): void {
    this.ground.position.x = Math.round(x / GROUND_SNAP) * GROUND_SNAP;
    this.ground.position.z = Math.round(z / GROUND_SNAP) * GROUND_SNAP;
    this.grid.position.x = Math.round(x / GRID_SNAP) * GRID_SNAP;
    this.grid.position.z = Math.round(z / GRID_SNAP) * GRID_SNAP;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const mesh of this.pieces) mesh.geometry.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.grid.geometry.dispose();
  }
}
