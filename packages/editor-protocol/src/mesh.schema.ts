import { z } from "zod";
import { modifierListSchema } from "./modifier.schema.js";

export const MAX_MESH_INPUT_TRIANGLES = 20_000;
export const MAX_MESH_OUTPUT_TRIANGLES = 100_000;
export const meshPathSchema = z.array(z.number().int().nonnegative().max(100_000)).max(32);
export const meshInspectionRequestSchema = z.object({
  objectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  meshPath: meshPathSchema.default([]),
  offset: z.number().int().nonnegative().max(100_000).default(0),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();
const point = z.array(z.number().finite()).length(3);
export const meshInspectionSchema = z.object({
  objectId: z.string(),
  meshPath: meshPathSchema,
  status: z.enum(["ok", "unsupported", "not_found"]),
  message: z.string().max(500).optional(),
  parts: z.array(z.object({ path: meshPathSchema, name: z.string().max(120) })).max(100),
  partsTruncated: z.boolean(),
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
  }).optional(),
  offset: z.number().int().nonnegative(),
  modifiers: modifierListSchema.optional(),
  baseTriangles: z.number().int().nonnegative().optional(),
  skinned: z.boolean().optional(),
  morphTargets: z.array(z.string()).optional(),
  matrixWorld: z.array(z.number().finite()).length(16).optional(),
  localBounds: z.object({ min: point, max: point }).nullable().optional(),
  edges: z.array(z.object({ vertices: z.array(z.number().int()).length(2), faces: z.array(z.number().int()).max(20_000) })).max(100),
  vertices: z.array(z.object({ index: z.number().int(), position: point })).max(100),
  faces: z.array(z.object({ index: z.number().int(), vertices: z.array(z.number().int()).max(20_000) })).max(100),
}).strict();
export type MeshInspectionRequest = z.infer<typeof meshInspectionRequestSchema>;
export type MeshInspection = z.infer<typeof meshInspectionSchema>;
