import { z } from "zod";
const common = { id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), enabled: z.boolean().default(true) };
export const modifierSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("bevel"), width: z.number().finite().positive().max(100), segments: z.number().int().min(1).max(8).default(1) }).strict(),
  z.object({ ...common, kind: z.literal("subdivision"), levels: z.number().int().min(1).max(3) }).strict(),
]);
export const modifierListSchema = z.array(modifierSchema).max(8).refine((entries) => new Set(entries.map((entry) => entry.id)).size === entries.length, "Modifier ids must be unique");
export type MeshModifierSpec = z.infer<typeof modifierSchema>;
