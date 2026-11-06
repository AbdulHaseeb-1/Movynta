import {
  ANTHROPIC_COMPATIBLE_MAX_TOKENS,
  CHAT_COMPLETION_MAX_TOKENS,
  reasoningEffortsFor,
  reasoningModelSettings,
  requiredModelSettings,
} from "./model-capabilities.js";

describe("reasoningEffortsFor", () => {
  it("offers efforts per OpenAI model family", () => {
    expect(reasoningEffortsFor("openai", "o3-mini")).toEqual(["low", "medium", "high"]);
    expect(reasoningEffortsFor("openai", "gpt-5-mini")).toEqual(["minimal", "low", "medium", "high"]);
    expect(reasoningEffortsFor("openai", "gpt-5.1")).toEqual(["low", "medium", "high"]);
    expect(reasoningEffortsFor("openai", "gpt-5-codex")).toEqual(["low", "medium", "high"]);
  });

  it("offers nothing for models without an effort setting", () => {
    expect(reasoningEffortsFor("openai", "gpt-4o")).toEqual([]);
    expect(reasoningEffortsFor("openai", "o1-mini")).toEqual([]);
    expect(reasoningEffortsFor("openai", "gpt-5-chat-latest")).toEqual([]);
    expect(reasoningEffortsFor("openai", "gpt-5-pro")).toEqual([]);
    expect(reasoningEffortsFor("anthropic", "claude-3-5-haiku-latest")).toEqual([]);
    expect(reasoningEffortsFor("openai-compatible", "gpt-5")).toEqual([]);
    expect(reasoningEffortsFor("anthropic-compatible", "claude-sonnet-4-5")).toEqual([]);
  });

  it("covers Claude and Gemini thinking models", () => {
    expect(reasoningEffortsFor("anthropic", "claude-sonnet-4-5")).toEqual(["low", "medium", "high"]);
    expect(reasoningEffortsFor("google", "gemini-2.5-flash")).toEqual(["low", "medium", "high"]);
    expect(reasoningEffortsFor("google", "gemini-3-pro-preview")).toEqual(["low", "high"]);
    expect(reasoningEffortsFor("google", "gemini-2.0-flash")).toEqual([]);
  });
});

describe("requiredModelSettings", () => {
  it("gives Chat Completions a completion budget and leaves other providers alone", () => {
    expect(requiredModelSettings("openai-compatible", "gpt-4o")).toEqual({ maxTokens: CHAT_COMPLETION_MAX_TOKENS });
    expect(requiredModelSettings("openai", "gpt-4o")).toEqual({});
    expect(CHAT_COMPLETION_MAX_TOKENS).toBeGreaterThanOrEqual(8192);
  });

  it("raises the output budget of Anthropic-compatible models that the adapter does not know", () => {
    expect(requiredModelSettings("anthropic-compatible", "my-gateway-model")).toEqual({ maxTokens: ANTHROPIC_COMPATIBLE_MAX_TOKENS });
    expect(requiredModelSettings("anthropic-compatible", "claude-sonnet-5-5")).toEqual({ maxTokens: ANTHROPIC_COMPATIBLE_MAX_TOKENS });
    expect(requiredModelSettings("anthropic-compatible", "claude-sonnet-4-5")).toEqual({ maxTokens: ANTHROPIC_COMPATIBLE_MAX_TOKENS });
  });

  it("keeps the adapter's limit for Claude 2 and 3 models, which accept less", () => {
    expect(requiredModelSettings("anthropic-compatible", "claude-3-haiku-20240307")).toEqual({});
    expect(requiredModelSettings("anthropic-compatible", "Claude-3-5-sonnet-latest")).toEqual({});
  });

  it("does not set an output budget for native Anthropic, whose adapter knows its models", () => {
    expect(requiredModelSettings("anthropic", "my-new-model")).toEqual({});
  });
});

describe("reasoningModelSettings", () => {
  it("translates the effort to each provider's setting", () => {
    expect(reasoningModelSettings("openai", "o3", "high")).toEqual({ reasoning: { effort: "high" } });
    expect(reasoningModelSettings("anthropic", "claude-sonnet-4-5", "low")).toEqual({
      providerData: {
        providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } },
      },
    });
    expect(reasoningModelSettings("google", "gemini-2.5-pro", "medium")).toEqual({
      providerData: { providerOptions: { google: { thinkingConfig: { thinkingBudget: 8192 } } } },
    });
    expect(reasoningModelSettings("google", "gemini-3-pro", "high")).toEqual({
      providerData: { providerOptions: { google: { thinkingConfig: { thinkingLevel: "high" } } } },
    });
  });
});

describe("ChatGPT reasoning efforts", () => {
  it("offers the shared subset to gpt-5 and later models, codex variants and o-series models", () => {
    for (const model of ["gpt-5", "gpt-5.1-codex", "gpt-6", "gpt-12", "gpt-10-mini", "o3", "o4-mini", "gpt-5-codex"])
      expect(reasoningEffortsFor("chatgpt", model)).toEqual(["low", "medium", "high"]);
  });

  it("offers none to chat-tuned, pro and older models", () => {
    for (const model of ["gpt-4o", "gpt-4.1", "gpt-5-chat-latest", "gpt-5-pro", "gpt-3.5-turbo", "dall-e"])
      expect(reasoningEffortsFor("chatgpt", model)).toEqual([]);
  });
});
