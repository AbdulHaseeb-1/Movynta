import { z } from "zod";
import { isValidSkillId } from "../../skills/skills.loader.js";
import type { SkillsRegistry } from "../../skills/skills.registry.js";
import { TOOL_NAMES } from "../catalog/index.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";

export function createSkillTools({ skills }: { readonly skills: SkillsRegistry }): ToolDefinition[] {
  return [
    defineTool({
      name: TOOL_NAMES.skillsLoadSkill,
      description:
        "Load the full workflow for a skill that is listed as relevant for this request; other skills are refused. Returns the step-by-step instructions, the tools the skill uses, and its validation and error-handling rules.",
      permission: "skill",
      parameters: z
        .object({
        skillId: z
          .string()
          .max(64)
          .refine(isValidSkillId, "Invalid skill id")
          .describe("Id of a skill listed as relevant in your instructions, for example character-modeling"),
      })
        .strict(),
      execute: (input, context) => {
        // Only skills selected for this request can be loaded, so unrelated workflows stay out of the prompt.
        if (!context.selectedSkillIds.includes(input.skillId)) {
          return { status: "not_selected", skillId: input.skillId };
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
