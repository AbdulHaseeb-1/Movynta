import type { ModelingDimension } from "../../shared/types/modeling-plan.types.js";

/** Full skill, including the workflow instructions loaded from SKILL.md. */
export interface SkillManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly dimensions: readonly ModelingDimension[];
  readonly tags: readonly string[];
  readonly whenToUse: readonly string[];
  readonly requiredInputs: readonly string[];
  readonly toolNames: readonly string[];
  readonly validation: readonly string[];
  readonly errorHandling: readonly string[];
  readonly instructions: string;
}

/** Metadata-only view used in lists and in the coordinator prompt. */
export type SkillSummary = Omit<SkillManifest, "instructions" | "tags" | "validation" | "errorHandling">;

/** The request a skill is selected for: its message and the dimension. */
export interface SkillRequest {
  readonly message: string;
  readonly dimension?: ModelingDimension | undefined;
}

/** Frontmatter values as read from SKILL.md, before validation. */
export type RawFrontmatter = Record<string, string | string[]>;

/** The part of a skill that listing and selection need, without its full instructions. */
export function toSkillSummary(manifest: SkillManifest): SkillSummary {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    dimensions: manifest.dimensions,
    whenToUse: manifest.whenToUse,
    requiredInputs: manifest.requiredInputs,
    toolNames: manifest.toolNames,
  };
}
