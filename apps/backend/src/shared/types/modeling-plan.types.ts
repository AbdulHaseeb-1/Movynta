import type { z } from "zod";
import type { MODELING_DIMENSIONS, modelingPlanSchema } from "../schemas/modeling-plan.schema.js";

export type ModelingDimension = (typeof MODELING_DIMENSIONS)[number];
export type ModelingPlan = z.infer<typeof modelingPlanSchema>;
