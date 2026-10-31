import { Agent, type AgentOutputType } from "@openai/agents";
import type { AgentRunContext } from "../../agent-runs/agent-run.context.js";
import { toProviderToolName } from "../../tools/tool.types.js";
import { toSdkTool } from "../../tools/tool.factory.js";
import { ToolRegistry } from "../../tools/tool.registry.js";
import { requestPolicyGuardrail } from "../guardrails/request-policy.guardrail.js";
import { SkillsRegistry } from "../../skills/skills.registry.js";
import type { AgentDefinition, AppAgent } from "./agent-definition.js";
import { buildModelingInstructions } from "./modeling-coordinator.instructions.js";

export const MODELING_COORDINATOR_ID = "modeling-coordinator";
export const MODELING_COORDINATOR_VERSION = "1.0.0";

export interface ModelingCoordinatorDependencies {
  readonly model: string | undefined;
  readonly tools: ToolRegistry;
  readonly skills: SkillsRegistry;
}

/**
 * Definition of the coordinator that understands 2D, 2.5D and 3D requests and
 * drives the editor through validated commands. Instructions are built per run,
 * so only skills selected for the current request reach the prompt.
 */
export function createModelingCoordinatorDefinition(deps: ModelingCoordinatorDependencies): AgentDefinition {
  const { tools, skills } = deps;
  const toolNameMap = tools.list().map((tool) => ({ name: tool.name, providerName: toProviderToolName(tool.name) }));

  return {
    id: MODELING_COORDINATOR_ID,
    name: "ModelingCoordinatorAgent",
    description: "Plans and applies 2D, 2.5D and 3D modeling work in the Movynta editor through approved commands.",
    version: MODELING_COORDINATOR_VERSION,
    createAgent(): AppAgent {
      if (!deps.model) throw new Error("OPENAI_MODEL is required to create agents");
      return new Agent<AgentRunContext, AgentOutputType>({
        name: "ModelingCoordinatorAgent",
        model: deps.model,
        instructions: (runContext: { context: AgentRunContext }) =>
          buildModelingInstructions({
            skills: skills.list().filter((skill) => runContext.context.selectedSkillIds.includes(skill.id)),
            toolNameMap,
          }),
        tools: tools.list().map((tool) => toSdkTool(tool)),
        inputGuardrails: [requestPolicyGuardrail],
      });
    },
  };
}
