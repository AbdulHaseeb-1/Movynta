import { HALVE_BLOCK } from "./edits";
import { CHAIR, TABLE } from "./furniture";
import { FIGURE } from "./figure";
import { MUG, SWORD } from "./props";
import type { QualityScenario } from "./types";

/** The requests the assistant is measured on, from building something new to editing a mesh. */
export const QUALITY_SCENARIOS: readonly QualityScenario[] = [CHAIR, TABLE, SWORD, MUG, FIGURE, HALVE_BLOCK];

export function scenarioById(id: string): QualityScenario {
  const scenario = QUALITY_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`No quality scenario "${id}"`);
  return scenario;
}
