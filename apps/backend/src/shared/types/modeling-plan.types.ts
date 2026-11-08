import type { z } from "zod";
import type { MODELING_DIMENSIONS, modelingPlanSchema } from "../schemas/modeling-plan.schema.js";

/** A modeling dimension. Only 3D is supported. */
export type ModelingDimension = (typeof MODELING_DIMENSIONS)[number];
/** A modeling plan: its goal, dimension and steps. */
export type ModelingPlan = z.infer<typeof modelingPlanSchema>;
