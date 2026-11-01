import { modelingPlanSchema } from "../../../shared/schemas/modeling-plan.schema.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import type { ModelingToolDependencies } from "./modeling.types.js";

export const MODELING_PLAN_TOOL_NAME = "modeling.generate_model_plan";

export function createModelingTools({ knownToolNames }: ModelingToolDependencies): ToolDefinition[] {
  return [
    defineTool({
      name: MODELING_PLAN_TOOL_NAME,
      description:
        "Record a structured modeling plan (goal, dimension, ordered steps). It does not change the scene; propose commands afterwards.",
      permission: "plan",
      parameters: modelingPlanSchema,
      execute: (plan, context) => {
        const unknownTools = plan.steps.map((step) => step.toolName).filter((name) => !knownToolNames.includes(name));
        if (unknownTools.length > 0) {
          return { status: "rejected", reason: "Plan references unknown tools", unknownTools };
        }
        context.plans.push(plan);
        return { status: "recorded", planNumber: context.plans.length, stepCount: plan.steps.length };
      },
    }),
  ];
}
