/**
 * The single list of tools that exist. Every other place (toolsets, plans,
 * skills, instructions, tests) refers to tools through these constants, so a
 * rename or removal is a compile error instead of a runtime surprise.
 *
 * Names are `namespace.tool_name`. The namespace is the resource the tool acts
 * on (`editor`, `modeling`, `skills`, `validation`), which keeps tools easy to
 * tell apart for the model.
 */
export const TOOL_NAMES = {
  editorGetContext: "editor.get_context",
  editorGetSceneSummary: "editor.get_scene_summary",
  editorProposeCommands: "editor.propose_commands",
  editorApplyProposal: "editor.apply_proposal",
  modelingGeneratePlan: "modeling.generate_model_plan",
  skillsLoadSkill: "skills.load_skill",
  validationCheckScene: "validation.check_scene",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

export const ALL_TOOL_NAMES: readonly ToolName[] = Object.values(TOOL_NAMES);

const TOOL_NAME_SET: ReadonlySet<string> = new Set(ALL_TOOL_NAMES);

export function isToolName(value: string): value is ToolName {
  return TOOL_NAME_SET.has(value);
}
