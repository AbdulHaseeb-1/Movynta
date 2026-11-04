import { z } from "zod";
import { meshInspectionSchema, meshPathSchema } from "./mesh.schema.js";

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

/**
 * What the user is doing with the design tools: Object or Edit mode and, in Edit mode, the components they picked.
 * `modifiersEnabled` tells whether `ids` name the base cage (false) or the evaluated display mesh (true).
 */
export const designFocusSchema = z
  .object({
    mode: z.enum(["object", "edit"]),
    componentKind: z.enum(["vertex", "edge", "face"]).nullable(),
    componentSelection: z
      .object({
        objectId: identifier,
        meshPath: meshPathSchema,
        kind: z.enum(["vertex", "edge", "face"]),
        ids: z.array(z.string().regex(/^\d{1,10}(_\d{1,10})?$/)).max(4096),
        modifiersEnabled: z.boolean(),
        baseFaceIds: z.array(z.string().regex(/^\d{1,10}$/)).min(1).max(4096).optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();

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
    /** The user's design mode and Edit-mode picks. Missing for editors that predate it. */
    designFocus: designFocusSchema.optional(),
  })
  .strict();
