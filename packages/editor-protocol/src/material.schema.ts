import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use an sRGB #RRGGBB color");
export const materialPropertiesSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    color: color.optional(),
    roughness: z.number().finite().min(0).max(1).optional(),
    metalness: z.number().finite().min(0).max(1).optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    depthWrite: z.boolean().optional(),
    emissive: color.optional(),
    emissiveIntensity: z.number().finite().min(0).max(100).optional(),
    side: z.enum(["front", "back", "double"]).optional(),
  })
  .strict();
export type MaterialProperties = z.infer<typeof materialPropertiesSchema>;
export const materialSlotSchema = z
  .object({
    slot: z.number().int().nonnegative(),
    name: z.string().max(120),
    type: z.string().max(80),
    editable: z.boolean(),
    color: color.nullable(),
    roughness: z.number().finite().nullable(),
    metalness: z.number().finite().nullable(),
    opacity: z.number().finite(),
    transparent: z.boolean(),
    depthWrite: z.boolean(),
    emissive: color.nullable(),
    emissiveIntensity: z.number().finite().nullable(),
    side: z.enum(["front", "back", "double"]),
    textures: z.array(z.string()).max(32),
  })
  .strict();
