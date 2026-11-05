import { modelingPlanSchema } from "../../../shared/schemas/modeling-plan.schema.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import type { ModelingToolDependencies } from "./modeling.types.js";

export const MODELING_PLAN_TOOL_NAME = "modeling.generate_model_plan";

export function createModelingTools({ knownToolNames }: ModelingToolDependencies): ToolDefinition[] {
  return [
    defineTool({
      name: MODELING_PLAN_TOOL_NAME,
      description:
        "Record a structured modeling plan (goal, dimension, ordered steps). Each step's toolName must be a tool you can call, such as editor.propose_commands. It does not change the scene; propose commands afterwards.",
      permission: "plan",
      parameters: modelingPlanSchema,
      execute: (plan, context) => {
        const unknownTools = plan.steps.map((step) => step.toolName).filter((name) => !knownToolNames.includes(name));
        if (unknownTools.length > 0) {
          return {
            status: "rejected",
            reason: "Plan references unknown tools. Each step's toolName must be one of the available tools.",
            unknownTools,
            availableTools: knownToolNames,
          };
        }
        context.progress.plans.push(plan);
        return { status: "recorded", planNumber: context.progress.plans.length, stepCount: plan.steps.length };
      },
    }),
  ];
}
