import { TOOL_NAMES, type ToolName } from "./tool-names.js";

/**
 * A named allowlist of tools for one kind of agent. Agents receive exactly the
 * tools in their toolset (least privilege), and the registry fails startup if a
 * toolset names a tool that is not registered.
 */
export interface ToolsetDefinition {
  readonly id: string;
  readonly description: string;
  readonly toolNames: readonly ToolName[];
}

/** Everything the modeling coordinator needs: read, plan, propose, apply, check, and load skills. */
export const MODELING_TOOLSET: ToolsetDefinition = {
  id: "modeling",
  description: "Read the scene, plan, propose and apply editor commands, validate, and load skill workflows.",
  toolNames: [
    TOOL_NAMES.skillsLoadSkill,
    TOOL_NAMES.editorGetContext,
    TOOL_NAMES.editorGetSceneSummary,
    TOOL_NAMES.modelingGeneratePlan,
    TOOL_NAMES.editorProposeCommands,
    TOOL_NAMES.editorApplyProposal,
    TOOL_NAMES.validationCheckScene,
  ],
};

export const TOOLSETS: readonly ToolsetDefinition[] = [MODELING_TOOLSET];
