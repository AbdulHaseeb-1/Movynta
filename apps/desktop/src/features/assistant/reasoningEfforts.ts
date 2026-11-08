import { z } from "zod";

/** The schema for the reasoning effort settings the composer offers. */
export const reasoningEffortSchema = z.enum(["minimal", "low", "medium", "high"]);
/** How hard the model should think: minimal, low, medium or high. */
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

/** The label shown for each reasoning effort. */
export const EFFORT_LABELS: Readonly<Record<ReasoningEffort, string>> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** The short description shown for each reasoning effort. */
export const EFFORT_HINTS: Readonly<Record<ReasoningEffort, string>> = {
  minimal: "Fastest, almost no reasoning",
  low: "Quick answers",
  medium: "Balanced speed and depth",
  high: "Deepest reasoning, slowest",
};

/** Efforts are remembered per provider and model, since each model offers its own set. */
export function effortKey(providerId: string, model: string): string {
  return `${providerId}:${model}`;
}

/** The effort to use: the saved one if this model still accepts it, otherwise none (the model's default). */
export function resolveEffort(
  saved: ReasoningEffort | undefined,
  supported: readonly ReasoningEffort[],
): ReasoningEffort | null {
  return saved !== undefined && supported.includes(saved) ? saved : null;
}
