import type { ModelSettings } from "@openai/agents";
import type { ProviderId } from "./providers.types.js";

/**
 * Reasoning effort levels the app offers. Every provider has its own knob (OpenAI's `reasoning.effort`,
 * Anthropic's thinking budget, Gemini's thinking level or budget), so the app speaks one vocabulary and
 * translates it here.
 */
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const LOW_MEDIUM_HIGH: readonly ReasoningEffort[] = ["low", "medium", "high"];

function openaiEfforts(model: string): readonly ReasoningEffort[] {
  // o1-mini and o1-preview predate the reasoning_effort setting.
  if (/^o1-(mini|preview)/.test(model)) return [];
  if (/^o\d/.test(model)) return LOW_MEDIUM_HIGH;
  if (!/^gpt-5/.test(model)) return [];
  // Chat-tuned variants take no reasoning settings, and the pro variants always run at high effort.
  if (/chat|-pro/.test(model)) return [];
  // Codex variants and gpt-5.1 and later dropped "minimal"; the shared subset is always accepted.
  if (/codex|^gpt-5\.\d/.test(model)) return LOW_MEDIUM_HIGH;
  return ["minimal", ...LOW_MEDIUM_HIGH];
}

function anthropicEfforts(model: string): readonly ReasoningEffort[] {
  // Extended thinking: Claude 3.7 Sonnet, the 4 family, and the 5 family.
  return /^claude-(3-7-sonnet|(opus|sonnet|haiku)-4|(fable|opus|sonnet|haiku)-5)/.test(
    model,
  )
    ? LOW_MEDIUM_HIGH
    : [];
}

function googleEfforts(model: string): readonly ReasoningEffort[] {
  if (/^gemini-3/.test(model)) return ["low", "high"];
  if (/^gemini-2\.5-(pro|flash)/.test(model)) return LOW_MEDIUM_HIGH;
  return [];
}

/**
 * The efforts a model accepts, lowest first. Empty means the model has no effort setting, so none
 * should be offered or sent. Endpoints behind the "compatible" providers are unknown, so they never
 * get one. Only values every model of a family accepts are listed, so a listed value never errors.
 */
export function reasoningEffortsFor(
  providerId: ProviderId,
  model: string,
): readonly ReasoningEffort[] {
  const name = model.toLowerCase();
  if (providerId === "openai") return openaiEfforts(name);
  if (providerId === "anthropic") return anthropicEfforts(name);
  if (providerId === "google") return googleEfforts(name);
  return [];
}

const ANTHROPIC_BUDGET: Readonly<Record<ReasoningEffort, number>> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 24000,
};

const GOOGLE_BUDGET: Readonly<Record<ReasoningEffort, number>> = {
  minimal: 512,
  low: 1024,
  medium: 8192,
  high: 24576,
};

/** Model settings that apply `effort` for the provider. Call only with a value from `reasoningEffortsFor`. */
export function reasoningModelSettings(
  providerId: ProviderId,
  model: string,
  effort: ReasoningEffort,
): ModelSettings {
  if (providerId === "openai") return { reasoning: { effort } };
  if (providerId === "anthropic")
    return {
      providerData: {
        providerOptions: {
          anthropic: {
            thinking: { type: "enabled", budgetTokens: ANTHROPIC_BUDGET[effort] },
          },
        },
      },
    };
  if (providerId === "google")
    return {
      providerData: {
        providerOptions: {
          google: {
            thinkingConfig: /^gemini-3/i.test(model)
              ? { thinkingLevel: effort }
              : { thinkingBudget: GOOGLE_BUDGET[effort] },
          },
        },
      },
    };
  return {};
}
