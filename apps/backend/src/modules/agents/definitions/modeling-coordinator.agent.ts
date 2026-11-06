import { Agent, type AgentOutputType } from "@openai/agents";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import { toProviderToolName } from "../../tools/tool.types.js";
import { toSdkTool } from "../../tools/tool.sdk-adapter.js";
import { requestPolicyGuardrail } from "../guardrails/request-policy.guardrail.js";
import type { AgentDefinition, AppAgent, ModelingCoordinatorDependencies } from "./definitions.types.js";
import { buildModelingInstructions } from "./modeling-coordinator.instructions.js";

export const MODELING_COORDINATOR_ID = "modeling-coordinator";
export const MODELING_COORDINATOR_VERSION = "1.0.0";

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
      return new Agent<AgentRunContext, AgentOutputType>({
        name: "ModelingCoordinatorAgent",
        model: deps.model ?? "configured-provider",
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
