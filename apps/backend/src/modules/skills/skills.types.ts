import type { ModelingDimension } from "../../shared/schemas/modeling-plan.schema.js";

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
