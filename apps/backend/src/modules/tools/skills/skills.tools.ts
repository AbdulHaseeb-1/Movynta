import { z } from "zod";
import { isValidSkillId } from "../../skills/skills.loader.js";
import type { SkillsRegistry } from "../../skills/skills.registry.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";

/** Builds skills.load_skill, which loads a workflow only if this request selected it. */
export function createSkillTools({ skills }: { readonly skills: SkillsRegistry }): ToolDefinition[] {
  return [
    defineTool({
      name: "skills.load_skill",
      description:
        "Load the full workflow for a skill that was selected for this request. Only the selected skills listed in your instructions can be loaded; any other id returns not_selected with the ids that can be.",
      permission: "skill",
      parameters: z.object({ skillId: z.string().max(64).refine(isValidSkillId, "Invalid skill id") }).strict(),
      execute: (input, context) => {
        // Only skills selected for this request can be loaded, so unrelated workflows stay out of the prompt.
        if (!context.selectedSkillIds.includes(input.skillId)) {
          return { status: "not_selected", skillId: input.skillId, availableSkillIds: context.selectedSkillIds };
        }
        const skill = skills.get(input.skillId);
        if (!skill) return { status: "not_found", skillId: input.skillId };

        context.events.emit("skill.loaded", { skillId: skill.id, version: skill.version });
        return {
          status: "loaded",
          skillId: skill.id,
          version: skill.version,
          instructions: skill.instructions,
          toolNames: skill.toolNames,
          validation: skill.validation,
          errorHandling: skill.errorHandling,
        };
      },
    }),
  ];
}
