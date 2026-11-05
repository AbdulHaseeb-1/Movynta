import { MathUtils, Vector3, type Camera } from "three";
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

/**
 * Which way a rotation about `axis` must turn for a pointer circling the pivot on screen to look right. A positive
 * angle turns counter-clockwise when the axis points at the viewer and clockwise when it points away, so an axis
 * facing away needs the opposite sign or the object would turn against the pointer.
 */
export function rotationSign(axis: Vector3, camera: Camera): 1 | -1 {
  const towardViewer = camera.getWorldDirection(new Vector3()).negate();
  return axis.dot(towardViewer) < 0 ? -1 : 1;
}

/**
 * What typing in a number field should save, or undefined to leave the value alone. Text equal to the rounded value
 * on display was not edited, so the stored value (which may have more decimals) is kept; an Escape or text that is
 * not a number changes nothing; and a `min` keeps the result in range.
 */
export function fieldCommitValue(draft: string, value: number, options: { min?: number | undefined; cancelled?: boolean | undefined } = {}): number | undefined {
  if (options.cancelled || draft === formatNumber(value)) return undefined;
  const parsed = parseNumber(draft);
  if (parsed === undefined) return undefined;
  const bounded = options.min === undefined ? parsed : Math.max(options.min, parsed);
  return bounded === value ? undefined : bounded;
}
