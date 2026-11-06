import type { ModelSettings } from "@openai/agents";
import type { ProviderId } from "./providers.types.js";
import { CHATGPT_MODEL_SETTINGS } from "./chatgpt/chatgpt.constants.js";

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

function chatgptEfforts(model: string): readonly ReasoningEffort[] {
  // The subscription backend accepts the shared subset on every reasoning model, but not "minimal".
  return /^(gpt-([5-9]|\d{2,})|o\d)|codex/.test(model) && !/chat|-pro/.test(model)
    ? LOW_MEDIUM_HIGH
    : [];
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
  if (providerId === "chatgpt") return chatgptEfforts(name);
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
  if (providerId === "openai" || providerId === "chatgpt")
    return { reasoning: { effort } };
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

/**
 * Completion budget for OpenAI-compatible Chat Completions. Gateways often pick a tiny default when
 * `max_tokens` is omitted, and reasoning models spend that budget before any text or tool call. Claude 5 models
 * think adaptively by default, so a full modeling turn can exhaust 16384 tokens with no visible output; the SDK
 * then rejects the empty `finish_reason: "length"` response. 64000 leaves room for the thinking and a large batch
 * of commands, and current Claude and DeepSeek models accept it.
 */
export const CHAT_COMPLETION_MAX_TOKENS = 64_000;

/**
 * Output budget for Anthropic-compatible endpoints. The Anthropic adapter caps an unrecognised model name at
 * 4,096 output tokens, which a batch of scene commands can exceed mid-call, and adaptive thinking spends from the
 * same budget. Claude 4 and later accept this budget; the Claude 2 and 3 families accept less, so they keep the
 * adapter's own limit.
 */
export const ANTHROPIC_COMPATIBLE_MAX_TOKENS = 64_000;
const LEGACY_CLAUDE_MODEL = /^(claude-instant|claude-2|claude-3)/;

/** Settings a provider needs on every run, whatever the user selects. */
export function requiredModelSettings(providerId: ProviderId, model = ""): ModelSettings {
  if (providerId === "chatgpt") return CHATGPT_MODEL_SETTINGS;
  if (providerId === "openai-compatible") return { maxTokens: CHAT_COMPLETION_MAX_TOKENS };
  if (providerId === "anthropic-compatible" && !LEGACY_CLAUDE_MODEL.test(model.toLowerCase()))
    return { maxTokens: ANTHROPIC_COMPATIBLE_MAX_TOKENS };
  return {};
}
