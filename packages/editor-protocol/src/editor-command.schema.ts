import { z } from "zod";

/** Upper bound for commands in one proposal. Larger batches always require approval. */
export const MAX_COMMANDS_PER_PROPOSAL = 50;

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Identifiers use letters, digits, '_' or '-'");
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

const commandBase = { commandId: identifier };

/**
 * Editor commands are a closed, discriminated union. The agent can only ask for
 * these operations; it never sends code or free-form instructions to the editor.
 */
export const editorCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...commandBase,
      type: z.literal("scene.create_object"),
      objectId: identifier,
      name: z.string().min(1).max(80),
      parentId: identifier.optional(),
      transform: transformSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.transform_object"),
      objectId: identifier,
      transform: transformSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.delete_object"),
      objectId: identifier,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("geometry.create_primitive"),
      objectId: identifier,
      primitive: z.enum(["box", "sphere", "cylinder", "plane"]),
      size: z.number().positive().max(100),
      replaceExisting: z.boolean().default(false),
    })
    .strict(),
]);

export const editorCommandListSchema = z.array(editorCommandSchema).min(1).max(MAX_COMMANDS_PER_PROPOSAL);
