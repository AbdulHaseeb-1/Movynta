import { modelingPlanSchema } from "../../../shared/schemas/modeling-plan.schema.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import type { ModelingToolDependencies } from "./modeling.types.js";

/** The name of the plan-recording tool. */
export const MODELING_PLAN_TOOL_NAME = "modeling.generate_model_plan";

/** Builds the plan-recording tool. Each plan step must name a tool that exists. */
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
        // Batches are tied to a plan by step id, so two steps with one id could never both be shown done.
        const ids = plan.steps.map((step) => step.id);
        const duplicates = [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))];
        if (duplicates.length > 0) {
          return {
            status: "rejected",
            reason: "Each step needs its own id, because batches are matched to steps by id.",
            duplicateStepIds: duplicates,
          };
        }
        context.progress.plans.push(plan);
        return { status: "recorded", planNumber: context.progress.plans.length, stepCount: plan.steps.length };
      },
    }),
  ];
}
