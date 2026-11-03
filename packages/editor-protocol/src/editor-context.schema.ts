import { z } from "zod";
import { meshInspectionSchema } from "./mesh.schema.js";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const vector3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const editorObjectSchema = z.object({
  id: identifier,
  name: z.string().max(120),
  type: z.enum(["mesh", "empty", "collection", "camera", "light"]),
  parentId: identifier.nullable(),
  transform: z.object({ position: vector3, rotation: vector3, scale: vector3 }).strict(),
  /** Whether the object is drawn. Missing for snapshots from editors that predate it. */
  visible: z.boolean().optional(),
  /** World-space axis-aligned bounds including descendants; null for objects with no geometry. */
  worldBounds: z.object({ min: vector3, max: vector3 }).strict().nullable().optional(),
});

/** Snapshot of the editor scene that the backend receives over the editor bridge. */
export const editorContextSchema = z
  .object({
    projectId: z.string().min(1).max(128),
    revision: z.number().int().nonnegative(),
    activeSceneName: z.string().max(120).nullable(),
    selectedObjectIds: z.array(identifier).max(500),
    objects: z.array(editorObjectSchema).max(2000),
    meshInspection: meshInspectionSchema.optional(),
    supportsPreparedCommands: z.boolean().optional(),
  })
  .strict();
