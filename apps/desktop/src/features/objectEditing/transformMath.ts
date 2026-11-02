import { MathUtils } from "three";
import type { ObjectTransform, Vec3 } from "@/features/assistant";

/** While Shift is held, handles snap to these steps. */
export const TRANSLATION_SNAP = 0.25;
export const ROTATION_SNAP_DEGREES = 15;
export const SCALE_SNAP = 0.1;

const EPSILON = 1e-6;

export type TransformField = keyof ObjectTransform;
export const TRANSFORM_FIELDS: readonly TransformField[] = [
  "position",
  "rotation",
  "scale",
];

function mapVector(vector: Vec3, convert: (value: number) => number): Vec3 {
  return [convert(vector[0]), convert(vector[1]), convert(vector[2])];
}

export function radiansToDegrees(rotation: Vec3): Vec3 {
  return mapVector(rotation, MathUtils.radToDeg);
}

export function degreesToRadians(rotation: Vec3): Vec3 {
  return mapVector(rotation, MathUtils.degToRad);
}

export type Axis = 0 | 1 | 2;
/** The three axes with the index each one has in a vector. */
export const AXES = [
  { label: "X", index: 0 },
  { label: "Y", index: 1 },
  { label: "Z", index: 2 },
] as const;

function sameVector(a: Vec3, b: Vec3): boolean {
  return a.every((value, index) => Math.abs(value - (b[index] ?? NaN)) < EPSILON);
}

export function sameTransform(a: ObjectTransform, b: ObjectTransform): boolean {
  return (
    sameVector(a.position, b.position) &&
    sameVector(a.rotation, b.rotation) &&
    sameVector(a.scale, b.scale)
  );
}

/** A copy of `vector` with one axis changed. */
export function withAxis(vector: Vec3, axis: Axis, value: number): Vec3 {
  const next: Vec3 = [...vector];
  next[axis] = value;
  return next;
}

/** A number as it reads in a field: at most three decimals, no trailing zeros, no "-0". */
export function formatNumber(value: number): string {
  const rounded = Number(value.toFixed(3));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Reads what the user typed. Returns undefined for anything that is not a plain finite number, so a
 * half-typed or mistyped value is dropped instead of moving an object somewhere unexpected.
 */
export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim().replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}
