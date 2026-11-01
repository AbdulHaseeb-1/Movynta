import { reasoningEffortsFor, reasoningModelSettings } from "./model-capabilities.js";

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
