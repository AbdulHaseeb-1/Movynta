import { z } from "zod";
import { identifierSchema } from "./editor-command.schema.js";
import { meshPathSchema } from "./mesh-path.js";

const point = z.array(z.number().finite().min(-1e12).max(1e12)).length(3);
const matrix = z.array(z.number().finite()).length(16);
const bounds = z.object({ min: point, max: point }).strict();
export const lengthUnits = ["mm", "cm", "m", "in", "ft"] as const;
export const metersPerUnit = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 } as const;
export const measurementUnitsSchema = z
  .object({
    display: z.enum(lengthUnits),
    metersPerSceneUnit: z.number().finite().min(1e-9).max(1e9),
  })
  .strict()
  .nullable();
export type MeasurementUnits = z.infer<typeof measurementUnitsSchema>;

export const measurementAnnotationSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(80),
    points: z.array(point).min(2).max(3),
  })
  .strict();
export type MeasurementAnnotation = z.infer<typeof measurementAnnotationSchema>;
export const projectMeasurementsSchema = z
  .object({
    units: measurementUnitsSchema,
    annotations: z
      .array(measurementAnnotationSchema)
      .max(50)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
  })
  .strict();
export type ProjectMeasurements = z.infer<typeof projectMeasurementsSchema>;
export const defaultMeasurements: ProjectMeasurements = { units: null, annotations: [] };
export const savedMeasurementsSchema = z
  .object({ version: z.number().int().nonnegative(), value: projectMeasurementsSchema })
  .strict();
export const saveMeasurementsSchema = z
  .object({ expectedVersion: z.number().int().nonnegative(), value: projectMeasurementsSchema })
  .strict();

const target = z
  .object({
    objectId: identifierSchema,
    meshPath: meshPathSchema.optional(),
    descendants: z.boolean().optional(),
  })
  .strict();
const vertex = z
  .object({
    objectId: identifierSchema,
    meshPath: meshPathSchema.optional(),
    vertex: z.number().int().nonnegative().max(100_000),
    view: z.enum(["base", "evaluated"]).optional(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const endpoint = z.union([point, vertex]);
export const measurementRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dimensions"), target, space: z.enum(["world", "local"]).optional() }).strict(),
  z.object({ kind: z.literal("distance"), from: endpoint, to: endpoint }).strict(),
  z
    .object({
      kind: z.literal("edge"),
      objectId: identifierSchema,
      meshPath: meshPathSchema.optional(),
      view: z.enum(["base", "evaluated"]).optional(),
      revision: z.number().int().nonnegative(),
      edge: z.string().regex(/^\d{1,6}_\d{1,6}$/),
    })
    .strict(),
  z.object({ kind: z.literal("angle"), from: endpoint, at: endpoint, to: endpoint }).strict(),
  z
    .object({
      kind: z.literal("clearance"),
      first: target,
      second: target,
      method: z.enum(["bounds", "surface"]).optional(),
    })
    .strict(),
]);
export type MeasurementRequest = z.infer<typeof measurementRequestSchema>;
export const measurementResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), message: z.string().max(500) }).strict(),
  z
    .object({
      status: z.literal("ok"),
      data: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("dimensions"),
            space: z.enum(["world", "local"]),
            bounds,
            size: point,
            center: point,
            parentWorldInverse: matrix.nullable(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("distance"),
            from: point,
            to: point,
            delta: point,
            length: z.number().finite().nonnegative(),
          })
          .strict(),
        z.object({ kind: z.literal("angle"), degrees: z.number().finite().min(0).max(180) }).strict(),
        z
          .object({
            kind: z.literal("clearance"),
            method: z.enum(["bounds", "surface"]),
            distance: z.number().finite().nonnegative(),
            firstBounds: bounds,
            secondBounds: bounds,
            axisGap: point,
            secondParentWorldInverse: matrix.nullable(),
          })
          .strict(),
      ]),
    })
    .strict(),
]);
export type MeasurementResult = z.infer<typeof measurementResultSchema>;
