import { z } from "zod";
import { meshPathSchema } from "./mesh-path.js";
const common = { id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), enabled: z.boolean().default(true) };
export const bevelProfileSchema = z.enum(["chamfer", "round", "circular"]);
export const subdivisionMethodSchema = z.enum(["catmull-clark", "linear", "loop"]);
export const booleanOperationSchema = z.enum(["difference", "union", "intersect"]);
export const booleanOperandFields = {
  operation: booleanOperationSchema.default("difference"),
  operandObjectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  operandMeshPath: meshPathSchema.default([]),
  cutMaterialIndex: z.number().int().nonnegative().max(65535).optional(),
};
const capScale = z.number().min(0.01).max(100);
const angle = z.number().min(-180).max(180);
export const extrusionShapeFields = {
  capScale: capScale.optional(),
  capScaleXY: z.array(capScale).length(2).optional(),
  capRotationDegrees: z.array(angle).length(3).optional(),
  twistDegrees: angle.optional(),
  closeOpenSurface: z.boolean().optional(),
  normalMode: z.enum(["region", "individual", "vertex"]).optional(),
};

export function validExtrusionShape(input: {
  kind?: string | undefined;
  normalDistance?: number | undefined;
  capScale?: number | undefined;
  capScaleXY?: number[] | undefined;
  capRotationDegrees?: number[] | undefined;
  twistDegrees?: number | undefined;
  normalMode?: string | undefined;
  closeOpenSurface?: boolean | undefined;
}): boolean {
  const face = input.kind === undefined || input.kind === "face";
  if (!face && (input.capScale !== undefined || input.capScaleXY !== undefined ||
    input.capRotationDegrees !== undefined || input.twistDegrees !== undefined)) return false;
  if (input.capScale !== undefined && input.capScaleXY !== undefined) return false;
  if (input.normalMode !== undefined && input.normalDistance === undefined) return false;
  return !input.closeOpenSurface || (input.normalDistance !== undefined && (input.normalMode === undefined || input.normalMode === "region"));
}
export const modifierSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("array"), count: z.number().int().min(1).max(64),
    offset: z.array(z.number().finite().min(-10000).max(10000)).length(3),
  }).strict().refine((entry) => entry.count === 1 || entry.offset.some((value) => Math.abs(value) > 1e-9), "Repeated copies need a nonzero offset"),
  z.object({ ...common, kind: z.literal("mirror"), axis: z.enum(["x", "y", "z"]),
    origin: z.number().finite().min(-10000).max(10000).default(0), bisect: z.boolean().default(true),
    keepSide: z.enum(["positive", "negative"]).default("positive"),
    mergeDistance: z.number().finite().min(0).max(1).default(0.000001),
  }).strict(),
  z.object({
    ...common,
    kind: z.literal("bevel"),
    width: z.number().finite().positive().max(100),
    segments: z.number().int().min(1).max(8).default(1),
    /** Flat chamfer, quadratic round, or a circular arc profile. Omitted means round. */
    profile: bevelProfileSchema.optional(),
    /** Minimum angle between face normals, in degrees. Omitted or 0 bevels every crease. */
    angle: z.number().finite().min(0).max(180).optional(),
  }).strict(),
  z.object({
    ...common,
    kind: z.literal("subdivision"),
    levels: z.number().int().min(1).max(3),
    /** Omitted means Catmull–Clark. */
    method: subdivisionMethodSchema.optional(),
  }).strict(),
  z.object({
    ...common,
    kind: z.literal("extrusion"),
    baseKey: z.string().regex(/^[0-9a-f]{16}$/),
    componentKind: z.enum(["face", "edge", "vertex"]).optional(),
    ids: z.array(z.string().regex(/^\d{1,10}(_\d{1,10})?$/)).min(1).max(4096),
    normalDistance: z.number().min(-100).max(100).refine((value) => Math.abs(value) > 1e-6).optional(),
    offset: z.array(z.number().finite()).length(3).optional(),
    ...extrusionShapeFields,
  }).strict()
    .refine((entry) => (entry.offset === undefined) !== (entry.normalDistance === undefined),
      "Provide exactly one extrusion distance or offset")
    .refine((entry) => entry.normalDistance === undefined || entry.componentKind === undefined || entry.componentKind === "face",
      "Normal extrusion requires faces")
    .refine((entry) => validExtrusionShape({ ...entry, kind: entry.componentKind }),
      "Invalid extrusion shaping or closing options"),
  z.object({
    ...common,
    kind: z.literal("boolean"),
    ...booleanOperandFields,
  }).strict(),
]);
export const modifierListSchema = z.array(modifierSchema).max(8)
  .refine((entries) => new Set(entries.map((entry) => entry.id)).size === entries.length, "Modifier ids must be unique")
  .refine((entries) => entries.every((entry, index) => entry.kind !== "extrusion" || index === 0),
    "A single live extrusion must be the first modifier because it targets base components");
export type MeshModifierSpec = z.infer<typeof modifierSchema>;
