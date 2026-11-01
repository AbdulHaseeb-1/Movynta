import { z } from "zod";

export const MODELING_DIMENSIONS = ["2d", "2.5d", "3d"] as const;

export const modelingPlanStepSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/)
      .describe("Short step id: 1-40 characters, lowercase letters, digits or '-' only, for example torso-block"),
    title: z.string().min(1).max(120).describe("Step title, 1-120 characters"),
    toolName: z
      .string()
      .min(1)
      .max(120)
      .describe("Name of the tool this step uses, for example editor.propose_commands. Must be an existing tool"),
    description: z.string().max(500).describe("What the step does, at most 500 characters"),
    requiresApproval: z.boolean().default(false).describe("true if the step deletes or replaces things and needs user approval"),
  })
  .strict();

export const modelingPlanSchema = z
  .object({
    goal: z.string().min(1).max(500).describe("What the user wants built, 1-500 characters"),
    dimension: z.enum(MODELING_DIMENSIONS).describe("2d, 2.5d or 3d"),
    steps: z.array(modelingPlanStepSchema).min(1).max(30).describe("Ordered steps, 1-30 of them. Keep each step small"),
  })
  .strict();
