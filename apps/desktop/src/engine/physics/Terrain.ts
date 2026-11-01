/** A static box in the test world. `pitch` rotates it about the X axis (positive pitch raises the -Z edge). */
export interface TerrainPiece {
  readonly id: string;
  readonly kind: "ground" | "slope" | "platform" | "step" | "obstacle";
  readonly center: readonly [number, number, number];
  readonly halfExtents: readonly [number, number, number];
  readonly pitch: number;
}

export const TERRAIN_PRESETS = ["flat", "slope", "platform", "step", "course"] as const;
export type TerrainPreset = (typeof TERRAIN_PRESETS)[number];

export function isTerrainPreset(value: string): value is TerrainPreset {
  return TERRAIN_PRESETS.some((preset) => preset === value);
}

export const SLOPE_ANGLE_DEG = 6;
export const STEP_HEIGHT = 0.12;
export const PLATFORM_HEIGHT = 0.4;

/**
 * Rapier's character controller loses precision on very large static boxes (the capsule slowly sinks above
 * roughly 250 m), so the ground is a moderate slab that follows the character instead of one huge plane.
 */
export const GROUND_HALF_EXTENT = 200;
/** The ground slab is re-centered when the character gets this far from its center. */
export const GROUND_RECENTER_DISTANCE = 60;
export const GROUND_RECENTER_GRID = 50;

const GROUND: TerrainPiece = {
  id: "ground",
  kind: "ground",
  center: [0, -0.5, 0],
  halfExtents: [GROUND_HALF_EXTENT, 0.5, GROUND_HALF_EXTENT],
  pitch: 0,
};

/**
 * Builds the slope as a tilted slab whose top face starts at y = 0 at `startZ` and rises along +Z,
 * then adds a flat landing at the top so the character can stand on it.
 */
function slopePieces(centerX: number, startZ: number, length: number): TerrainPiece[] {
  const angle = (SLOPE_ANGLE_DEG * Math.PI) / 180;
  const half = length / 2;
  const rise = Math.sin(angle) * length;
  const thickness = 0.5;
  // Slab center sits half a thickness below the top face along the slab normal.
  const cz = startZ + Math.cos(angle) * half + Math.sin(angle) * thickness;
  const cy = Math.sin(angle) * half - Math.cos(angle) * thickness;
  return [
    {
      id: "slope",
      kind: "slope",
      center: [centerX, cy, cz],
      halfExtents: [4, thickness, half],
      pitch: -angle,
    },
    {
      id: "slope-landing",
      kind: "platform",
      center: [centerX, rise / 2, startZ + Math.cos(angle) * length + 4],
      halfExtents: [4, rise / 2, 4],
      pitch: 0,
    },
  ];
}

function stepPiece(cx: number, cz: number, along: "x" | "z"): TerrainPiece {
  return {
    id: "step",
    kind: "step",
    center: [cx, STEP_HEIGHT / 2, cz],
    halfExtents: along === "z" ? [6, STEP_HEIGHT / 2, 8] : [8, STEP_HEIGHT / 2, 6],
    pitch: 0,
  };
}

function platformPiece(cx: number, cz: number): TerrainPiece {
  return {
    id: "platform",
    kind: "platform",
    center: [cx, PLATFORM_HEIGHT / 2, cz],
    halfExtents: [3, PLATFORM_HEIGHT / 2, 3],
    pitch: 0,
  };
}

const WALL: TerrainPiece = {
  id: "obstacle-wall",
  kind: "obstacle",
  center: [0, 0.75, -12],
  halfExtents: [4, 0.75, 0.25],
  pitch: 0,
};

/**
 * Test worlds. Slope, platform and step lie along +Z from z = 6 so one straight walk crosses them;
 * the course spreads them around the origin (slope +Z, step +X, platform -X, wall -Z).
 */
export function buildTerrain(preset: TerrainPreset): TerrainPiece[] {
  switch (preset) {
    case "flat":
      return [GROUND];
    case "slope":
      return [GROUND, ...slopePieces(0, 6, 12)];
    case "platform":
      return [GROUND, platformPiece(0, 9)];
    case "step":
      return [GROUND, { ...stepPiece(0, 14, "z"), center: [0, STEP_HEIGHT / 2, 14] }];
    case "course":
      return [
        GROUND,
        ...slopePieces(0, 6, 12),
        { ...stepPiece(14, 0, "x") },
        platformPiece(-9, 0),
        WALL,
      ];
    default:
      return [GROUND];
  }
}
