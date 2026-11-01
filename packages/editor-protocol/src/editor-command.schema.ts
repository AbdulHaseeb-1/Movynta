import { z } from "zod";

/** Upper bound for commands in one proposal. Larger batches always require approval. */
export const MAX_COMMANDS_PER_PROPOSAL = 50;

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Identifiers use letters, digits, '_' or '-'");
// Model providers drop numeric and length limits from tool schemas, so each limit is also stated in the
// description. Without that the model only learns the limit by being rejected.
const objectId = (purpose: string) =>
  identifier.describe(`${purpose}. 1-64 characters: letters, digits, '_' or '-' only, no spaces.`);
// A fixed-length array rather than z.tuple: tuples become `items: [...]` in JSON Schema, which model
// providers reject when this schema is sent as a tool definition.
const vector3 = z.array(z.number().finite()).length(3).describe("[x, y, z] in scene units: exactly 3 finite numbers");

export const transformSchema = z
  .object({
    position: vector3.optional(),
    rotation: vector3.optional(),
    scale: vector3.optional(),
  })
  .strict();

const commandBase = { commandId: objectId("Unique id of this command inside the batch") };

/**
 * Editor commands are a closed, discriminated union. The agent can only ask for
 * these operations; it never sends code or free-form instructions to the editor.
 */
export const editorCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...commandBase,
      type: z.literal("scene.create_object"),
      objectId: objectId("Id for the new empty object (group, bone); it must not exist yet. Use geometry.create_primitive for shapes"),
      name: z.string().min(1).max(80).describe("Display name, 1-80 characters"),
      parentId: objectId("Id of an existing object or one created earlier in this batch to parent under").optional(),
      transform: transformSchema.optional().describe("Initial transform; leave out to use the defaults"),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.transform_object"),
      objectId: objectId("Id of the object to move; it must exist"),
      transform: transformSchema.describe("Only the listed parts change; scale values must be above 0"),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("scene.delete_object"),
      objectId: objectId("Id of the object to delete; it must exist. Deleting needs user approval"),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("geometry.create_primitive"),
      objectId: objectId("Id of the shape object (its only identifier: shapes have no name field). It creates the object, so the id must be new, unless replaceExisting is true, which needs an existing id"),
      primitive: z.enum(["box", "sphere", "cylinder", "plane"]).describe("Shape to create"),
      size: z.number().positive().max(100).describe("Edge length or diameter in scene units, above 0 and at most 100"),
      replaceExisting: z
        .boolean()
        .default(false)
        .describe("true replaces existing geometry on the object and needs user approval; use false otherwise"),
    })
    .strict(),
]);

export const editorCommandListSchema = z
  .array(editorCommandSchema)
  .min(1)
  .max(MAX_COMMANDS_PER_PROPOSAL)
  .describe(`Between 1 and ${MAX_COMMANDS_PER_PROPOSAL} commands, executed in order. Batches over 20 need user approval`);
