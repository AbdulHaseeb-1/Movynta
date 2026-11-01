import { describe, expect, it } from "vitest";
import { formatModelName } from "./modelNames";

describe("formatModelName", () => {
  it.each([
    ["gpt-5.4-mini", "GPT-5.4 Mini"],
    ["gpt-4o-mini", "GPT-4o Mini"],
    ["o3-mini", "o3 Mini"],
    ["claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"],
    ["claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet"],
    ["claude-opus-5-5", "Claude Opus 5.5"],
    ["gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite"],
    ["models/gemini-3-pro-preview", "Gemini 3 Pro Preview"],
    ["gpt-5-chat-latest", "GPT-5 Chat"],
  ])("formats %s", (id, expected) => {
    expect(formatModelName(id)).toBe(expected);
  });

  it("falls back to the id when there is nothing to format", () => {
    expect(formatModelName("")).toBe("");
  });
});
