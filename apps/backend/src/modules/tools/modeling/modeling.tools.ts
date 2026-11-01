import { modelingPlanSchema } from "../../../shared/schemas/modeling-plan.schema.js";
import { ALL_TOOL_NAMES, isToolName, TOOL_NAMES } from "../catalog/index.js";
import { defineTool, fromProviderToolName, type ToolDefinition } from "../tool.types.js";

/** Accepts both `editor.propose_commands` and the provider form `editor__propose_commands` the model sees. */
function normalizeToolName(name: string): string {
  return isToolName(name) ? name : fromProviderToolName(name);
}

export function createModelingTools(): ToolDefinition[] {
  return [
    defineTool({
      name: TOOL_NAMES.modelingGeneratePlan,
      description:
        "Record a structured modeling plan (goal, dimension, ordered steps) before changing the scene. Each step names the tool it will use, for example editor.propose_commands. Recording a plan does not change the scene; propose commands afterwards. Returns status recorded, or rejected with the unknown tool names.",
      permission: "plan",
      parameters: modelingPlanSchema,
      execute: (plan, context) => {
        const steps = plan.steps.map((step) => ({ ...step, toolName: normalizeToolName(step.toolName) }));
        const unknownTools = steps.map((step) => step.toolName).filter((name) => !isToolName(name));
        if (unknownTools.length > 0) {
          // Tool names, not command types such as scene.create_object, belong in plan steps.
          return { status: "rejected", reason: "Plan references unknown tools", unknownTools, validToolNames: ALL_TOOL_NAMES };
        }
        context.plans.push({ ...plan, steps });
        return { status: "recorded", planNumber: context.plans.length, stepCount: steps.length };
      },
    }),
  ];
}
