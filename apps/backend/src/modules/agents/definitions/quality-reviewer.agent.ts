import { Agent, type AgentOutputType } from "@openai/agents";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import { QUALITY_ASSESS_TOOL_NAME } from "../../tools/modeling/quality.tools.js";
import { toSdkTool } from "../../tools/tool.sdk-adapter.js";
import type { ToolRegistry } from "../../tools/tool.registry.js";
import type { AgentDefinition, AppAgent } from "./definitions.types.js";
import { QUALITY_REVIEWER_INSTRUCTIONS } from "./quality-reviewer.instructions.js";

export const QUALITY_REVIEWER_ID = "quality-reviewer";
export const QUALITY_REVIEWER_VERSION = "1.0.0";

/**
 * The only tools the reviewer has: everything that looks at the scene, and the verdict. It has no way to propose or apply
 * a change, so a review cannot alter the work it judges.
 */
export const QUALITY_REVIEWER_TOOL_NAMES: readonly string[] = [
  "editor.get_context",
  "editor.get_scene_summary",
  "editor.inspect_mesh",
  "editor.inspect_materials",
  "editor.measure",
  "viewport.capture",
  "validation.check_scene",
  "validation.check_brief",
  QUALITY_ASSESS_TOOL_NAME,
];

/**
 * An agent that did not build the result and judges it with fresh context. It is internal: the run loop starts it when the
 * builder has finished, and it is neither listed nor runnable through the API.
 */
export function createQualityReviewerDefinition(deps: {
  readonly model: string | undefined;
  readonly tools: ToolRegistry;
}): AgentDefinition {
  const tools = QUALITY_REVIEWER_TOOL_NAMES.map((name) => {
    const tool = deps.tools.get(name);
    if (!tool) throw new Error(`The reviewer needs the tool "${name}", which is not registered`);
    return toSdkTool(tool);
  });
  return {
    id: QUALITY_REVIEWER_ID,
    name: "QualityReviewerAgent",
    description: "Reviews finished modeling work independently of the assistant that built it.",
    version: QUALITY_REVIEWER_VERSION,
    internal: true,
    createAgent(): AppAgent {
      return new Agent<AgentRunContext, AgentOutputType>({
        name: "QualityReviewerAgent",
        model: deps.model ?? "configured-provider",
        instructions: QUALITY_REVIEWER_INSTRUCTIONS,
        tools,
      });
    },
  };
}
