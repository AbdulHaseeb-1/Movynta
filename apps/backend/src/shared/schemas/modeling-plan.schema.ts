import { z } from "zod";

/** The dimensions a modeling plan can be for. Only 3D is supported. */
export const MODELING_DIMENSIONS = ["3d"] as const;

/** The schema for one step of a modeling plan. */
export const modelingPlanStepSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    title: z.string().min(1).max(120),
    toolName: z.string().min(1).max(120),
    description: z.string().max(500),
    requiresApproval: z.boolean().default(false),
  })
  .strict();

/** The schema for a modeling plan: its goal, dimension and steps. */
export const modelingPlanSchema = z
  .object({
    goal: z.string().min(1).max(500),
    dimension: z.enum(MODELING_DIMENSIONS),
    steps: z.array(modelingPlanStepSchema).min(1).max(30),
  })
  .strict();
