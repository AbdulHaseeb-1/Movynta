import { z } from "zod";
const common = { id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), enabled: z.boolean().default(true) };
export const bevelProfileSchema = z.enum(["chamfer", "round"]);
export const subdivisionMethodSchema = z.enum(["catmull-clark", "linear", "loop"]);
export const modifierSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("bevel"),
    width: z.number().finite().positive().max(100),
    segments: z.number().int().min(1).max(8).default(1),
    /** Flat chamfer, or a quadratic round profile. Omitted means round. */
    profile: bevelProfileSchema.optional(),
    /** Minimum angle between face normals, in degrees. Omitted or 0 bevels every manifold edge. */
    angle: z.number().finite().min(0).max(180).optional(),
  }).strict(),
  z.object({
    ...common,
    kind: z.literal("subdivision"),
    levels: z.number().int().min(1).max(3),
    /** Omitted means Catmull–Clark. */
    method: subdivisionMethodSchema.optional(),
  }).strict(),
]);
export const modifierListSchema = z.array(modifierSchema).max(8).refine((entries) => new Set(entries.map((entry) => entry.id)).size === entries.length, "Modifier ids must be unique");
export type MeshModifierSpec = z.infer<typeof modifierSchema>;
