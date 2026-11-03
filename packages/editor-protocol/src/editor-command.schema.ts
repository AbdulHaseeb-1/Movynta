import { z } from "zod";
import { meshPathSchema } from "./mesh.schema.js";
import { modifierListSchema } from "./modifier.schema.js";

/** Upper bound for commands in one proposal. Larger batches always require approval. */
export const MAX_COMMANDS_PER_PROPOSAL = 200;

export const identifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Identifiers use letters, digits, '_' or '-'");
// A fixed-length array rather than z.tuple: tuples become `items: [...]` in JSON Schema, which model
// providers reject when this schema is sent as a tool definition.
const vector3 = z.array(z.number().finite()).length(3);

export const transformSchema = z
  .object({
    position: vector3.optional(),
    rotation: vector3.optional(),
    scale: vector3.optional(),
  })
  .strict();

const commandBase = { commandId: identifierSchema };
const nameSchema = z.string().min(1).max(80);

/**
 * Editor commands are a closed, discriminated union. The agent can only ask for
 * these operations; it never sends code or free-form instructions to the editor.
 */
export const editorCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...commandBase, type: z.literal("geometry.bevel"), objectId: identifierSchema,
    meshPath: meshPathSchema.default([]), width: z.number().finite().positive().max(100),
    segments: z.number().int().min(1).max(8).optional(),
  }).strict(),
  z.object({ ...commandBase, type: z.literal("geometry.set_modifiers"), objectId: identifierSchema,
    meshPath: meshPathSchema.default([]), modifiers: modifierListSchema,
  }).strict(),
  z.object({ ...commandBase, type: z.literal("geometry.subdivide"), objectId: identifierSchema,
    meshPath: meshPathSchema.default([]), levels: z.number().int().min(1).max(3),
  }).strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.create_object"),
      objectId: identifierSchema,
      name: nameSchema,
      parentId: identifierSchema.optional(),
      transform: transformSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.transform_object"),
      objectId: identifierSchema,
      transform: transformSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.delete_object"),
      objectId: identifierSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("geometry.create_primitive"),
      objectId: identifierSchema,
      primitive: z.enum(["box", "sphere", "cylinder", "plane", "cone", "torus"]),
      size: z.number().positive().max(100),
      replaceExisting: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.rename_object"),
      objectId: identifierSchema,
      name: nameSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.set_visibility"),
      objectId: identifierSchema,
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.set_parent"),
      objectId: identifierSchema,
      /** The new parent, or null to move the object to the top level. The object keeps its place in the world. */
      parentId: identifierSchema.nullable(),
    })
    .strict(),
]);

export const editorCommandListSchema = z.array(editorCommandSchema).min(1).max(MAX_COMMANDS_PER_PROPOSAL);
