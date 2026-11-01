import { z } from "zod";

export const MODELING_DIMENSIONS = ["2d", "2.5d", "3d"] as const;

export const modelingPlanStepSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    title: z.string().min(1).max(120),
    toolName: z.string().min(1).max(120),
    description: z.string().max(500),
    requiresApproval: z.boolean().default(false),
  })
  .strict();

export const modelingPlanSchema = z
  .object({
    goal: z.string().min(1).max(500),
    dimension: z.enum(MODELING_DIMENSIONS),
    steps: z.array(modelingPlanStepSchema).min(1).max(30),
  })
  .strict();
