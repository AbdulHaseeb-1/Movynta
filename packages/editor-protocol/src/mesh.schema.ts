import { z } from "zod";
import { meshPathSchema } from "./mesh-path.js";
import { modifierListSchema } from "./modifier.schema.js";
import { materialSlotSchema } from "./material.schema.js";

export const MAX_MESH_INPUT_TRIANGLES = 20_000;
export const MAX_MESH_OUTPUT_TRIANGLES = 100_000;
export { meshPathSchema };
const point = z.array(z.number().finite()).length(3);
export const meshInspectionRequestSchema = z.object({
  objectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  meshPath: meshPathSchema.default([]),
  view: z.enum(["base", "evaluated"]).optional(),
  offset: z.number().int().nonnegative().max(100_000).default(0),
  limit: z.number().int().min(1).max(100).default(25),
  includeSamples: z.boolean().optional(),
  materialsOnly: z.boolean().optional(),
  /** Lists the mesh's openings (closed chains of boundary edges) with their edge IDs, ready for fill_hole or bridging. */
  openings: z.object({
    offset: z.number().int().nonnegative().max(100_000).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }).strict().optional(),
  /** Lists the mesh's connected parts, each with a face that names it, its size and its extent. */
  shells: z.object({
    offset: z.number().int().nonnegative().max(100_000).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }).strict().optional(),
  faceQuery: z.object({
    normal: point.optional(),
    minDot: z.number().finite().min(-1).max(1).optional(),
    centerMin: point.optional(),
    centerMax: point.optional(),
    offset: z.number().int().nonnegative().max(100_000).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }).strict().refine((query) => query.normal !== undefined || query.centerMin !== undefined || query.centerMax !== undefined,
    "Specify a normal or a center bound")
    .refine((query) => !query.normal || query.normal.some((value) => Math.abs(value) > 1e-9), "Normal must be nonzero")
    .refine((query) => !query.centerMin || !query.centerMax || query.centerMin.every((value, axis) => value <= (query.centerMax?.[axis] ?? value)), "Center bounds must be ordered").optional(),
}).strict();
export const materialInspectionRequestSchema = meshInspectionRequestSchema.pick({ objectId: true, meshPath: true, offset: true, limit: true });
export const meshInspectionSchema = z.object({
  objectId: z.string(),
  meshPath: meshPathSchema,
  view: z.enum(["base", "evaluated"]).optional(),
  status: z.enum(["ok", "unsupported", "not_found"]),
  message: z.string().max(500).optional(),
  parts: z.array(z.object({ path: meshPathSchema, name: z.string().max(120) })).max(100),
  partsTruncated: z.boolean(),
  materials: z.array(materialSlotSchema).max(100).optional(),
  materialSlotCount: z.number().int().nonnegative().optional(),
  stats: z.object({
    renderVertices: z.number().int().nonnegative(),
    vertices: z.number().int().nonnegative(),
    edges: z.number().int().nonnegative(),
    faces: z.number().int().nonnegative(),
    triangles: z.number().int().nonnegative(),
    boundaryEdges: z.number().int().nonnegative(),
    nonManifoldEdges: z.number().int().nonnegative(),
    inconsistentEdges: z.number().int().nonnegative(),
    attributes: z.array(z.string()).max(32),
    materialGroups: z.number().int().nonnegative(),
    materialSlots: z.number().int().nonnegative().optional(),
  }).optional(),
  offset: z.number().int().nonnegative(),
  modifiers: modifierListSchema.optional(),
  baseTriangles: z.number().int().nonnegative().optional(),
  baseKey: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  skinned: z.boolean().optional(),
  morphTargets: z.array(z.string()).optional(),
  matrixWorld: z.array(z.number().finite()).length(16).optional(),
  localBounds: z.object({ min: point, max: point }).nullable().optional(),
  faceMatches: z.object({
    ids: z.array(z.string()).max(1000), total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(), hasMore: z.boolean(),
  }).strict().optional(),
  openings: z.object({
    loops: z.array(z.object({
      /** Canonical edge IDs in walking order, at most 256. */
      edges: z.array(z.string()).max(256),
      edgeCount: z.number().int().positive(),
      /** True when the loop has more edges than `edges` lists, so it cannot be passed to a command whole. */
      truncated: z.boolean(),
      center: point, min: point, max: point,
    }).strict()).max(50),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    /** Boundary edges that are not part of a simple closed loop (a chain that does not close, or openings that touch). */
    irregularEdges: z.number().int().nonnegative(),
  }).strict().optional(),
  shells: z.object({
    shells: z.array(z.object({
      faceCount: z.number().int().positive(),
      firstFace: z.number().int().nonnegative(),
      closed: z.boolean(),
      center: point, min: point, max: point,
    }).strict()).max(50),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }).strict().optional(),
  edges: z.array(z.object({ vertices: z.array(z.number().int()).length(2), faces: z.array(z.number().int()).max(20_000) })).max(100),
  vertices: z.array(z.object({ index: z.number().int(), position: point })).max(100),
  faces: z.array(z.object({
    index: z.number().int(),
    vertices: z.array(z.number().int()).max(20_000),
    baseFaceIndex: z.number().int().nonnegative().optional(),
  })).max(100),
}).strict();
export type MeshInspectionRequest = z.infer<typeof meshInspectionRequestSchema>;
export type MeshInspection = z.infer<typeof meshInspectionSchema>;
